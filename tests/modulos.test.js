'use strict';
/**
 * Que todo cargue.
 *
 * Un `require` roto o un ciclo entre dos módulos del motor no se ve en ningún
 * otro test —cada uno carga solo lo suyo— y se descubre al abrir la app, que es
 * el peor momento.
 */

const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');

module.exports = async function (t) {
    t.grupo('Módulos');

    const delMotor = fs.readdirSync(path.join(RAIZ, 'engine'))
        .filter(n => n.endsWith('.js'))
        .sort();

    t.test('el motor entero carga', () => {
        for (const nombre of delMotor) {
            const modulo = require(path.join(RAIZ, 'engine', nombre));
            t.ok(modulo && typeof modulo === 'object', `${nombre} exporta algo`);
        }
    });

    t.test('la ventana entera carga', async () => {
        const deLaVentana = fs.readdirSync(path.join(RAIZ, 'src', 'js'))
            .filter(n => n.endsWith('.js'))
            // Dos no se pueden cargar afuera de la ventana sin que eso diga
            // nada: el worklet corre en el hilo de audio y usa
            // `AudioWorkletProcessor`, y `app.js` es el punto de entrada —
            // importarlo arranca la app contra un DOM que acá no existe.
            .filter(n => n !== 'captura-worklet.js' && n !== 'app.js');
        for (const nombre of deLaVentana) {
            await import(path.join(RAIZ, 'src', 'js', nombre));
        }
    });

    t.test('el preload nombra funciones que el main atiende', () => {
        // Un canal que la ventana llama y el main no registró falla recién
        // cuando alguien aprieta ese botón.
        const preload = fs.readFileSync(path.join(RAIZ, 'preload.js'), 'utf8');
        const main = fs.readFileSync(path.join(RAIZ, 'main.js'), 'utf8');
        const canales = [...preload.matchAll(/invoke\('([^']+)'/g)].map(m => m[1]);
        t.ok(canales.length > 20, `son ${canales.length} canales`);
        for (const canal of new Set(canales)) {
            t.ok(main.includes(`ipcMain.handle('${canal}'`), `main atiende «${canal}»`);
        }
    });

    t.test('el HTML carga los tres CSS y el módulo de arranque', () => {
        const html = fs.readFileSync(path.join(RAIZ, 'src', 'index.html'), 'utf8');
        for (const hoja of ['css/style.css', 'css/reproductor.css', 'css/comentarios.css']) {
            t.tiene(html, hoja);
        }
        t.tiene(html, 'js/app.js');
    });

    t.test('la política de la ventana deja pasar el protocolo y nada más', () => {
        const html = fs.readFileSync(path.join(RAIZ, 'src', 'index.html'), 'utf8');
        t.tiene(html, "default-src 'none'");
        t.tiene(html, 'media-src reviewer:');
        t.noTiene(html, "script-src 'unsafe-inline'");
    });

    t.test('la versión del package y la del version.json son la misma', () => {
        const pkg = JSON.parse(fs.readFileSync(path.join(RAIZ, 'package.json'), 'utf8'));
        const version = JSON.parse(fs.readFileSync(path.join(RAIZ, 'version.json'), 'utf8'));
        t.eq(pkg.version, version.version);
    });
};
