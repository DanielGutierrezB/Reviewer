#!/usr/bin/env node
'use strict';
/**
 * tools/hacer-icono.js — Arma el icono de la app con el mismo dibujo que usa
 * la barra de la ventana.
 *
 *   node tools/hacer-icono.js
 *
 * Lee la marca de `src/js/marca.js`, la dibuja sobre el fondo de la app, saca
 * un PNG de 1024 y lo convierte a `.icns` con las herramientas del sistema.
 *
 * Se genera en vez de dibujarse aparte por un motivo y no por comodidad: el
 * icono del Dock y el de la barra tienen que ser el MISMO dibujo. Con dos
 * archivos, el día que la marca cambie de trazo va a cambiar en un solo sitio
 * y nadie se va a enterar hasta ver los dos juntos.
 *
 * Rasteriza con el Electron de `node_modules` y no con Chrome por puppeteer:
 * Electron ya es dependencia del proyecto y trae el mismo motor, así que armar
 * el icono no obliga a tener Chrome instalado ni a bajar un navegador aparte.
 *
 * El `.icns` va a `build/`, que es donde electron-builder lo busca solo, así
 * que el mismo archivo sirve para el atajo de desarrollo y para el `.pkg`.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const RAIZ = path.join(__dirname, '..');
const DESTINO = path.join(RAIZ, 'build');

const FONDO = '#171a21';
const BORDE = '#2a2f3a';
const ACENTO = '#4f9cf9';

/** El dibujo de la marca, leído del módulo de la ventana y no copiado. */
function marca() {
    const src = fs.readFileSync(path.join(RAIZ, 'src', 'js', 'marca.js'), 'utf8');
    const m = src.match(/export const MARCA = (\[[\s\S]*?\]\.join\(''\));/);
    if (!m) throw new Error('No encontré MARCA en src/js/marca.js');
    // Son literales de cadena en un array: se evalúan como tales.
    // eslint-disable-next-line no-new-func
    return Function(`return (${m[1]});`)();
}

/**
 * El lienzo: el fondo de la app con la marca en el acento.
 *
 * Con esquinas redondeadas propias y no cuadrado a sangre: macOS NO redondea
 * los iconos de app por su cuenta —eso es iOS— así que un PNG cuadrado se ve
 * como una estampilla al lado de los demás del Dock. El radio es el 22,4 % del
 * lado, que es la proporción de la plantilla de Apple.
 *
 * El trazo se engorda a 1.1: el de la ventana está pensado para 15 píxeles y a
 * 1024 queda como un alambre.
 */
function html(dibujo) {
    // `overflow:hidden` no es cosmético: con la barra de desplazamiento a la
    // vista el área que captura Electron mide menos de 1024 y el icono sale
    // con una franja gris pegada al borde derecho.
    return `<!DOCTYPE html><html><head><style>
        html, body { margin: 0; padding: 0; overflow: hidden; background: transparent; }
      </style></head><body>
      <svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
        <defs><clipPath id="r"><rect width="1024" height="1024" rx="229" ry="229"/></clipPath></defs>
        <g clip-path="url(#r)">
          <rect width="1024" height="1024" fill="${FONDO}"/>
          <rect width="1024" height="1024" fill="none" stroke="${BORDE}" stroke-width="16"/>
        </g>
        <g transform="translate(512 512) scale(31) translate(-12 -12)"
           fill="none" stroke="${ACENTO}" color="${ACENTO}" stroke-width="1.1"
           stroke-linecap="round" stroke-linejoin="round">${dibujo}</g>
      </svg></body></html>`;
}

/** Los tamaños que pide un `.iconset` de macOS. */
const TAMANOS = [16, 32, 64, 128, 256, 512, 1024];

/**
 * Abre un Electron sin ventana a la vista, le da el SVG y se trae el PNG.
 *
 * Corre en un proceso aparte porque Electron necesita ser el que arranque el
 * programa: no se puede `require('electron')` desde un Node normal y pedirle
 * una ventana.
 */
function rasterizar(destino) {
    const electron = path.join(
        RAIZ, 'node_modules', 'electron', 'dist',
        fs.readFileSync(path.join(RAIZ, 'node_modules', 'electron', 'path.txt'), 'utf8').trim()
    );
    if (!fs.existsSync(electron)) {
        throw new Error('No está Electron en node_modules. Corré: npm install');
    }

    const guion = path.join(os.tmpdir(), `rv-icono-${process.pid}.js`);
    fs.writeFileSync(guion, `
        const fs = require('fs');
        const { app, BrowserWindow } = require('electron');
        app.disableHardwareAcceleration();
        app.whenReady().then(async () => {
            const win = new BrowserWindow({
                width: 1024, height: 1024, show: false, frame: false,
                webPreferences: { offscreen: true }
            });
            await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(${JSON.stringify(html(marca()))}));
            // Un respiro para que el SVG esté pintado: capturar en el mismo
            // tic devuelve un PNG en blanco.
            await new Promise(r => setTimeout(r, 400));
            const imagen = await win.capturePage();
            fs.writeFileSync(${JSON.stringify(destino)}, imagen.toPNG());
            app.quit();
        });
    `);

    try {
        execFileSync(electron, [guion], {
            stdio: 'ignore',
            env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' }
        });
    } finally {
        fs.unlinkSync(guion);
    }

    if (!fs.existsSync(destino) || fs.statSync(destino).size === 0) {
        throw new Error('Electron no devolvió el PNG del icono.');
    }
}

function main() {
    fs.mkdirSync(DESTINO, { recursive: true });
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rv-icono-'));
    const png = path.join(tmp, 'icono.png');

    rasterizar(png);

    // `iconutil` pide un `.iconset` con los nombres exactos, y cada tamaño con
    // su `@2x`: sin el @2x, el icono se ve borroso en una pantalla Retina, que
    // son todas.
    const iconset = path.join(tmp, 'icono.iconset');
    fs.mkdirSync(iconset);
    for (const n of TAMANOS) {
        if (n <= 512) {
            execFileSync('sips', ['-z', String(n), String(n), png,
                '--out', path.join(iconset, `icon_${n}x${n}.png`)], { stdio: 'ignore' });
        }
        if (n >= 32) {
            execFileSync('sips', ['-z', String(n), String(n), png,
                '--out', path.join(iconset, `icon_${n / 2}x${n / 2}@2x.png`)], { stdio: 'ignore' });
        }
    }

    const icns = path.join(DESTINO, 'icon.icns');
    execFileSync('iconutil', ['-c', 'icns', iconset, '-o', icns]);
    fs.copyFileSync(png, path.join(DESTINO, 'icon.png'));
    fs.rmSync(tmp, { recursive: true, force: true });

    console.log(`${icns}  (${Math.round(fs.statSync(icns).size / 1024)} KB)`);
    console.log('electron-builder lo toma solo desde build/, así que el `.pkg`');
    console.log('y el atajo de desarrollo llevan el mismo icono.');
}

try {
    main();
} catch (err) {
    console.error(err && err.stack ? err.stack : err);
    process.exit(1);
}
