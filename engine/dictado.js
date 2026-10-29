'use strict';
/**
 * dictado.js — Hablarle a la computadora en vez de escribir el comentario.
 *
 * Revisar un video es mirar: tener las manos en el teclado para describir lo
 * que se está viendo hace que uno deje de mirar. Por eso el dictado.
 *
 * Cómo está armado, y por qué así:
 *
 * 1. **El micrófono lo abre la ventana**, con `getUserMedia`, y manda PCM de
 *    16 kHz por el puente. En un panel CEP eso no se podía —de ahí el ffmpeg de
 *    HyperPremiere— pero en Electron el renderer es Chromium entero y funciona:
 *    un proceso menos, y la lista de micrófonos sale del sistema en vez de
 *    parsearse del stderr de avfoundation.
 * 2. **No se trocea el audio.** En cada refresco se manda el buffer ENTERO y se
 *    reescribe el texto completo. Suena caro y es al revés: con el modelo
 *    cargado en memoria, `small` transcribe 30 s de habla en medio segundo. A
 *    cambio, la frase se corrige sola a medida que crece el contexto en vez de
 *    quedar cosida de pedazos que no se conocen entre sí.
 * 3. **El modelo queda cargado** (`whisper-server`). Cada invocación suelta del
 *    CLI paga un piso de más de un segundo, que es entre ocho y quince veces lo
 *    que cuesta transcribir: el servidor residente no es una optimización, es
 *    la diferencia entre que el texto aparezca mientras hablás y que no.
 *    Después de cinco minutos sin usarse se baja solo, que son ~500 MB que no
 *    vale la pena tener residentes.
 *
 * **El silencio hace inventar a Whisper.** Un segundo de sala callada vuelve
 * como «¡Suscríbete!» o «Gracias por ver el video»: son las frases más
 * repetidas en los subtítulos con los que se entrenó. Lo único que lo evita es
 * no llamar al modelo, así que hay una compuerta de volumen; y lo que igual se
 * cuele tiene una red abajo, que es la lista de frases de más abajo.
 */

const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const paths = require('./paths');

/** 16 kHz mono es lo que Whisper quiere; mandarle otra cosa es resamplear dos veces. */
const RATE = 16000;

/** Cuánto se espera a que el modelo cargue antes de darlo por perdido. */
const ARRANQUE_MAX_MS = 60000;

/** Una pasada que tarda más que esto es un servidor trabado, no uno lento. */
const PASADA_MAX_MS = 20000;

/** Sin usarse, el modelo se baja: medio giga de RAM al lado de un reproductor. */
const OCIO_MS = 5 * 60 * 1000;

/** Un dictado se corta solo: para un comentario, cinco minutos es muchísimo. */
const TOPE_MS = 5 * 60 * 1000;

/**
 * Por debajo de esto no se llama al modelo.
 *
 * El número salió de medir con el micrófono de la MacBook en HyperPremiere: la
 * sala callada está entre −44 y −37 dBFS y el habla llega en −21. El umbral va
 * del lado estricto a propósito: si queda alto, alguien que habla bajito lee
 * «entró audio pero está en silencio» y sabe qué tocar; si quedara bajo, leería
 * «¡Suscríbete!» metido en su comentario y pensaría que la función está rota.
 */
const RMS_MINIMO_DBFS = -34;

/** Lo que Whisper dice cuando no oyó nada. Si la transcripción es esto, se tira. */
const INVENTADAS = [
    /^[\s¡!.,]*suscr[ií]b(?:ete|anse)[\s¡!.,]*$/i,
    /^[\s.,]*gracias(?: por ver(?: el v[ií]deo)?)?[\s.,]*$/i,
    /^[\s.,]*(?:subt[ií]tulos|subtitulado)[^\n]*$/i,
    /^[\s.,]*(?:you|thanks for watching)[\s.,]*$/i,
    // La misma palabra cuatro veces seguidas y nada más: `\1` necesita que el
    // grupo CAPTURE, y con `(?:…)` la expresión no comparaba nada y la red no
    // atajaba nunca.
    /^[\s.,¡!]*([^\s]+)(?:\s+\1){3,}[\s.,]*$/i
];

let servidor = null;
let apagadoPorOcio = null;

const espera = ms => new Promise(r => setTimeout(r, ms));

function puertoLibre() {
    return new Promise((resolve, reject) => {
        const s = net.createServer();
        s.unref();
        s.on('error', reject);
        s.listen(0, '127.0.0.1', () => {
            const { port } = s.address();
            s.close(() => resolve(port));
        });
    });
}

