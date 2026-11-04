'use strict';
/**
 * main/redaccion.js — Lo que el modelo escribe sobre un comentario: refinar su
 * redacción, y quitar el encargo que armó el export.
 *
 * Está separado de `main/ajustes.js` —que es donde se ELIGE el transporte y el
 * modelo— y de `main/comentarios.js` —que es donde se guardan—, porque refinar
 * es una tercera cosa: un canal en el que el texto del editor sale de su
 * máquina (o no, según el transporte), que puede tardar treinta segundos y
 * fallar por algo que no es el disco. Un lector que busca «por qué Refinar no
 * hace nada» entra acá y no tiene que elegir entre dos archivos grandes.
 *
 * El encargo de cada clase también lo escribe el modelo, pero lo pide el
 * export (`main/carpeta.js`), que es el que sabe qué clases entran.
 *
 * Se pregunta por el transporte activo en el momento de usarlo y no se
 * cachea: cambiar de modelo en Ajustes tiene que valer para el próximo botón
 * que se apriete, sin recargar.
 */

const { ipcMain } = require('electron');

const ajustesLib = require('../engine/ajustes');
const comentariosLib = require('../engine/comentarios');
const prompts = require('../engine/prompts');

/** Lo que este módulo necesita del resto del proceso principal. Lo pone `registrar`. */
let puente = {
    anotar: () => {},
    contextoDe: rutaVideo => ({ rutaVideo }),
    estadoDe: (rutaVideo, datos) => datos
};

function registrar(dependencias) {
    puente = { ...puente, ...dependencias };

    ipcMain.handle('refinar', async (e, entrada) => {
        const config = ajustesLib.llmActivo();
        if (!config.modelo) {
            return { ok: false, texto: entrada.texto || '', motivo: 'Elegí un modelo en Ajustes.' };
        }
        const r = await prompts.refinar(config, entrada);
        puente.anotar('refina', { ok: r.ok, ms: r.ms || null, motivo: r.ok ? null : r.motivo });
        return r;
    });

    // El encargo de cada clase lo arma el export (`exportar.encargosAlDia`). Acá
    // queda solo quitarlo, que es la ✕ del panel.
    ipcMain.handle('instruccion-borrar', (e, ruta) => {
        const ctx = puente.contextoDe(ruta);
        return puente.estadoDe(ruta, comentariosLib.guardarInstruccion(ruta, '', null, null, ctx));
    });
}

module.exports = { registrar };
