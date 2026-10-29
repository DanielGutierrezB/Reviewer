'use strict';
/**
 * proxy.js — Lo que el reproductor no puede abrir, convertido una vez.
 *
 * El editor pidió que la herramienta reproduzca cualquier codec. Chromium no:
 * de lo que sale de una timeline entiende H.264, VP8/VP9 y AV1, y se queda en
 * negro con ProRes, DNxHD, HEVC de 10 bits y todo lo que un render "bueno"
 * suele ser. No avisa, además: el `<video>` carga, dura lo que tiene que durar
 * y no muestra un cuadro.
 *
 * Así que lo que no entiende se convierte una vez a H.264 y se reproduce la
 * copia. Tres decisiones:
 *
 * 1. **El proxy NO va al lado del render.** Va a la caché de la app. La carpeta
 *    del editor es lo que él mira y lo que le pasa a otra persona; llenarla de
 *    copias de 300 MB que la app sabe rehacer sería ensuciar lo único que este
 *    programa promete no tocar.
 * 2. **Los cuadros salen del ORIGINAL, no del proxy.** El PNG que va a ver
 *    Claude tiene que ser el render de verdad, con su color y su resolución. El
 *    proxy es para mirar, no para citar.
 * 3. **La clave de caché lleva tamaño y fecha del original.** Un render que se
 *    reemplazó por otro con el mismo nombre —que es exactamente lo que hace
 *    Claude al rehacer una versión— tiene que invalidar su proxy; si la clave
 *    fuera solo la ruta, el editor estaría revisando el video de ayer.
 *
 * Se escala a 1920 de ancho como mucho: el proxy es para mirar la edición, no
 * para evaluar la compresión, y un 4K de ProRes convertido a 4K H.264 tarda
 * cuatro veces más por una diferencia que en la ventana no se ve.
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const paths = require('./paths');

/**
 * Los codecs que el reproductor abre sin ayuda.
 *
 * H.265/HEVC no está, y es el que más duele: macOS lo decodifica por hardware y
 * Safari lo reproduce, pero el Chromium de Electron no trae el decodificador
 * por licencia. Un render de iPhone o de Resolve en HEVC entra acá y se
 * convierte, que es lento pero visible, en vez de quedar en negro.
 */
const NATIVOS = new Set(['h264', 'vp8', 'vp9', 'av1', 'theora']);

/** Y los de audio, por lo mismo: un video que anda sin sonido también falla. */
const AUDIO_NATIVO = new Set(['aac', 'mp3', 'opus', 'vorbis', 'flac']);

const ANCHO_MAXIMO = 1920;

function carpetaCache() {
    return path.join(os.homedir(), 'Library', 'Caches', 'Reviewer', 'proxies');
}

/**
 * ¿Hace falta convertir este archivo, y por qué?
 *
 * El motivo se devuelve escrito porque es lo que la ventana muestra mientras
 * convierte. "Preparando el video…" sin decir por qué es una espera inexplicable
 * de tres minutos; "ProRes no se puede reproducir directo, preparando una copia"
 * es una espera que se entiende.
 *
 * @param {object} media lo que devolvió `media-probe.medir`
 * @returns {{hace:boolean, motivo:string|null}}
 */
function haceFalta(media) {
    if (!media || !media.ok) return { hace: false, motivo: null };

    if (!NATIVOS.has(media.codec)) {
        return { hace: true, motivo: `El reproductor no abre ${(media.codec || 'ese codec').toUpperCase()} directo` };
    }
    // H.264 de 10 bits (`yuv420p10le`, `yuv422p`) es H.264 y no se reproduce
    // igual: Chromium solo trae el perfil de 8 bits y 4:2:0.
    if (media.pixFmt && !/^yuvj?420p$/.test(media.pixFmt)) {
        return { hace: true, motivo: `El reproductor no abre ${media.codec.toUpperCase()} en ${media.pixFmt}` };
    }
    if (media.conAudio && !AUDIO_NATIVO.has(media.audioCodec)) {
        return { hace: true, motivo: `El reproductor no abre el audio en ${(media.audioCodec || '?').toUpperCase()}` };
    }
    return { hace: false, motivo: null };
}

/**
 * Dónde va el proxy de un archivo.
 *
 * El nombre lleva el del original por delante para que la carpeta de caché se
 * pueda mirar y entender; el hash es lo que la hace correcta.
 */
function rutaDeProxy(rutaOriginal) {
    let st;
    try {
        st = fs.statSync(rutaOriginal);
    } catch (e) {
        return null;
    }
    const huella = crypto
        .createHash('sha1')
        .update(`${path.resolve(rutaOriginal)}|${st.size}|${Math.round(st.mtimeMs)}`)
        .digest('hex')
        .slice(0, 12);
    const base = path.basename(rutaOriginal, path.extname(rutaOriginal)).slice(0, 60);
    return path.join(carpetaCache(), `${base}-${huella}.mp4`);
}

