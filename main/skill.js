'use strict';
/**
 * skill.js — Exportar el skill de Reviewer para Claude a donde el editor diga.
 *
 * Un editor que empieza un curso le pasa este archivo a Claude antes que nada,
 * y Claude sabe cómo leer el feedback, cómo entregar y cómo se renderiza en
 * el Mac. El texto es de `engine/skill.js`; acá solo se elige dónde va, se
 * escribe y se muestra en el Finder.
 *
 * Se guarda con un diálogo y no en un lugar fijo porque el destino depende de
 * para qué se saca: para instalarlo como skill de Claude va en
 * `~/.claude/skills/reviewer/SKILL.md`; para pasárselo en un chat, al lado
 * del curso. Lo que sí se propone es un lugar razonable: la carpeta
 * `Reviewer/` del curso abierto, que es donde ya viven las cosas que valen
 * para el curso entero.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { ipcMain, dialog, shell } = require('electron');

const skillLib = require('../engine/skill');
const workspace = require('../engine/workspace');

function esCarpeta(ruta) {
    try {
        return typeof ruta === 'string' && fs.statSync(ruta).isDirectory();
    } catch (e) {
        return false;
    }
}

/**
 * @param {object} puente
 * @param {() => import('electron').BrowserWindow} puente.ventanaPrincipal
 * @param {() => string} puente.version  la de la app, la que se imprime adentro
 * @param {(evento: string, datos: object) => void} puente.anotar
 */
function registrar(puente) {
    ipcMain.handle('skill-exportar', async (e, { raiz } = {}) => {
        let texto;
        try {
            texto = skillLib.armar({ version: puente.version() });
        } catch (err) {
            return { ok: false, error: err.message };
        }

        // La raíz viene de la ventana y solo decide dónde se abre el diálogo:
        // el editor confirma el destino, así que un valor raro no escribe nada.
        const propuesta = esCarpeta(raiz)
            ? path.join(raiz, workspace.GENERAL_DIR, skillLib.ARCHIVO)
            : path.join(os.homedir(), 'Downloads', skillLib.ARCHIVO);

        const r = await dialog.showSaveDialog(puente.ventanaPrincipal(), {
            title: 'Exportar el skill de Reviewer',
            message: 'Guardalo como SKILL.md. Para instalarlo como skill de Claude va dentro de una carpeta «reviewer».',
            defaultPath: propuesta,
            buttonLabel: 'Guardar skill',
            filters: [{ name: 'Markdown', extensions: ['md'] }],
            properties: ['createDirectory', 'showOverwriteConfirmation']
        });
        if (r.canceled || !r.filePath) return { ok: false, cancelado: true };

        try {
            fs.mkdirSync(path.dirname(r.filePath), { recursive: true });
            fs.writeFileSync(r.filePath, texto);
        } catch (err) {
            return { ok: false, error: `No se pudo escribir: ${err.message}` };
        }
        shell.showItemInFolder(r.filePath);
        puente.anotar('skill.exportado', { version: puente.version(), bytes: Buffer.byteLength(texto) });
        return { ok: true, ruta: r.filePath };
    });

    /** Qué se va a exportar, para que Ajustes lo diga antes de apretar. */
    ipcMain.handle('skill-datos', () => {
        const cabecera = skillLib.encabezado() || {};
        return { version: puente.version(), nombre: cabecera.name || 'reviewer', archivo: skillLib.ARCHIVO };
    });
}

module.exports = { registrar };
