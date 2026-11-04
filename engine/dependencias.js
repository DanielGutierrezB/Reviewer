'use strict';
/**
 * dependencias.js — Lo que la app necesita de esta Mac, qué se pierde si
 * falta cada cosa, y cómo se instala desde la propia app.
 *
 * El instalador completo de Reviewer trae ffmpeg, ffprobe, whisper-server y
 * el modelo del dictado. Lo que no trae, porque no se puede empaquetar, es lo
 * que el render del Mac necesita de afuera: Python 3, que viene con las
 * herramientas de Apple, y tesseract, que se instala con Homebrew. En una Mac
 * nueva la app tiene que darse cuenta de qué falta y ofrecer instalarlo con un
 * botón, en vez de fallar a los veinte minutos con «No such file» en un log.
 *
 * Esta es LA lista. La pantalla de Ajustes, el aviso de la primera apertura y
 * el worker de render leen de acá; antes el worker tenía la suya propia y las
 * dos decían cosas distintas. Cada entrada dice:
 *
 *   requerida   sin eso no se puede ni abrir una carpeta (ffprobe, ffmpeg).
 *               Lo demás apaga una función —dictar, renderizar, leer
 *               pantallas— y la app sigue sirviendo para comentar.
 *   accion      cómo se instalaría si falta:
 *     descargar   el modelo, de Hugging Face, a la carpeta del usuario, sin
 *                 contraseña y verificado contra su SHA-256
 *     brew        con Homebrew, si está
 *     homebrew    Homebrew mismo: abre la Terminal con su instalador oficial,
 *                 porque pide la contraseña y eso no se hace por la persona
 *     xcode       las herramientas de Apple: abre su instalador
 *     reinstalar  lo que solo viene con el instalador completo de Reviewer
 *
 * Acá se decide; instalar de verdad —bajar, correr brew, abrir la Terminal—
 * es de `main/dependencias.js`, que es el que puede tocar el sistema.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const paths = require('./paths');

/** De dónde se baja el modelo. Es el mismo repositorio del que salió el empaquetado. */
const HUGGING_FACE = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main';

/** Donde se instala lo que la app baja: la carpeta del usuario, sin contraseña. */
const CARPETA_USUARIO = path.join(os.homedir(), 'Library', 'Application Support', 'Reviewer');

/**
 * El modelo, con el peso y el SHA-256 del archivo con el que se probó la app.
 * Si el repositorio lo cambiara, la descarga no pasaría la verificación y lo
 * diría, en vez de dejar instalado un modelo distinto del que se midió.
 */
const MODELOS = {
    'ggml-small.bin': {
        bytes: 487601967,
        sha256: '1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b'
    }
};

/** Dónde están las herramientas de Apple cuando están. */
const PYTHON_CANDIDATOS = [
    '/opt/homebrew/bin/python3',
    '/usr/local/bin/python3',
    // `/usr/bin/python3` existe siempre en macOS, pero sin las herramientas de
    // Apple es un aviso que pide instalarlas. El de adentro de CommandLineTools
    // solo existe si de verdad están.
    '/Library/Developer/CommandLineTools/usr/bin/python3'
];

const LISTA = [
    {
        clave: 'ffprobe',
        nombre: 'ffprobe',
        para: 'Mide cada render: codec, tamaño, cuadros por segundo y duración. Sin esto no se puede abrir una carpeta.',
        requerida: true,
        herramienta: 'ffprobe',
        brew: 'ffmpeg'
    },
    {
        clave: 'ffmpeg',
        nombre: 'ffmpeg',
        para: 'Saca el cuadro de cada comentario, arma los proxies de los codecs que el reproductor no entiende y renderiza.',
        requerida: true,
        herramienta: 'ffmpeg',
        brew: 'ffmpeg'
    },
    {
        clave: 'whisper-server',
        nombre: 'whisper-server (el dictado)',
        para: 'Solo hace falta para dictar. Sin él los comentarios se escriben a mano y todo lo demás anda igual.',
        requerida: false,
        herramienta: 'whisper-server'
    },
    {
        clave: 'modelo-dictado',
        nombre: 'Modelo de dictado (small)',
        para: 'El modelo que transcribe lo que dictás. Pesa 488 MB y vive fuera de la app.',
        requerida: false,
        modelo: 'ggml-small.bin'
    },
    {
        clave: 'python3',
        nombre: 'Python 3 (el render)',
        para: 'Corre los scripts de Claude cuando Reviewer renderiza en esta Mac. Viene con las herramientas de Apple.',
        requerida: false,
        python: true
    },
    {
        clave: 'tesseract',
        nombre: 'tesseract (leer pantallas)',
        para: 'El OCR del render: tapa correos y claves que aparecen en las pantallas. Sin él, las clases con pantallas quedan esperando.',
        requerida: false,
        herramienta: 'tesseract',
        brew: 'tesseract'
    }
];