/** El proxy ya hecho, si está. */
function yaHecho(rutaOriginal) {
    const destino = rutaDeProxy(rutaOriginal);
    if (!destino) return null;
    try {
        // Un `.mp4` de cero bytes es una conversión que se cortó a la mitad: no
        // cuenta como hecha. El temporal evita el caso normal, pero un disco
        // lleno puede dejarlo igual.
        return fs.statSync(destino).size > 0 ? destino : null;
    } catch (e) {
        return null;
    }
}

function argumentos(origen, destino, media) {
    const escala = media && media.anchoReal > ANCHO_MAXIMO
        // `-2` deja que ffmpeg elija el alto par que mantiene la proporción: un
        // alto impar no es codificable en yuv420p y la conversión falla al final,
        // después de haber tardado los tres minutos.
        ? ['-vf', `scale=${ANCHO_MAXIMO}:-2`]
        : [];

    return [
        '-nostdin',
        '-hide_banner',
        '-v', 'error',
        '-progress', 'pipe:1',
        '-y',
        '-i', origen,
        ...escala,
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-crf', '20',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-b:a', '160k',
        // Sin esto el índice queda al final y el reproductor tiene que
        // descargar el archivo entero antes de mostrar el primer cuadro.
        '-movflags', '+faststart',
        destino
    ];
}

const corriendo = new Map();

/**
 * Arma el proxy de un archivo, o devuelve el que ya estaba.
 *
 * @param {string} rutaOriginal
 * @param {object} media lo de `media-probe`
 * @param {(pct:number)=>void} [alAvanzar] 0..1
 * @returns {Promise<{ok:boolean, ruta?:string, error?:string, reusado?:boolean}>}
 */
function armar(rutaOriginal, media, alAvanzar) {
    const hecho = yaHecho(rutaOriginal);
    if (hecho) return Promise.resolve({ ok: true, ruta: hecho, reusado: true });

    // Dos pedidos del mismo archivo —el editor que cambia de versión y vuelve—
    // esperan la misma conversión en vez de arrancar dos ffmpeg sobre el mismo
    // destino, que es como se corrompe un archivo.
    if (corriendo.has(rutaOriginal)) return corriendo.get(rutaOriginal);

    const tool = paths.ffmpeg();
    if (!tool.path) {
        return Promise.resolve({ ok: false, error: 'Falta ffmpeg: no se puede preparar este video (mirá Diagnóstico).' });
    }

    const destino = rutaDeProxy(rutaOriginal);
    if (!destino) {
        return Promise.resolve({ ok: false, error: 'Ese archivo ya no está en el disco.' });
    }

    const tarea = new Promise(resolve => {
        fs.mkdirSync(path.dirname(destino), { recursive: true });
        // A un temporal y después rename, como todo lo que esta app escribe: un
        // ffmpeg interrumpido no puede dejar en la caché medio video que la
        // próxima sesión daría por bueno.
        const tmp = `${destino}.tmp-${process.pid}.mp4`;
        const duracion = (media && media.duracion) || 0;
        const hijo = spawn(tool.path, argumentos(rutaOriginal, tmp, media), { stdio: ['ignore', 'pipe', 'pipe'] });

        let error = '';
        hijo.stderr.on('data', b => { error += b.toString(); });
        hijo.stdout.on('data', b => {
            if (!alAvanzar || !duracion) return;
            // `-progress` escribe `out_time_us=12345678` cada medio segundo.
            const m = /out_time_us=(\d+)/.exec(b.toString());
            if (m) alAvanzar(Math.min(1, (Number(m[1]) / 1e6) / duracion));
        });

        hijo.on('error', e => {
            corriendo.delete(rutaOriginal);
            resolve({ ok: false, error: e.message });
        });

        hijo.on('close', code => {
            corriendo.delete(rutaOriginal);
            if (code !== 0) {
                try { fs.unlinkSync(tmp); } catch (e) { /* ya no estaba */ }
                return resolve({ ok: false, error: (error.trim().split('\n').pop() || `ffmpeg cerró con ${code}`) });
            }
            try {
                fs.renameSync(tmp, destino);
            } catch (e) {
                return resolve({ ok: false, error: e.message });
            }
            if (alAvanzar) alAvanzar(1);
            resolve({ ok: true, ruta: destino, reusado: false });
        });
    });

    corriendo.set(rutaOriginal, tarea);
    return tarea;
}

/**
 * Cuánto ocupa la caché y de cuántos archivos, para Ajustes.
 */
function peso() {
    let bytes = 0;
    let archivos = 0;
    try {
        for (const name of fs.readdirSync(carpetaCache())) {
            try {
                bytes += fs.statSync(path.join(carpetaCache(), name)).size;
                archivos++;
            } catch (e) { /* se lo llevaron mientras mirábamos */ }
        }
    } catch (e) { /* no hay caché todavía */ }
    return { bytes, archivos };
}

/** Vaciar la caché. Nunca pierde nada: los proxies se rehacen solos. */
function vaciar() {
    try {
        fs.rmSync(carpetaCache(), { recursive: true, force: true });
        return { ok: true };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

module.exports = {
    NATIVOS,
    AUDIO_NATIVO,
    ANCHO_MAXIMO,
    carpetaCache,
    haceFalta,
    rutaDeProxy,
    yaHecho,
    argumentos,
    armar,
    peso,
    vaciar
};
