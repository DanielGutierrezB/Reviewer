'use strict';
/**
 * main/sistema.js — Lo que la ventana le pide a la máquina.
 *
 * Qué Mac es esta y qué binarios tiene, el diario, el Finder, el portapapeles,
 * el diálogo de confirmar y el micrófono. Nada de esto sabe qué render se está
 * mirando ni toca la carpeta abierta: son los canales que existen solamente
 * porque la ventana corre con `sandbox: true` y sin Node, y el día que algo de
 * acá crezca —un segundo diálogo, otra salida al sistema— se agrega acá sin
 * leer nada más.
 *
 * El dictado entra en el mismo archivo y vale decir por qué, porque es el que
 * menos se parece a los otros: sus cinco canales son cinco líneas que llaman a
 * `engine/dictado.js`, que es donde está todo —el proceso del modelo de voz,
 * el buffer, el idioma—. Lo único que lo obliga a pasar por el proceso
 * principal es que el renderer no puede levantar un proceso hijo, que es
 * exactamente la razón por la que existe el resto de este módulo. Si algún día
 * el dictado tuviera lógica de este lado, se va a su propio archivo.
 */

const { clipboard, dialog, ipcMain, shell } = require('electron');
const fs = require('fs');

const ajustesLib = require('../engine/ajustes');
const dictado = require('../engine/dictado');
const paths = require('../engine/paths');
const proxy = require('../engine/proxy');
const registro = require('../engine/registro');

/** Lo que este módulo necesita del resto del proceso principal. Lo pone `registrar`. */
let puente = {
    ventanaPrincipal: () => null,
    version: () => '0.0.0'
};

function registrar(dependencias) {
    puente = { ...puente, ...dependencias };

    // ─── Qué hay en esta máquina ──────────────────────────────────────

    ipcMain.handle('app-info', () => ({
        version: puente.version(),
        arch: process.arch,
        electron: process.versions.electron,
        platform: process.platform
    }));

    ipcMain.handle('doctor', () => ({
        ...paths.doctor(),
        cache: proxy.peso()
    }));

    ipcMain.handle('registro-anotar', (evento, { evento: nombre, datos } = {}) => {
        registro.anotar('ventana', nombre, datos);
        return true;
    });

    ipcMain.handle('registro-texto', () => registro.texto());

    // ─── Dictado ──────────────────────────────────────────────────────

    ipcMain.handle('dictado-estado', () => ({ ...dictado.disponible(), listo: dictado.listo() }));
    ipcMain.handle('dictado-empezar', () => dictado.empezar());
    ipcMain.handle('dictado-trozo', (e, bytes) => dictado.trozo(Buffer.from(bytes)));
    ipcMain.handle('dictado-leer', () => dictado.transcribir(ajustesLib.leer().dictado.idioma));
    ipcMain.handle('dictado-cerrar', () => dictado.cerrar());

    // ─── Salidas al sistema ───────────────────────────────────────────

    ipcMain.handle('abrir-en-finder', (e, ruta) => {
        if (!ruta) return false;
        if (fs.existsSync(ruta) && fs.statSync(ruta).isDirectory()) shell.openPath(ruta);
        else shell.showItemInFolder(ruta);
        return true;
    });

    ipcMain.handle('abrir-archivo', (e, ruta) => shell.openPath(ruta));

    ipcMain.handle('copiar', (e, texto) => {
        clipboard.writeText(String(texto || ''));
        return true;
    });

    ipcMain.handle('confirmar', async (e, { titulo, detalle, aceptar } = {}) => {
        const r = await dialog.showMessageBox(puente.ventanaPrincipal(), {
            type: 'warning',
            buttons: [aceptar || 'Borrar', 'Cancelar'],
            defaultId: 1,
            cancelId: 1,
            message: titulo || '¿Seguro?',
            detail: detalle || ''
        });
        return r.response === 0;
    });
}

module.exports = { registrar };