/** ¿Esta máquina puede dictar, y si no, qué le falta? */
function disponible() {
    const bin = paths.whisperServer();
    if (!bin.path) {
        return { ok: false, falta: 'whisper-server', motivo: 'Falta whisper-server. Mirá Diagnóstico.' };
    }
    const modelo = paths.modeloDictado();
    if (!modelo) {
        return { ok: false, falta: 'modelo', motivo: 'Falta el modelo de dictado (small). Mirá Diagnóstico.' };
    }
    return { ok: true, bin: bin.path, modelo };
}

/**
 * Levanta el servidor con el modelo cargado.
 *
 * No espera a que termine de cargar para devolver: la primera vez son unos
 * segundos y el botón lo dice, en vez de quedarse colgado sin explicación.
 */
function arrancar() {
    if (servidor) return servidor.cargando;

    const puede = disponible();
    if (!puede.ok) return Promise.resolve(false);

    const este = { hijo: null, puerto: null, listo: false, cargando: null, modelo: path.basename(puede.modelo) };
    servidor = este;

    este.cargando = (async () => {
        try {
            este.puerto = await puertoLibre();
            este.hijo = spawn(puede.bin, [
                '-m', puede.modelo,
                '--host', '127.0.0.1',
                '--port', String(este.puerto),
                '-l', 'es',
                // Sin arrastrar el texto de una pasada a la siguiente: el prompt
                // trabado repite, y acá cada pasada es el buffer entero de nuevo
                // así que el contexto no agrega nada.
                '-mc', '0',
                // Los ruidos (golpes, risas, el clic del mouse) sin tokens de
                // texto: sobre un pedazo de toc-toc, whisper escribe «Gracias.»
                '-sns'
            ], { stdio: ['ignore', 'ignore', 'pipe'] });

            este.hijo.stderr.on('data', () => {});
            // Que no quede vivo con el medio giga del modelo si la app se va sin
            // pasar por `apagar`.
            process.once('exit', () => { try { este.hijo.kill('SIGTERM'); } catch (e) { /* ya se fue */ } });
            este.hijo.on('exit', () => {
                este.listo = false;
                if (servidor === este) servidor = null;
            });

            const hasta = Date.now() + ARRANQUE_MAX_MS;
            while (Date.now() < hasta && servidor === este) {
                try {
                    const r = await fetch(`http://127.0.0.1:${este.puerto}/`, { signal: AbortSignal.timeout(1000) });
                    if (r.ok) { este.listo = true; return true; }
                } catch (e) { /* todavía cargando */ }
                await espera(250);
            }
            return false;
        } catch (e) {
            return false;
        }
    })();

    return este.cargando;
}

function listo() {
    return Boolean(servidor && servidor.listo);
}

function apagar() {
    clearTimeout(apagadoPorOcio);
    const este = servidor;
    servidor = null;
    if (este && este.hijo) {
        try { este.hijo.kill('SIGTERM'); } catch (e) { /* ya se fue */ }
    }
}

function posponerApagado() {
    clearTimeout(apagadoPorOcio);
    apagadoPorOcio = setTimeout(apagar, OCIO_MS);
}

// ─── El buffer de lo que se está diciendo ─────────────────────────────

let sesion = null;

/**
 * Arranca un dictado. Devuelve si el modelo ya está listo o si hay que esperar.
 */
async function empezar() {
    const puede = disponible();
    if (!puede.ok) return { ok: false, motivo: puede.motivo, falta: puede.falta };

    sesion = { trozos: [], muestras: 0, empezo: Date.now(), pico: 0 };
    const cargado = await arrancar();
    posponerApagado();
    return { ok: true, listo: cargado, modelo: servidor ? servidor.modelo : null };
}

/**
 * Un pedazo de audio que llegó de la ventana.
 *
 * @param {Buffer} buffer PCM s16le, 16 kHz, mono
 */
function trozo(buffer) {
    if (!sesion) return { ok: false };
    const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
    if (!bytes.length) return { ok: true, segundos: sesion.muestras / RATE };
    sesion.trozos.push(bytes);
    sesion.muestras += bytes.length / 2;
    return {
        ok: true,
        segundos: sesion.muestras / RATE,
        // Que se pase del tope lo decide quien llama, que es el que puede avisar.
        pasado: Date.now() - sesion.empezo > TOPE_MS
    };
}

