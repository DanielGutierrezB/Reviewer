'use strict';
/**
 * media-probe.js — Qué es cada render, medido con ffprobe.
 *
 * De acá salen las cuatro cosas de las que depende todo lo demás:
 *
 * - **Los cuadros por segundo reales**, que son los que convierten un segundo en
 *   un número de cuadro y en un timecode. Un render a 29.97 contado como 30 se
 *   corre un cuadro cada 33 segundos: a los diez minutos, el comentario apunta
 *   a otro plano.
 * - **El codec**, que decide si el reproductor puede con el archivo o si hay que
 *   armarle un proxy (`proxy.js`).
 * - **El tamaño**, que dice si es 16:9 o 9:16 y a qué resolución hay que componer
 *   el dibujo para que el PNG sea del tamaño del video y no del de la ventana.
 * - **La duración**, para la barra de tiempo.
 *
 * Nunca lanza: el fallo viaja en `error`. Una carpeta con un archivo corrupto
 * tiene que abrirse igual, con ese archivo marcado.
 */

const { execFile } = require('child_process');

const paths = require('./paths');

const CONCURRENCIA = 4;

function run(bin, args) {
    return new Promise((resolve, reject) => {
        execFile(bin, args, { maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
            // ffprobe escribe el motivo en stderr y a veces cierra con 0 igual,
            // así que se miran los dos lados antes de decidir que falló.
            if (err) return reject(new Error((stderr || err.message || '').trim()));
            resolve(stdout);
        });
    });
}

/** `30000/1001` → `{ num, den, value }`. */
function parseRate(text) {
    if (!text) return null;
    const [num, den] = String(text).split('/');
    const n = parseFloat(num);
    const d = den == null ? 1 : parseFloat(den);
    if (!n || !d) return null;
    return { num: n, den: d, value: n / d };
}

/**
 * De qué campo salen los cuadros por segundo.
 *
 * `r_frame_rate` y no `avg_frame_rate`: el promedio de un render con un cuadro
 * duplicado al final da 29.9712 y cosas así, y ese número escrito en un
 * timecode no vuelve a dar el mismo cuadro. `r_frame_rate` es el de la
 * cabecera, que es el que el editor tiene puesto en su secuencia.
 */
function fpsDe(video) {
    const r = parseRate(video && video.r_frame_rate);
    if (r && r.value > 0 && r.value < 1000) return r;
    const avg = parseRate(video && video.avg_frame_rate);
    if (avg && avg.value > 0 && avg.value < 1000) return avg;
    return { num: 25, den: 1, value: 25 };
}

/**
 * Un archivo → lo que Reviewer necesita saber de él.
 *
 * @returns {Promise<object>} siempre resuelve; mirá `ok`
 */
async function medir(filePath) {
    const tool = paths.ffprobe();
    if (!tool.path) {
        return { ruta: filePath, ok: false, error: 'Falta ffprobe (mirá Diagnóstico).' };
    }

    let raw;
    try {
        raw = await run(tool.path, [
            '-v', 'error',
            '-print_format', 'json',
            '-show_format',
            '-show_streams',
            filePath
        ]);
    } catch (e) {
        return { ruta: filePath, ok: false, error: e.message || 'ffprobe no pudo leer el archivo.' };
    }

    let data;
    try {
        data = JSON.parse(raw);
    } catch (e) {
        return { ruta: filePath, ok: false, error: 'ffprobe devolvió algo que no se pudo leer.' };
    }

    const streams = data.streams || [];
    const video = streams.find(s => s.codec_type === 'video') || null;
    const audio = streams.find(s => s.codec_type === 'audio') || null;
    if (!video) {
        return { ruta: filePath, ok: false, error: 'El archivo no tiene pista de video.' };
    }

    const fps = fpsDe(video);
    const duracion = parseFloat((data.format && data.format.duration) || video.duration || 0) || 0;
    // El tamaño con el que se MUESTRA, no el de los píxeles: un render anamórfico
    // tiene 1440x1080 de píxeles y 1920x1080 de imagen, y el dibujo tiene que
    // caer sobre lo que el editor ve.
    const sar = parseRate(video.sample_aspect_ratio);
    const ancho = Number(video.width) || 0;
    const alto = Number(video.height) || 0;
    const anchoReal = sar && sar.value && sar.value !== 1 ? Math.round(ancho * sar.value) : ancho;

    return {
        ruta: filePath,
        ok: true,
        codec: video.codec_name || null,
        perfil: video.profile || null,
        pixFmt: video.pix_fmt || null,
        ancho,
        alto,
        anchoReal,
        vertical: alto > anchoReal,
        fps: fps.value,
        fpsNum: fps.num,
        fpsDen: fps.den,
        duracion,
        cuadros: Math.max(1, Math.round(duracion * fps.value)),
        contenedor: (data.format && data.format.format_name) || null,
        bytes: Number(data.format && data.format.size) || 0,
        conAudio: Boolean(audio),
        audioCodec: audio ? audio.codec_name : null
    };
}

/** Varios a la vez, de a cuatro: treinta renders en serie son treinta esperas. */
async function medirVarios(rutas) {
    const pendientes = [...rutas];
    const resultados = new Map();

    async function obrero() {
        for (;;) {
            const ruta = pendientes.shift();
            if (!ruta) return;
            resultados.set(ruta, await medir(ruta));
        }
    }

    await Promise.all(Array.from({ length: Math.min(CONCURRENCIA, rutas.length) }, obrero));
    return rutas.map(r => resultados.get(r));
}

module.exports = { medir, medirVarios, parseRate, fpsDe, CONCURRENCIA };
