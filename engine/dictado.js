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
 * 2. **El audio se entrega a medida que entra y no se vuelve atrás.** El modelo
 *    es un transductor con caché: guarda su propio estado, así que cada trozo
 *    cuesta lo que dura ese trozo y nada más. Alimentarle medio segundo de
 *    audio lleva 29 ms, que es por qué el texto aparece mientras se habla.
 * 3. **El modelo queda cargado** entre un dictado y el siguiente, y se suelta
 *    después de cinco minutos sin usarse.
 *
 * **Por qué este modelo y no Whisper.** Hasta la 0.1.20 esto era un
 * `whisper-server` aparte con `ggml-small.bin`, y tenía dos problemas que se
 * sentían al usarlo. El primero es que Whisper no trocea: cada refresco
 * retranscribía el buffer ENTERO, así que el costo crecía con lo que llevabas
 * dicho y había que esperar a que el servidor levantara —hasta un minuto la
 * primera vez—. El segundo es que sobre el silencio inventa: un segundo de sala
 * callada volvía como «¡Suscríbete!» o «Gracias por ver el video», que son las
 * frases más repetidas en los subtítulos con los que se entrenó. Había una
 * compuerta de volumen y una lista negra de frases para atajarlo, y aun así se
 * colaban. Nemotron devuelve la cadena vacía sobre el silencio, así que la
 * lista negra no existe más.
 *
 * **La puntuación no la pone el modelo.** Nemotron devuelve el español en
 * minúscula y corrido. La puntuación y las mayúsculas las pone después el
 * modelo de lenguaje, en `src/js/dictado.js`, que es exactamente lo que hace
 * Handy con este mismo modelo. El paso es a prueba de fallos: si el modelo de
 * lenguaje no está, queda el texto como se dijo.
 */

const path = require('path');

const paths = require('./paths');

/** 16 kHz mono es lo que el modelo quiere; mandarle otra cosa es resamplear dos veces. */
const RATE = 16000;

/**
 * El idioma de Ajustes → el locale que el modelo pide.
 *
 * Es obligatorio y tiene que ser un locale entero: `es` suelto devuelve
 * «unsupported language». `auto` existe pero elige por audio y sobre una
 * frase corta se equivoca, y acá el idioma ya está elegido en Ajustes.
 */
const LOCALES = { es: 'es-ES', en: 'en-US' };

/** Sin usarse, el modelo se suelta: 751 MB al lado de un reproductor. */
const OCIO_MS = 5 * 60 * 1000;

/** Un dictado se corta solo: para un comentario, cinco minutos es muchísimo. */
const TOPE_MS = 5 * 60 * 1000;

/**
 * Por debajo de esto, lo que entró no era voz.
 *
 * Ya no decide si se llama al modelo —el modelo se banca el silencio— pero
 * sigue sirviendo para lo único que importaba del número: poder decir «entró
 * audio pero está muy bajo» en vez de «no se entendió nada», que son dos
 * problemas distintos y se arreglan distinto.
 *
 * El número salió de medir con el micrófono de la MacBook en HyperPremiere: la
 * sala callada está entre −44 y −37 dBFS y el habla llega en −21.
 */
const RMS_MINIMO_DBFS = -34;

/** Cómo se llama el modelo cuando hay que nombrarlo en pantalla. */
const NOMBRE = 'Nemotron 3.5';

let motor = null;
let cargado = null;
let cargando = null;
let ultimoFallo = null;
let apagadoPorOcio = null;
let sesion = null;

/**
 * La librería del motor, importada la primera vez que se dicta.
 *
 * Es un `import()` adentro de una función y no un `require` arriba, por dos
 * razones que no son de estilo. La primera es que `transcribe-cpp` solo publica
 * la condición `import` en su `exports`, así que un `require` falla con
 * `ERR_PACKAGE_PATH_NOT_EXPORTED` y no hay forma de traerlo de otra manera
 * desde un archivo CommonJS. La segunda es que importarlo abre la librería
 * nativa y arranca Metal, que la primera vez en una Mac compila sus shaders y
 * tarda casi cuatro segundos: pagarlo al abrir la app, para una función que
 * quizá no se use, sería cobrarle el dictado a todo el mundo.
 */
async function libreria() {
    if (!motor) motor = await import('transcribe-cpp');
    return motor;
}