/** El RMS de todo lo que se lleva dicho, en dBFS. */
function volumen(pcm) {
    if (!pcm.length) return -Infinity;
    let suma = 0;
    // Una muestra de cada cuatro: para decidir si hay voz o no, sobra, y sobre
    // treinta segundos de audio son 120.000 lecturas menos por refresco.
    let cuantas = 0;
    for (let i = 0; i + 1 < pcm.length; i += 8) {
        const v = pcm.readInt16LE(i) / 32768;
        suma += v * v;
        cuantas++;
    }
    if (!cuantas) return -Infinity;
    const rms = Math.sqrt(suma / cuantas);
    return rms > 0 ? 20 * Math.log10(rms) : -Infinity;
}

/** PCM crudo → un WAV que whisper-server acepte. */
function wav(pcm) {
    const cabecera = Buffer.alloc(44);
    cabecera.write('RIFF', 0);
    cabecera.writeUInt32LE(36 + pcm.length, 4);
    cabecera.write('WAVE', 8);
    cabecera.write('fmt ', 12);
    cabecera.writeUInt32LE(16, 16);
    cabecera.writeUInt16LE(1, 20); // PCM
    cabecera.writeUInt16LE(1, 22); // mono
    cabecera.writeUInt32LE(RATE, 24);
    cabecera.writeUInt32LE(RATE * 2, 28);
    cabecera.writeUInt16LE(2, 32);
    cabecera.writeUInt16LE(16, 34);
    cabecera.write('data', 36);
    cabecera.writeUInt32LE(pcm.length, 40);
    return Buffer.concat([cabecera, pcm]);
}

/** ¿Esto es una de las frases que Whisper inventa cuando no oyó nada? */
function inventada(texto) {
    const t = String(texto || '').trim();
    if (!t) return true;
    return INVENTADAS.some(re => re.test(t));
}

/**
 * Transcribe todo lo que se lleva dicho.
 *
 * Se llama cada segundo y medio mientras se habla (el texto en vivo) y una vez
 * más al parar. Es la misma función las dos veces a propósito: el texto final
 * no es la suma de los parciales, es el buffer completo leído una vez más — así
 * nunca queda cosido de pedazos.
 *
 * @returns {Promise<{ok:boolean, texto?:string, motivo?:string, segundos:number}>}
 */
async function transcribir(idioma) {
    if (!sesion) return { ok: false, motivo: 'no hay dictado abierto', segundos: 0 };
    const segundos = sesion.muestras / RATE;
    if (!listo()) return { ok: false, motivo: 'el modelo todavía está cargando', segundos };
    // Menos de medio segundo no es una palabra todavía.
    if (segundos < 0.5) return { ok: true, texto: '', segundos };

    const pcm = Buffer.concat(sesion.trozos);
    const db = volumen(pcm);
    sesion.pico = Math.max(sesion.pico, db);
    if (db < RMS_MINIMO_DBFS) {
        return {
            ok: true,
            texto: '',
            segundos,
            silencio: true,
            motivo: `entró audio pero está muy bajo (${db.toFixed(0)} dBFS)`
        };
    }

    const tmp = path.join(os.tmpdir(), `reviewer-dictado-${process.pid}.wav`);
    fs.writeFileSync(tmp, wav(pcm));

    try {
        const form = new FormData();
        form.append('file', new Blob([fs.readFileSync(tmp)], { type: 'audio/wav' }), 'dictado.wav');
        form.append('response_format', 'json');
        form.append('temperature', '0');
        form.append('language', idioma || 'es');
        const r = await fetch(`http://127.0.0.1:${servidor.puerto}/inference`, {
            method: 'POST', body: form, signal: AbortSignal.timeout(PASADA_MAX_MS)
        });
        if (!r.ok) throw new Error(`whisper-server contestó ${r.status}`);
        const dicho = await r.json();
        posponerApagado();
        const texto = String(dicho.text || '').trim();
        if (inventada(texto)) return { ok: true, texto: '', segundos, silencio: true };
        return { ok: true, texto, segundos };
    } catch (e) {
        return { ok: false, motivo: e.message, segundos };
    } finally {
        try { fs.unlinkSync(tmp); } catch (e) { /* ya no estaba */ }
    }
}

/** Cierra el dictado y devuelve el buffer para una última lectura. */
function cerrar() {
    const vieja = sesion;
    sesion = null;
    posponerApagado();
    return vieja ? { segundos: vieja.muestras / RATE, pico: vieja.pico } : { segundos: 0, pico: 0 };
}

module.exports = {
    RATE,
    RMS_MINIMO_DBFS,
    TOPE_MS,
    OCIO_MS,
    INVENTADAS,
    disponible,
    arrancar,
    listo,
    apagar,
    empezar,
    trozo,
    transcribir,
    cerrar,
    volumen,
    wav,
    inventada
};
