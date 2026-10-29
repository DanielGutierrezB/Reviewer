'use strict';
/**
 * main/redaccion.js — Lo que el modelo escribe: mejorar la redacción de un
 * comentario y preparar la instrucción para Claude.
 *
 * Está separado de `main/ajustes.js` —que es donde se ELIGE el transporte y el
 * modelo— y de `main/comentarios.js` —que es donde se guardan—, porque es una
 * tercera cosa: los dos únicos canales de toda la app en los que el texto del
 * editor sale de su máquina (o no, según el transporte), y los dos que pueden
 * tardar treinta segundos y fallar por algo que no es el disco. Un lector que
 * busca «por qué Mejorar no hace nada» entra acá y no tiene que elegir entre
 * dos archivos grandes.
 *
 * Los dos preguntan por el transporte activo en el momento de usarlo y no lo
 * cachean: cambiar de modelo en Ajustes tiene que valer para el próximo botón
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

    ipcMain.handle('instruccion-preparar', async (e, ruta) => {
        const config = ajustesLib.llmActivo();
        if (!config.modelo) return { ok: false, motivo: 'Elegí un modelo en Ajustes.' };

        const ctx = puente.contextoDe(ruta);
        const datos = comentariosLib.leer(ruta, ctx.media);
        const r = await prompts.prepararInstruccion(config, datos, {
            clase: ctx.clase,
            numeroVersion: ctx.numeroVersion,
            general: ctx.general && ctx.general.texto
        });
        puente.anotar('instruccion', { ok: r.ok, ms: r.ms || null, motivo: r.ok ? null : r.motivo });
        if (!r.ok) return r;

        return {
            ...r,
            estado: puente.estadoDe(ruta, comentariosLib.guardarInstruccion(ruta, r.texto, r.modelo, ctx))
        };
    });

    ipcMain.handle('instruccion-borrar', (e, ruta) => {
        const ctx = puente.contextoDe(ruta);
        return puente.estadoDe(ruta, comentariosLib.guardarInstruccion(ruta, '', null, ctx));
    });
}

module.exports = { registrar };
