'use strict';
/**
 * El servidor de media.
 *
 * Si los rangos están mal, el reproductor no falla: se queda esperando para
 * siempre con el primer cuadro en negro.
 */

const fs = require('fs');

const mediaServer = require('../engine/media-server');
const temporal = require('./lib/temporal');

module.exports = async function (t) {
    t.grupo('Media server: los rangos');

    t.test('bytes=100-199', () => {
        t.deep(mediaServer.pedazoPedido('bytes=100-199', 1000), { desde: 100, hasta: 199 });
    });

    t.test('bytes=100- llega hasta el final', () => {
        t.deep(mediaServer.pedazoPedido('bytes=100-', 1000), { desde: 100, hasta: 999 });
    });

    t.test('bytes=-500 son los últimos 500', () => {
        // Así busca Chromium el índice de un MP4 cuyo `moov` quedó al final,
        // que es el caso normal de un render sin `+faststart`.
        t.deep(mediaServer.pedazoPedido('bytes=-500', 1000), { desde: 500, hasta: 999 });
    });

    t.test('un pedido más largo que el archivo se recorta', () => {
        t.deep(mediaServer.pedazoPedido('bytes=0-99999', 100), { desde: 0, hasta: 99 });
    });

    t.test('empezar más allá del final es fuera de rango', () => {
        t.deep(mediaServer.pedazoPedido('bytes=500-', 100), { fueraDeRango: true });
        t.deep(mediaServer.pedazoPedido('bytes=80-20', 100), { fueraDeRango: true });
    });

    t.test('sin cabecera, no hay rango', () => {
        t.eq(mediaServer.pedazoPedido(null, 100), null);
        t.eq(mediaServer.pedazoPedido('cosas=1-2', 100), null);
    });

    t.grupo('Media server: contestar');

    const dir = temporal.carpeta('media');
    const ruta = temporal.archivo(dir, 'video.mp4', 'abcdefghij');
    const permitidas = new Set([fs.realpathSync(ruta) === ruta ? ruta : ruta]);
    const url = `reviewer://media/${encodeURIComponent(ruta)}`;

    t.test('un archivo que no está en la lista se rechaza', async () => {
        const r = mediaServer.responder(new Request(`reviewer://media/${encodeURIComponent('/etc/passwd')}`), permitidas);
        t.eq(r.status, 403, 'la ventana pide por url: sin lista podría pedir cualquier cosa');
    });

    t.test('entero devuelve 200 y dice que acepta rangos', async () => {
        const r = mediaServer.responder(new Request(url), permitidas);
        t.eq(r.status, 200);
        t.eq(r.headers.get('Accept-Ranges'), 'bytes', 'sin esto Chromium ni intenta buscar');
        t.eq(await r.text(), 'abcdefghij');
    });

    t.test('un pedazo devuelve 206 con su Content-Range', async () => {
        const r = mediaServer.responder(new Request(url, { headers: { Range: 'bytes=2-4' } }), permitidas);
        t.eq(r.status, 206);
        t.eq(r.headers.get('Content-Range'), 'bytes 2-4/10');
        t.eq(r.headers.get('Content-Length'), '3');
        t.eq(await r.text(), 'cde');
    });

    t.test('fuera de rango devuelve 416', () => {
        const r = mediaServer.responder(new Request(url, { headers: { Range: 'bytes=50-' } }), permitidas);
        t.eq(r.status, 416);
    });

    t.test('un archivo borrado devuelve 404 y no explota', () => {
        const otro = temporal.archivo(dir, 'se-va.mp4');
        const lista = new Set([otro]);
        fs.unlinkSync(otro);
        t.eq(mediaServer.responder(new Request(`reviewer://media/${encodeURIComponent(otro)}`), lista).status, 404);
    });

    t.test('los PNG de los comentarios salen con su tipo', async () => {
        const png = temporal.archivo(dir, 'c01.png', 'x');
        const r = mediaServer.responder(new Request(`reviewer://media/${encodeURIComponent(png)}`), new Set([png]));
        t.eq(r.headers.get('Content-Type'), 'image/png');
        t.eq(r.headers.get('Access-Control-Allow-Origin'), '*', 'sin esto un canvas que lea de acá queda tainted');
    });

    t.test('un nombre con espacios y acentos llega entero', async () => {
        const raro = temporal.archivo(dir, 'Clase 02 - Qué es un hook v2.mp4', 'hola');
        const r = mediaServer.responder(
            new Request(`reviewer://media/${encodeURIComponent(raro)}`),
            new Set([raro])
        );
        t.eq(await r.text(), 'hola');
    });
};
