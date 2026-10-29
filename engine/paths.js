'use strict';
/**
 * paths.js — Dónde están las herramientas externas en ESTA máquina.
 *
 * Reviewer se distribuye con todo adentro (ffmpeg, ffprobe, whisper-server y su
 * modelo), así que lo primero que se mira es el bundle. En desarrollo esos
 * binarios todavía no están copiados y el PATH de un Electron lanzado desde el
 * Finder no es el de la terminal, así que también se buscan en los lugares
 * conocidos de Homebrew antes de rendirse.
 *
 * La ruta se resuelve una vez y se recuerda: `which` por cada llamada es tiempo
 * regalado cuando hay que medir treinta renders al abrir una carpeta.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const KNOWN_DIRS = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin'];

/** Donde el instalador deja los modelos, fuera del `.app`. */
const DATA_DIRS = [
    '/Library/Application Support/Reviewer',
    path.join(os.homedir(), 'Library', 'Application Support', 'Reviewer')
];

/**
 * Y, en desarrollo, los modelos que ya están en la Mac.
 *
 * Note Taker y Class Cut traen los mismos `ggml-*.bin` y pesan cuatro gigas:
 * bajarlos de nuevo para poder dictar en una app que todavía no se empaquetó
 * sería pagar dos veces por el mismo archivo. En el `.app` esta lista no
 * encuentra nada y no se usa.
 */
const DEV_MODEL_DIRS = [
    path.join(os.homedir(), 'Movies', 'Note Taker', 'bin', 'mac', 'models'),
    path.join(os.homedir(), 'Movies', 'Class-Cut', 'bin', 'mac', 'models')
];

const cache = new Map();

function appRoot() {
    return path.resolve(__dirname, '..');
}

/** Carpeta de recursos: dentro del `.app` empaquetado o del repo en desarrollo. */
function bundledDirs() {
    const dirs = [];
    if (process.resourcesPath) dirs.push(path.join(process.resourcesPath, 'bin'));
    dirs.push(path.join(appRoot(), 'bin', 'mac'));
    dirs.push(path.join(appRoot(), 'bin'));
    return dirs;
}

function existsExec(file) {
    try {
        fs.accessSync(file, fs.constants.X_OK);
        return true;
    } catch (e) {
        return false;
    }
}

/**
 * Una herramienta → dónde está y de dónde salió.
 *
 * `origen` es `'bundle'` o `'sistema'`, y se dice en Diagnóstico: una app que
 * anda con el ffmpeg de Homebrew en la Mac del que la programó y no anda en
 * ninguna otra es exactamente el fallo que este campo deja ver.
 *
 * @returns {{path: string|null, origen: string|null}}
 */
function resolveTool(name) {
    if (cache.has(name)) return cache.get(name);

    let found = { path: null, origen: null };
    for (const dir of bundledDirs()) {
        const candidate = path.join(dir, name);
        if (existsExec(candidate)) { found = { path: candidate, origen: 'bundle' }; break; }
    }

    if (!found.path) {
        for (const dir of KNOWN_DIRS) {
            const candidate = path.join(dir, name);
            if (existsExec(candidate)) { found = { path: candidate, origen: 'sistema' }; break; }
        }
    }

    if (!found.path) {
        try {
            const which = execFileSync('/usr/bin/which', [name], { encoding: 'utf8' }).trim();
            if (which && existsExec(which)) found = { path: which, origen: 'sistema' };
        } catch (e) { /* no está, y eso es una respuesta */ }
    }

    cache.set(name, found);
    return found;
}

const ffmpeg = () => resolveTool('ffmpeg');
const ffprobe = () => resolveTool('ffprobe');
const whisperServer = () => resolveTool('whisper-server');

/**
 * El modelo con el que se dicta.
 *
 * `small` y no el grande, por lo mismo que en HyperPremiere: sobre una frase
 * dictada la precisión del grande no aparece y la inferencia cuesta el triple.
 * Lo que el grande sí arregla —palabras técnicas en inglés— es justo lo que
 * `small` ya acierta (`fade`, `keyframes`), y `base` no.
 */
function modeloDictado() {
    const nombre = 'ggml-small.bin';
    const dirs = bundledDirs()
        .map(d => path.join(d, 'models'))
        .concat(DATA_DIRS.map(d => path.join(d, 'models')))
        .concat(DEV_MODEL_DIRS);
    for (const dir of dirs) {
        const candidate = path.join(dir, nombre);
        if (fs.existsSync(candidate)) return candidate;
    }
    return null;
}

/**
 * Qué tiene esta máquina y qué le falta, para la pantalla de Diagnóstico.
 *
 * Cada fila dice además **qué se pierde** si falta: sin ffprobe no se puede
 * abrir una carpeta, pero sin whisper solo se pierde el dictado y la app sigue
 * sirviendo para comentar. Un diagnóstico que pone en la misma lista lo que
 * rompe todo y lo que apaga un botón obliga a aprenderse cuál es cuál.
 */
function doctor() {
    const filas = [
        {
            clave: 'ffprobe',
            nombre: 'ffprobe',
            herramienta: 'ffprobe',
            nota: 'Mide cada render: codec, tamaño, cuadros por segundo y duración. Sin esto no se puede abrir una carpeta.',
            critico: true
        },
        {
            clave: 'ffmpeg',
            nombre: 'ffmpeg',
            herramienta: 'ffmpeg',
            nota: 'Saca el cuadro de cada comentario y arma el proxy de los codecs que el reproductor no entiende.',
            critico: true
        },
        {
            clave: 'whisper-server',
            nombre: 'whisper-server (el dictado)',
            herramienta: 'whisper-server',
            nota: 'Solo hace falta para dictar. Sin él los comentarios se escriben a mano y todo lo demás anda igual.',
            critico: false
        }
    ].map(fila => {
        const tool = resolveTool(fila.herramienta);
        return { ...fila, ruta: tool.path, origen: tool.origen, ok: Boolean(tool.path) };
    });

    const modelo = modeloDictado();
    filas.push({
        clave: 'modelo-dictado',
        nombre: 'Modelo de dictado (small)',
        ruta: modelo,
        origen: modelo ? 'disco' : null,
        ok: Boolean(modelo),
        nota: 'El modelo que transcribe lo que dictás. Pesa 480 MB y vive fuera de la app.',
        critico: false
    });

    return {
        filas,
        ok: filas.filter(f => f.critico).every(f => f.ok),
        puedeDictar: Boolean(resolveTool('whisper-server').path && modelo)
    };
}

/** Para los tests, que resuelven herramientas falsas en carpetas temporales. */
function olvidar() {
    cache.clear();
}

module.exports = {
    KNOWN_DIRS,
    DATA_DIRS,
    resolveTool,
    ffmpeg,
    ffprobe,
    whisperServer,
    modeloDictado,
    doctor,
    olvidar
};
