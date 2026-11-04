'use strict';
/**
 * main.js — Arranca una ventana oculta de Electron que compone y codifica una
 * toma en la GPU, y escribe el resultado a disco.
 *
 * ES UN PROTOTIPO. No forma parte de la app: la ventana lleva `nodeIntegration`
 * y `webSecurity: false` para poder leer archivos del disco sin pasar por el
 * protocolo `reviewer://`, cosa que la app de verdad jamás haría. Existe para
 * contestar una sola pregunta con números: ¿un compositor en el navegador,
 * decodificando y codificando por VideoToolbox a través de WebCodecs, da la
 * misma imagen que ffmpeg y a qué velocidad? Lo corre `correr.js`.
 */

const path = require('path');
const { app, BrowserWindow, ipcMain } = require('electron');

const parametros = JSON.parse(process.env.POC || '{}');

app.whenReady().then(() => {
    const ventana = new BrowserWindow({
        show: false,
        width: 960,
        height: 540,
        webPreferences: {
            // Sin sandbox, o `nodeIntegration` se ignora en silencio.
            sandbox: false,
            nodeIntegration: true,
            contextIsolation: false,
            webSecurity: false,
            // Una ventana oculta es una «pestaña de fondo» para Chromium, y a
            // las de fondo les frena los temporizadores a uno por segundo.
            backgroundThrottling: false
        }
    });

    ipcMain.once('poc-listo', (e, resultado) => {
        // Con el callback: salir antes de que el pipe drene pierde la línea.
        process.stdout.write(`${JSON.stringify(resultado)}\n`, () => app.exit(resultado.error ? 1 : 0));
    });

    ventana.webContents.on('console-message', (e, nivel, mensaje) => {
        process.stderr.write(`[pagina] ${(e && e.message) || mensaje}\n`);
    });

    ventana.loadFile(path.join(__dirname, 'pagina.html'), {
        query: { poc: JSON.stringify(parametros) }
    });
});
