'use strict';
/**
 * ajustes.js — Las preferencias del editor, guardadas fuera de la carpeta de
 * renders.
 *
 * Viven en `~/Library/Application Support/Reviewer/ajustes.json` y no al lado de
 * los videos: a qué modelo local hablarle es una decisión de la máquina, no del
 * curso que se está revisando. Lo que sí es del curso —el comentario general—
 * viaja con la carpeta, y eso está en `general.js`.
 *
 * La escritura es atómica: un cierre a mitad de guardado no puede dejar el JSON
 * por la mitad y la app arrancando sin saber a qué modelo le hablaba.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const workspace = require('./workspace');

/** Los transportes del modelo local. El orden es el del selector de Ajustes. */
const PROVEEDORES = ['ollama', 'openai'];

/**
 * Cuántas carpetas de renders se recuerdan.
 *
 * Seis, y el tope se aplica al SANEAR: quien agregue una séptima no tiene que
 * acordarse de recortar, y un archivo escrito a mano con cuarenta tampoco puede
 * llenar la pantalla de arranque. Seis alcanza para los cursos que se están
 * revisando ahora, que es lo que esto es; caerse de la lista no pierde nada,
 * porque la carpeta sigue en el disco y el botón de siempre la vuelve a traer.
 */
const RECIENTES = 6;

const DEFAULTS = {
    version: 1,
    carpetasRecientes: [],
    llm: {
        proveedor: 'ollama',
        // La configuración de cada transporte se conserva aunque no esté activo:
        // probar LM Studio y volver a Ollama no puede hacerte reescribir el
        // modelo que ya tenías elegido.
        ollama: { url: 'http://localhost:11434', modelo: null },
        openai: { url: 'http://localhost:1234/v1', modelo: null, apiKey: '' }
    },
    dictado: {
        // Por nombre y no por índice: el índice de avfoundation cambia cuando se
        // enchufa una webcam, y el micrófono elegido pasaría a ser otro sin que
        // nadie tocara nada.
        microfono: '',
        idioma: 'es',
        // Refinar lo dictado con el modelo local. Se puede apagar: con un modelo
        // chico flojo, el crudo de Whisper es mejor que un refinado que resume.
        refinar: true
    }
};

function archivo() {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Reviewer', 'ajustes.json');
}

function texto(valor, porDefecto) {
    return typeof valor === 'string' && valor.trim() ? valor.trim() : porDefecto;
}

/** Un objeto con TODAS las claves, venga lo que venga del disco. */
function sanear(crudo) {
    const llm = (crudo && crudo.llm) || {};
    const dictado = (crudo && crudo.dictado) || {};
    const recientes = (crudo && Array.isArray(crudo.carpetasRecientes) ? crudo.carpetasRecientes : [])
        .filter(d => typeof d === 'string' && d);

    return {
        version: DEFAULTS.version,
        // Sin repetidas y hasta el tope, decidido acá y no en quien guarda. Que
        // la carpeta siga existiendo NO se comprueba: un disco externo se
        // enchufa y se desenchufa, así que un "no está" escrito hoy es mentira
        // mañana. Eso se le pregunta al disco cuando la pantalla se abre.
        carpetasRecientes: [...new Set(recientes)].slice(0, RECIENTES),
        llm: {
            proveedor: PROVEEDORES.includes(llm.proveedor) ? llm.proveedor : DEFAULTS.llm.proveedor,
            ollama: {
                url: texto(llm.ollama && llm.ollama.url, DEFAULTS.llm.ollama.url),
                modelo: texto(llm.ollama && llm.ollama.modelo, null)
            },
            openai: {
                url: texto(llm.openai && llm.openai.url, DEFAULTS.llm.openai.url),
                modelo: texto(llm.openai && llm.openai.modelo, null),
                // Un endpoint local no pide clave y uno remoto sí. Se guarda
                // porque sin ella la función no existe para quien apunta a un
                // servicio con auth, y esto no es un secreto de otra persona:
                // es la Mac del editor, en el mismo archivo que sus preferencias.
                apiKey: typeof (llm.openai && llm.openai.apiKey) === 'string' ? llm.openai.apiKey : ''
            }
        },
        dictado: {
            microfono: typeof dictado.microfono === 'string' ? dictado.microfono : '',
            idioma: texto(dictado.idioma, DEFAULTS.dictado.idioma),
            refinar: dictado.refinar !== false
        }
    };
}

function leer() {
    let crudo = null;
    try {
        crudo = JSON.parse(fs.readFileSync(archivo(), 'utf8'));
    } catch (e) {
        // Sin archivo o con un archivo roto se arranca con lo de fábrica: unos
        // ajustes ilegibles no pueden dejar sin poder comentar.
    }
    return sanear(crudo);
}

function guardar(datos) {
    const limpio = sanear(datos);
    workspace.writeJson(archivo(), limpio);
    return limpio;
}

/** Deja una carpeta primera en la lista de recientes. */
function recordarCarpeta(ruta) {
    if (!ruta) return leer();
    const actual = leer();
    const sinEsta = actual.carpetasRecientes.filter(d => d !== ruta);
    return guardar({ ...actual, carpetasRecientes: [ruta, ...sinEsta] });
}

function olvidarCarpeta(ruta) {
    const actual = leer();
    return guardar({
        ...actual,
        carpetasRecientes: actual.carpetasRecientes.filter(d => d !== ruta)
    });
}

/** La configuración del transporte activo, aplanada para `llm.js`. */
function llmActivo(ajustes) {
    const a = ajustes || leer();
    const proveedor = a.llm.proveedor;
    const config = a.llm[proveedor] || {};
    return { proveedor, url: config.url, modelo: config.modelo, apiKey: config.apiKey || '' };
}

module.exports = {
    PROVEEDORES,
    RECIENTES,
    DEFAULTS,
    archivo,
    sanear,
    leer,
    guardar,
    recordarCarpeta,
    olvidarCarpeta,
    llmActivo
};
