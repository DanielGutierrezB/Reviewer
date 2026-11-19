'use strict';
/**
 * dependencias.js — Lo que la app necesita de esta Mac, qué se pierde si
 * falta cada cosa, y cómo se instala desde la propia app.
 *
 * El instalador completo de Reviewer trae ffmpeg y ffprobe. Lo que no trae,
 * porque no se puede empaquetar, es el modelo del dictado —pesa más que la app
 * entera— y lo que el render del Mac necesita de afuera: Python 3, que viene
 * con las herramientas de Apple, y tesseract, que se instala con Homebrew. En una Mac
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

/** Donde se instala lo que la app baja: la carpeta del usuario, sin contraseña. */
const CARPETA_USUARIO = path.join(os.homedir(), 'Library', 'Application Support', 'Reviewer');

/**
 * El modelo, con el peso y el SHA-256 del archivo con el que se probó la app.
 * Si el repositorio lo cambiara, la descarga no pasaría la verificación y lo
 * diría, en vez de dejar instalado un modelo distinto del que se midió.
 *
 * La URL apunta a un commit y no a `main` por la misma razón: en `main` el
 * archivo puede cambiar debajo y entonces lo que fallaría es la verificación,
 * que es un mensaje de error en vez de una descarga que anda.
 */
const MODELOS = {
    [paths.MODELO_DICTADO]: {
        bytes: 751094240,
        sha256: 'b94545b313b3223fda7b2857a52681da813935c2127643d1e9ff0c23d988089c',
        url: 'https://huggingface.co/handy-computer/nemotron-3.5-asr-streaming-0.6b-gguf/resolve'
            + '/6d44e540bc31b0de1dbe174a3cea87f53a7f22fb'
            + `/${paths.MODELO_DICTADO}`
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
        clave: 'modelo-dictado',
        nombre: 'Modelo de dictado (Nemotron 3.5)',
        para: 'El modelo que transcribe lo que dictás. Pesa 751 MB, se baja una vez y vive fuera de la app. Sin él los comentarios se escriben a mano y todo lo demás anda igual.',
        requerida: false,
        modelo: paths.MODELO_DICTADO
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

module.exports = { LISTA, MODELOS, CARPETA_USUARIO, brew, python3, accionDe, estado, alcanza, mega };