/** ¿Esta máquina puede dictar, y si no, qué le falta? */
function disponible() {
    const modelo = paths.modeloDictado();
    if (!modelo) {
        return { ok: false, falta: 'modelo-dictado', motivo: `Falta el modelo de dictado (${NOMBRE}). Mirá Diagnóstico.` };
    }
    return { ok: true, modelo };
}

/**
 * Carga el modelo y deja una sesión abierta.
 *
 * La promesa se comparte: dos dictados seguidos mientras todavía carga esperan
 * al mismo trabajo en vez de cargar el modelo dos veces.
 */
function arrancar() {
    if (cargado) return Promise.resolve(true);
    if (cargando) return cargando;

    const puede = disponible();
    if (!puede.ok) return Promise.resolve(false);

    cargando = (async () => {
        try {
            const { TranscribeModel } = await libreria();
            const modelo = await TranscribeModel.load(puede.modelo);
            cargado = { modelo, sesion: modelo.createSession() };
            ultimoFallo = null;
            return true;
        } catch (e) {
            ultimoFallo = e.message;
            return false;
        } finally {
            cargando = null;
        }
    })();

    return cargando;
}

function listo() {
    return Boolean(cargado);
}

function apagar() {
    clearTimeout(apagadoPorOcio);
    const este = cargado;
    cargado = null;
    if (!este) return;
    try { este.sesion.dispose(); } catch (e) { /* ya estaba suelta */ }
    try { este.modelo.dispose(); } catch (e) { /* ya estaba suelto */ }
}

function posponerApagado() {
    clearTimeout(apagadoPorOcio);
    apagadoPorOcio = setTimeout(apagar, OCIO_MS);
    if (apagadoPorOcio.unref) apagadoPorOcio.unref();
}

// ─── El dictado abierto ───────────────────────────────────────────────

/** PCM de 16 bits con signo → las muestras entre −1 y 1 que el modelo lee. */
function aMuestras(bytes) {
    const cuantas = bytes.length >> 1;
    const muestras = new Float32Array(cuantas);
    for (let i = 0; i < cuantas; i++) muestras[i] = bytes.readInt16LE(i * 2) / 32768;
    return muestras;
}

function unir(trozos) {
    if (trozos.length === 1) return trozos[0];
    const total = trozos.reduce((n, t) => n + t.length, 0);
    const juntos = new Float32Array(total);
    let i = 0;
    for (const t of trozos) { juntos.set(t, i); i += t.length; }
    return juntos;
}

/**
 * Le entrega al modelo lo que haya llegado, de a una cuenta por vez.
 *
 * El micrófono manda un trozo cada pocas decenas de milisegundos y el modelo
 * acepta UNA sola cuenta a la vez: sin esta cola, el segundo trozo llegaría
 * mientras el primero todavía se procesa. Se entregan juntos los que se hayan
 * acumulado, que es más barato que uno por uno y da el mismo texto.
 */
function drenar() {
    const esta = sesion;
    if (!esta || !esta.stream || !esta.pendiente.length) return null;
    if (esta.drenando) return esta.drenando;

    esta.drenando = (async () => {
        try {
            while (esta.pendiente.length && sesion === esta) {
                await esta.stream.feed(unir(esta.pendiente.splice(0)));
            }
        } catch (e) {
            esta.error = e.message;
            esta.pendiente.length = 0;
        } finally {
            esta.drenando = null;
        }
    })();

    return esta.drenando;
}

/** Espera a que el modelo tenga adentro todo lo que se dijo hasta ahora. */
async function alDia(esta) {
    while (esta.stream && !esta.error && (esta.drenando || esta.pendiente.length)) {
        await (esta.drenando || drenar());
    }
}

/**
 * Abre el stream en cuanto el modelo esté, y suelta lo que se juntó esperando.
 *
 * Que esto NO se espere es a propósito: el micrófono se abre al instante y lo
 * que se diga mientras el modelo carga queda guardado en `pendiente`, así que
 * la primera frase no se pierde aunque sea la primera vez que se dicta en esta
 * Mac —que es la vez que tarda, porque Metal compila sus shaders.
 */
async function abrir(esta) {
    if (!await arrancar()) {
        if (sesion === esta) esta.error = ultimoFallo || 'no se pudo cargar el modelo de voz';
        return;
    }
    if (sesion !== esta) return;
    try {
        esta.stream = await cargado.sesion.stream({ language: esta.locale });
    } catch (e) {
        if (sesion === esta) esta.error = e.message;
        return;
    }
    if (sesion !== esta) { try { esta.stream.reset(); } catch (e) { /* ya se cerró */ } return; }
    drenar();
}

