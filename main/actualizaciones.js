'use strict';
/**
 * main/actualizaciones.js — Si hay una versión nueva.
 *
 * Dos canales y un estado chico, pero separados porque el estado es justamente
 * lo delicado: el release encontrado se queda de este lado del puente a
 * propósito (ver abajo), y mezclado entre cincuenta handlers esa decisión se
 * pierde. La consulta a GitHub y el porqué de que no haya actualización
 * automática están en `engine/actualizaciones.js`.
 */

const { ipcMain, shell } = require('electron');

const actualizaciones = require('../engine/actualizaciones');

/**
 * El último release que se encontró, para abrirlo después.
 *
 * La página se guarda acá y no viaja a la ventana para volver: `shell.openExternal`
 * abre lo que se le dé, y aceptar una url que viene del renderer sería aceptar
 * cualquier url. Con la del lado del proceso principal, el botón «Bajarla» no
 * tiene nada que decidir: abre lo último que GitHub contestó, o nada.
 */
let releaseEncontrado = null;

/** Lo que este módulo necesita del resto del proceso principal. Lo pone `registrar`. */
let puente = { anotar: () => {}, version: () => '0.0.0' };

function registrar(dependencias) {
    puente = { ...puente, ...dependencias };

    ipcMain.handle('actualizacion-buscar', async () => {
        const versionActual = puente.version();
        const r = await actualizaciones.buscar({ versionActual });
        releaseEncontrado = r.hay ? r : null;
        puente.anotar('update.busca', {
            hay: Boolean(r.hay),
            version: r.version || null,
            motivo: r.motivo || null
        });
        // La versión que corre vuelve junto con la respuesta y no se pide aparte:
        // Ajustes tiene que poder decir «estás en la 0.1.4 y hay la 0.2.0» sin
        // armar esa frase con dos consultas que podrían contestar cosas distintas.
        return { ...r, versionActual };
    });

    /**
     * Abre la página del release en el navegador del editor.
     *
     * No se baja ni se instala nada desde acá a propósito: sin Developer ID la
     * actualización automática de macOS no es posible (el porqué entero está en
     * `engine/actualizaciones.js`), y bajar un `.pkg` para abrírselo sería ejecutar
     * algo traído de la red con la firma sin verificar. El navegador descarga y el
     * Instalador de macOS instala, que es lo que el editor ya sabe hacer y donde
     * las advertencias del sistema sí aparecen.
     */
    ipcMain.handle('actualizacion-abrir', async () => {
        if (!releaseEncontrado) return { ok: false, error: 'Buscá primero si hay una versión nueva.' };
        puente.anotar('update.abre', { version: releaseEncontrado.version });
        await shell.openExternal(releaseEncontrado.pagina);
        return { ok: true };
    });
}

module.exports = { registrar };
