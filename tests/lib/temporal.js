'use strict';
/**
 * tests/lib/temporal.js — Carpetas de mentira para probar lo que escribe en
 * disco.
 *
 * Todo cae en `tests/tmp/`, que está en el `.gitignore` y se borra al empezar
 * cada corrida: un test que falla deja su carpeta para poder mirarla, y la
 * siguiente corrida la limpia.
 */

const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..', 'tmp');

let contador = 0;

/** Una carpeta vacía, propia de este test. */
function carpeta(nombre) {
    const dir = path.join(RAIZ, `${nombre}-${process.pid}-${contador++}`);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

/**
 * Un archivo con contenido cualquiera, para que exista.
 *
 * No es un video de verdad: los tests que tocan ffprobe le pasan el `media` a
 * mano, porque lo que se prueba acá es la agrupación y lo que se escribe, no
 * que ffprobe sepa medir.
 */
function archivo(dir, nombre, contenido) {
    const ruta = path.join(dir, nombre);
    fs.mkdirSync(path.dirname(ruta), { recursive: true });
    fs.writeFileSync(ruta, contenido == null ? 'x' : contenido);
    return ruta;
}

/** El `media` que devolvería ffprobe, con lo que haga falta cambiado. */
function media(cambios) {
    return {
        ok: true,
        codec: 'h264',
        perfil: 'High',
        pixFmt: 'yuv420p',
        ancho: 1920,
        alto: 1080,
        anchoReal: 1920,
        vertical: false,
        fps: 30,
        fpsNum: 30,
        fpsDen: 1,
        duracion: 120,
        cuadros: 3600,
        contenedor: 'mov,mp4',
        bytes: 1024,
        conAudio: true,
        audioCodec: 'aac',
        ...(cambios || {})
    };
}

function limpiar() {
    fs.rmSync(RAIZ, { recursive: true, force: true });
}

module.exports = { RAIZ, carpeta, archivo, media, limpiar };
