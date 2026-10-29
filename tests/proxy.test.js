'use strict';
/**
 * Cuándo hay que convertir un render para poder verlo.
 *
 * Es una decisión que, mal tomada, se ve como una pantalla negra sin error:
 * Chromium carga el ProRes, dura lo que tiene que durar y no muestra un cuadro.
 */

const proxy = require('../engine/proxy');
const temporal = require('./lib/temporal');

module.exports = function (t) {
    t.grupo('Proxy');

    t.test('un H.264 normal se reproduce tal cual', () => {
        t.eq(proxy.haceFalta(temporal.media()).hace, false);
    });

    t.test('ProRes, DNxHD y HEVC hay que convertirlos', () => {
        for (const codec of ['prores', 'dnxhd', 'hevc', 'mjpeg']) {
            const r = proxy.haceFalta(temporal.media({ codec }));
            t.eq(r.hace, true, codec);
            t.tiene(r.motivo, codec.toUpperCase(), 'y se dice por qué, que es lo que lee el editor');
        }
    });

    t.test('VP9 y AV1 sí se reproducen', () => {
        for (const codec of ['vp9', 'av1', 'vp8']) {
            t.eq(proxy.haceFalta(temporal.media({ codec })).hace, false, codec);
        }
    });

    t.test('un H.264 de 10 bits también hay que convertirlo', () => {
        // Es H.264 y no se reproduce igual: Chromium solo trae 8 bits y 4:2:0.
        t.eq(proxy.haceFalta(temporal.media({ pixFmt: 'yuv420p10le' })).hace, true);
        t.eq(proxy.haceFalta(temporal.media({ pixFmt: 'yuv422p' })).hace, true);
        t.eq(proxy.haceFalta(temporal.media({ pixFmt: 'yuvj420p' })).hace, false, 'el de rango completo sí anda');
    });

    t.test('un audio que no se puede abrir también manda a convertir', () => {
        const r = proxy.haceFalta(temporal.media({ audioCodec: 'pcm_s24le' }));
        t.eq(r.hace, true);
        t.tiene(r.motivo, 'audio');
    });

    t.test('un archivo que no se pudo medir no se convierte', () => {
        t.eq(proxy.haceFalta({ ok: false, error: 'x' }).hace, false, 'no hay nada que decidir');
        t.eq(proxy.haceFalta(null).hace, false);
    });

    t.grupo('Proxy: dónde cae y con qué');

    t.test('el proxy NO va al lado del render', () => {
        const dir = temporal.carpeta('proxy');
        const ruta = temporal.archivo(dir, 'Clase 01 v1.mov');
        const destino = proxy.rutaDeProxy(ruta);
        t.ok(!destino.startsWith(dir), 'la carpeta del editor es lo que esta app promete no ensuciar');
        t.tiene(destino, 'Caches');
    });

    t.test('la clave cambia si el archivo cambió', () => {
        const dir = temporal.carpeta('proxy');
        const ruta = temporal.archivo(dir, 'Clase 01 v1.mov', 'uno');
        const antes = proxy.rutaDeProxy(ruta);
        temporal.archivo(dir, 'Clase 01 v1.mov', 'otro contenido más largo');
        t.ok(proxy.rutaDeProxy(ruta) !== antes, 'Claude rehace una versión con el mismo nombre todo el tiempo');
    });

    t.test('un 4K se escala; un 1080 no', () => {
        const grande = proxy.argumentos('/a.mov', '/b.mp4', temporal.media({ anchoReal: 3840, alto: 2160 }));
        t.tiene(grande.join(' '), 'scale=1920:-2', 'el -2 evita un alto impar, que no es codificable');
        const chico = proxy.argumentos('/a.mov', '/b.mp4', temporal.media());
        t.noTiene(chico.join(' '), 'scale=');
    });

    t.test('sale con el índice adelante, para poder saltar enseguida', () => {
        t.tiene(proxy.argumentos('/a.mov', '/b.mp4', temporal.media()).join(' '), '+faststart');
    });
};