/** Arranca un dictado. Dice si el modelo ya estaba listo o si hay que esperarlo. */
function empezar(idioma) {
    const puede = disponible();
    if (!puede.ok) return { ok: false, motivo: puede.motivo, falta: puede.falta };

    const estaba = listo();
    sesion = {
        locale: LOCALES[idioma] || LOCALES.es,
        pendiente: [],
        muestras: 0,
        empezo: Date.now(),
        pico: -Infinity,
        stream: null,
        drenando: null,
        error: null
    };
    abrir(sesion);
    posponerApagado();
    return { ok: true, listo: estaba, modelo: NOMBRE };
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

    const db = volumen(bytes);
    if (db > sesion.pico) sesion.pico = db;
    sesion.pendiente.push(aMuestras(bytes));
    sesion.muestras += bytes.length / 2;
    drenar();

    return {
        ok: true,
        segundos: sesion.muestras / RATE,
        // Que se pase del tope lo decide quien llama, que es el que puede avisar.
        pasado: Date.now() - sesion.empezo > TOPE_MS
    };
}

/** El RMS de un pedazo de audio, en dBFS. */
function volumen(pcm) {
    if (!pcm.length) return -Infinity;
    let suma = 0;
    // Una muestra de cada cuatro: para decidir si hay voz o no, sobra.
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

/**
 * Lo que el modelo lleva entendido.
 *
 * Se llama cada segundo y medio mientras se habla y una vez más al parar, con
 * `final` puesto. No transcribe: el texto ya está adentro del modelo, porque lo
 * fue armando con cada trozo. Lo único que hace `final` es cerrar el stream
 * para que suelte la última palabra, que hasta ese momento todavía podía
 * cambiar.
 *
 * @returns {Promise<{ok:boolean, texto?:string, motivo?:string, segundos:number}>}
 */
async function transcribir({ final = false } = {}) {
    const esta = sesion;
    if (!esta) return { ok: false, motivo: 'no hay dictado abierto', segundos: 0 };

    const segundos = esta.muestras / RATE;
    if (esta.error) return { ok: false, motivo: esta.error, segundos };
    if (!esta.stream) return { ok: true, texto: '', segundos, cargando: true };

    await alDia(esta);
    if (sesion !== esta) return { ok: false, motivo: 'el dictado se cerró', segundos };
    if (esta.error) return { ok: false, motivo: esta.error, segundos };

    if (final) {
        try {
            await esta.stream.finalize();
        } catch (e) {
            return { ok: false, motivo: e.message, segundos };
        }
    }

    posponerApagado();
    const texto = String(esta.stream.text.full || '').trim();
    if (texto) return { ok: true, texto, segundos };

    // Sin texto hay tres historias distintas, y se arreglan distinto: un
    // micrófono mudo se cambia en Ajustes, uno bajo se sube, y el tercero —el
    // modelo oyó bien y no era habla— no se arregla, se vuelve a decir.
    if (!Number.isFinite(esta.pico)) {
        return { ok: true, texto: '', segundos, silencio: true, motivo: 'el micrófono no está mandando nada' };
    }
    if (esta.pico < RMS_MINIMO_DBFS) {
        return { ok: true, texto: '', segundos, silencio: true, motivo: `entró audio pero está muy bajo (${Math.round(esta.pico)} dBFS)` };
    }
    return { ok: true, texto: '', segundos, silencio: true };
}

/** Cierra el dictado. El modelo queda cargado para el siguiente. */
function cerrar() {
    const vieja = sesion;
    sesion = null;
    posponerApagado();
    if (!vieja) return { segundos: 0, pico: 0 };
    if (vieja.stream) {
        try { vieja.stream.reset(); } catch (e) { /* ya estaba cerrado */ }
    }
    return {
        segundos: vieja.muestras / RATE,
        pico: Number.isFinite(vieja.pico) ? vieja.pico : 0
    };
}

module.exports = {
    RATE,
    LOCALES,
    NOMBRE,
    RMS_MINIMO_DBFS,
    TOPE_MS,
    OCIO_MS,
    disponible,
    arrancar,
    listo,
    apagar,
    empezar,
    trozo,
    transcribir,
    cerrar,
    volumen
};
