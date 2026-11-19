'use strict';
/**
 * paths.js — Dónde están las herramientas externas en ESTA máquina.
 *
 * Reviewer se distribuye con ffmpeg y ffprobe adentro, así que lo primero que
 * se mira es el bundle. En desarrollo esos binarios todavía no están copiados y
 * el PATH de un Electron lanzado desde el Finder no es el de la terminal, así
 * que también se buscan en los lugares conocidos de Homebrew antes de rendirse.
 *
 * El motor del dictado NO está acá: desde la 0.1.21 es una librería de Node
 * (`transcribe-cpp`) que viaja dentro de la app, no un ejecutable suelto. Lo
 * único que sigue buscándose en el disco es su modelo, que pesa demasiado para
 * meterlo en el instalador.
 *
 * La ruta se resuelve una vez y se recuerda: `which` por cada llamada es tiempo
 * regalado cuando hay que medir treinta renders al abrir una carpeta.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const KNOWN_DIRS = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin'];

/**
 * Donde vive el modelo del dictado, fuera del `.app`.
 *
 * El segundo es donde lo baja la app (`engine/dependencias.js`), sin
 * contraseña. El primero es donde lo dejaba el instalador completo de hasta la
 * 0.1.16, y se sigue mirando para que esas instalaciones no lo bajen de nuevo.
 */
const DATA_DIRS = [
    '/Library/Application Support/Reviewer',
    path.join(os.homedir(), 'Library', 'Application Support', 'Reviewer')
];

/** El modelo con el que se dicta. Ver `modeloDictado`. */
const MODELO_DICTADO = 'nemotron-3.5-asr-streaming-0.6b-Q8_0.gguf';

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

/**
 * El modelo con el que se dicta: Nemotron 3.5 Streaming, cuantizado a Q8_0.
 *
 * Reemplaza al `ggml-small.bin` de Whisper en la 0.1.21, y el motivo es el que
 * se ve dictando: Whisper no trocea, así que cada refresco retranscribía todo
 * el buffer, y sobre un silencio devolvía «¡Suscríbete!» —la frase más repetida
 * en los subtítulos con los que se entrenó—. Este es un transductor con caché:
 * procesa solo lo que entró, en 29 ms por cada medio segundo de audio, y sobre
 * el silencio devuelve la cadena vacía. La puntuación la pone después el modelo
 * de lenguaje (ver `src/js/dictado.js`), que es lo mismo que hace Handy.
 *
 * Q8_0 y no el F16: 751 MB contra 1,28 GB para una diferencia de precisión que
 * sobre una frase dictada no aparece.
 */
function modeloDictado() {
    const dirs = bundledDirs()
        .map(d => path.join(d, 'models'))
        .concat(DATA_DIRS.map(d => path.join(d, 'models')));
    for (const dir of dirs) {
        const candidate = path.join(dir, MODELO_DICTADO);
        if (fs.existsSync(candidate)) return candidate;
    }
    return null;
}

/** Para los tests, que resuelven herramientas falsas en carpetas temporales. */
function olvidar() {
    cache.clear();
}

module.exports = {
    KNOWN_DIRS,
    DATA_DIRS,
    MODELO_DICTADO,
    resolveTool,
    ffmpeg,
    ffprobe,
    modeloDictado,
    olvidar
};
