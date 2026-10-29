'use strict';
/**
 * frames.js — El cuadro exacto del que habla un comentario, sacado del render
 * de verdad.
 *
 * Tres cosas que importan acá:
 *
 * 1. **Del original y no del proxy.** El proxy puede estar escalado a 1920 y
 *    recomprimido; el PNG que va a mirar Claude tiene que ser el render que el
 *    editor entregó.
 * 2. **El cuadro que se está viendo, no el de al lado.** `-ss` busca al
 *    keyframe más cercano y después avanza; con `-accurate_seek` (que es el
 *    default cuando `-ss` va antes de `-i`) ffmpeg decodifica hasta el instante
 *    pedido. Se le pide el comienzo del cuadro calculado por `tiempo.js` y no
 *    el segundo crudo: así el PNG y el número de cuadro que dice el texto son
 *    el mismo.
 * 3. **El nombre lleva el timecode.** `c01-00h01m23s12f.png` se entiende sin
 *    abrirlo y sin el JSON al lado, que es lo que hace falta cuando alguien
 *    recibe la carpeta por Drive.
 */

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const paths = require('./paths');
const tiempo = require('./tiempo');
const workspace = require('./workspace');

/** El nombre del PNG de un comentario. */
function nombreDe(id, segundos, fps) {
    return `${id}-${tiempo.paraNombre(segundos, fps)}.png`;
}

function correr(bin, args) {
    return new Promise((resolve, reject) => {
        execFile(bin, args, { maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
            if (err) return reject(new Error((stderr || err.message || '').trim().split('\n').pop()));
            resolve(stdout);
        });
    });
}

/**
 * Saca el cuadro de un instante y lo deja en `frames/`.
 *
 * @param {string} rutaVideo el ORIGINAL
 * @param {{id:string, t:number, fps:number}} donde
 * @returns {Promise<{ok:boolean, relativa?:string, absoluta?:string, error?:string}>}
 */
async function sacar(rutaVideo, donde) {
    const tool = paths.ffmpeg();
    if (!tool.path) {
        return { ok: false, error: 'Falta ffmpeg: no se puede guardar el cuadro (mirá Diagnóstico).' };
    }

    const archivos = workspace.asegurarCarpeta(rutaVideo);
    workspace.ensureDir(archivos.frames);

    const nombre = nombreDe(donde.id, donde.t, donde.fps);
    const absoluta = path.join(archivos.frames, nombre);
    const relativa = path.join(workspace.FRAMES_DIR, nombre);
    if (!workspace.dentroDe(archivos.carpeta, absoluta)) {
        return { ok: false, error: 'Ese cuadro cae fuera de la carpeta.' };
    }

    // El comienzo del cuadro, no el instante donde quedó el cabezal: pedir
    // 83.44 s y escribir "cuadro 2500" tiene que dar la misma imagen.
    const instante = tiempo.segundosDe(tiempo.cuadroDe(donde.t, donde.fps), donde.fps);
    const tmp = `${absoluta}.tmp-${process.pid}.png`;

    try {
        await correr(tool.path, [
            '-nostdin', '-hide_banner', '-v', 'error', '-y',
            '-ss', instante.toFixed(6),
            '-i', rutaVideo,
            '-frames:v', '1',
            // El cuadro con la proporción con la que se ve: un render
            // anamórfico guardado con sus píxeles sale estirado y el que lo
            // mira cree que así salió la edición.
            '-vf', 'scale=iw*sar:ih',
            tmp
        ]);
        fs.renameSync(tmp, absoluta);
    } catch (e) {
        try { fs.unlinkSync(tmp); } catch (err) { /* ya no estaba */ }
        return { ok: false, error: e.message || 'ffmpeg no pudo sacar el cuadro.' };
    }

    return { ok: true, relativa, absoluta };
}

/**
 * Pega el trazo que dibujó la ventana sobre el cuadro limpio que sacó `sacar`.
 *
 * **La ventana manda el trazo solo, con el fondo transparente, y el fondo lo
 * pone ffmpeg.** Antes lo componía el canvas entero: tomaba el cuadro del
 * `<video>` con `drawImage` y le pintaba el trazo encima. Eso tenía dos
 * problemas, y el segundo no se veía venir.
 *
 * El primero es que el cuadro del `<video>` puede ser el del PROXY —escalado a
 * 1920 y recomprimido—, así que el dibujo terminaba sobre una imagen que no es
 * la que entregó el editor.
 *
 * El segundo es que `drawImage` sobre un `<video>` devuelve transparente cuando
 * la ventana no está componiendo —de fondo, tapada, o con el cuadro todavía sin
 * presentar—. No tira: devuelve un canvas vacío. El PNG salía con el trazo rojo
 * flotando sobre nada, que es justo la imagen que no sirve para contestar un
 * comentario sobre un encuadre, y nada en la app lo decía.
 *
 * Componer acá no cambia cómo se ve el trazo: lo dibujó el mismo `pintarEn` de
 * la ventana y llega ya rasterizado a la resolución del render. Lo único que
 * cambia es qué hay debajo.
 */
async function guardarDibujo(rutaVideo, donde, bytes, rutaCuadro) {
    const archivos = workspace.asegurarCarpeta(rutaVideo);
    workspace.ensureDir(archivos.dibujos);

    const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
    if (!buffer.length) throw new Error('El dibujo llegó vacío.');
    // Un PNG de un cuadro 4K con trazos ronda los 8 MB; 24 es el techo por si
    // algo manda cualquier cosa por el puente.
    if (buffer.length > 24 * 1024 * 1024) throw new Error('Ese dibujo pesa demasiado para ser un cuadro.');
    if (!rutaCuadro || !fs.existsSync(rutaCuadro)) throw new Error('No está el cuadro sobre el que pegarlo.');

    const tool = paths.ffmpeg();
    if (!tool.path) throw new Error('Falta ffmpeg: no se puede componer el dibujo.');

    const nombre = nombreDe(donde.id, donde.t, donde.fps);
    const absoluta = path.join(archivos.dibujos, nombre);
    if (!workspace.dentroDe(archivos.carpeta, absoluta)) throw new Error('Ese dibujo cae fuera de la carpeta.');

    const capa = path.join(archivos.dibujos, `.trazo-${process.pid}-${donde.id}.png`);
    const tmp = `${absoluta}.tmp-${process.pid}.png`;
    try {
        fs.writeFileSync(capa, buffer);
        await correr(tool.path, [
            '-nostdin', '-hide_banner', '-v', 'error', '-y',
            '-i', rutaCuadro,
            '-i', capa,
            // La capa llega a la resolución del render, pero si el cuadro salió
            // con la corrección de SAR puede medir distinto por un píxel: se
            // escala a lo que mida el cuadro antes de pegarla.
            '-filter_complex', '[1:v]scale=rw:rh[capa];[0:v][capa]overlay=0:0',
            '-frames:v', '1',
            tmp
        ]);
        fs.renameSync(tmp, absoluta);
    } finally {
        for (const sobra of [capa, tmp]) {
            try { fs.unlinkSync(sobra); } catch (e) { /* ya no estaba */ }
        }
    }

    return { relativa: path.join(workspace.DIBUJOS_DIR, nombre), absoluta };
}

module.exports = { nombreDe, sacar, guardarDibujo };