function mega(bytes) {
    return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1).replace('.', ',')} GB` : `${Math.round(bytes / 1e6)} MB`;
}

function ejecutable(ruta) {
    try {
        fs.accessSync(ruta, fs.constants.X_OK);
        return true;
    } catch (e) {
        return false;
    }
}

/** Dónde está Homebrew, o `null`. */
function brew() {
    return ['/opt/homebrew/bin/brew', '/usr/local/bin/brew'].find(ejecutable) || null;
}

/** El Python 3 que puede correr los scripts, o `null`. */
function python3() {
    return PYTHON_CANDIDATOS.find(ejecutable) || null;
}

/** Dónde está una dependencia, o `null` si falta. */
function encontrada(d) {
    if (d.modelo) return paths.modeloDictado();
    if (d.python) return python3();
    return paths.resolveTool(d.herramienta).path;
}

/**
 * Cómo se instalaría, si falta.
 *
 * @param {object} d una entrada de `LISTA`
 * @param {{hayBrew?: boolean}} [contexto] para los tests; por defecto se mira la Mac
 */
function accionDe(d, { hayBrew = Boolean(brew()) } = {}) {
    if (d.modelo) {
        return { tipo: 'descargar', etiqueta: `Descargar (${mega(MODELOS[d.modelo].bytes)})` };
    }
    if (d.python) {
        return {
            tipo: 'xcode',
            etiqueta: 'Instalar las herramientas de Apple',
            nota: 'Se abre el instalador de Apple y tarda unos minutos. Cuando termine, volvé acá.'
        };
    }
    if (d.brew) {
        return hayBrew
            ? { tipo: 'brew', etiqueta: 'Instalar con Homebrew' }
            : {
                tipo: 'homebrew',
                etiqueta: 'Instalar Homebrew primero',
                nota: 'Se abre la Terminal con el instalador oficial de Homebrew: pide la contraseña de la Mac. Cuando termine, volvé acá.'
            };
    }
    return {
        tipo: 'reinstalar',
        etiqueta: null,
        nota: 'Viene adentro del instalador completo de Reviewer: volvé a instalarlo.'
    };
}

/**
 * Qué hay y qué falta, ahora mismo.
 *
 * Se olvida lo que `paths` tenía resuelto antes de mirar: esto se llama justo
 * después de instalar algo, y la respuesta tiene que ser la de ahora.
 *
 * @returns {Array<{clave: string, nombre: string, para: string, requerida: boolean, esta: boolean, donde: string|null, accion: object|null}>}
 */
function estado() {
    paths.olvidar();
    return LISTA.map(d => {
        const donde = encontrada(d);
        return {
            clave: d.clave,
            nombre: d.nombre,
            para: d.para,
            requerida: d.requerida,
            esta: Boolean(donde),
            donde: donde || null,
            accion: donde ? null : accionDe(d)
        };
    });
}

/** Si con lo que hay se puede abrir una carpeta: todo lo requerido está. */
function alcanza(filas = estado()) {
    return filas.filter(f => f.requerida).every(f => f.esta);
}

module.exports = { LISTA, MODELOS, HUGGING_FACE, CARPETA_USUARIO, brew, python3, accionDe, estado, alcanza, mega };
