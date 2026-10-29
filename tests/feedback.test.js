'use strict';
/**
 * El `feedback.md`: el producto de la herramienta.
 *
 * Lo que se prueba acá es lo que hace que Claude pueda trabajar con esto: que
 * las rutas sean absolutas, que los tiempos estén de las tres formas, que se le
 * diga que abra las imágenes y que la precedencia entre los dos niveles esté
 * escrita y no librada a su criterio.
 */

const path = require('path');

const comentarios = require('../engine/comentarios');
const feedback = require('../engine/feedback');
const temporal = require('./lib/temporal');

module.exports = function (t) {
    t.grupo('Feedback');

    const dir = temporal.carpeta('feedback');
    const ruta = temporal.archivo(dir, 'Clase 03 - Hooks v2.mp4');
    const carpeta = path.join(dir, 'Clase 03 - Hooks v2');

    const datos = comentarios.sanear({
        comentarios: [
            {
                id: 'c01',
                t: 83.44,
                texto: 'El título entra muy rápido: que el fade dure el doble.',
                frame: 'frames/c01-00h01m23s10f.png',
                dibujo: 'dibujos/c01-00h01m23s10f.png'
            },
            { id: 'c02', t: 130, tHasta: 138.5, texto: 'Este tramo sobra entero.' },
            { id: 'c03', t: 200, texto: 'Ya está.', estado: 'resuelto' }
        ]
    }, ruta, temporal.media({ fps: 29.97, duracion: 492 }));

    const md = feedback.escribir(datos, {
        rutaVideo: ruta,
        clase: 'Clase 03 - Hooks',
        numeroVersion: 2,
        general: { texto: 'Los títulos nunca en mayúsculas.', ruta: path.join(dir, 'Reviewer', 'comentario-general.md') },
        referencias: [{ ambito: 'curso', nombre: 'logo.svg', numero: 1, tipo: 'imagen', ruta: path.join(dir, 'Reviewer', '_referencias', 'logo.svg') }]
    });

    t.test('el video va con su ruta absoluta', () => {
        t.tiene(md, path.resolve(ruta));
    });

    t.test('cada tiempo está de las tres formas', () => {
        t.tiene(md, '00:01:23:10');
        t.tiene(md, '83.440 s');
        t.tiene(md, 'cuadro 2500 @ 29.97');
    });

    t.test('un tramo dice sus dos extremos y lo que dura', () => {
        t.tiene(md, '00:02:09:26 → 00:02:18:10');
        t.tiene(md, 'dura 8.500 s');
    });

    t.test('los PNG van con ruta absoluta, no relativa', () => {
        t.tiene(md, path.join(carpeta, 'frames', 'c01-00h01m23s10f.png'));
        t.tiene(md, path.join(carpeta, 'dibujos', 'c01-00h01m23s10f.png'));
        t.noTiene(md, '- El cuadro: frames/');
    });

    t.test('cada imagen se nombra en español, no con una etiqueta pegoteada', () => {
        t.tiene(md, '- El cuadro: ');
        t.tiene(md, '- Lo que se dibujó sobre ese cuadro: ');
        t.tiene(md, 'c01 (cuadro) → ');
        t.tiene(md, 'c01 (con el dibujo) → ');
        t.noTiene(md, 'archivo(s)', 'escribir el plural entre paréntesis es no escribirlo');
    });

    t.test('se le pide a Claude que abra las imágenes ANTES de editar', () => {
        t.tiene(md, 'Dónde está cada archivo');
        t.tiene(md, 'antes** de tocar la edición');
    });

    t.test('la cuenta separa lo que falta de lo hecho', () => {
        t.tiene(md, '2 por hacer · 1 ya resueltos');
    });

    t.test('un comentario resuelto lo dice en su encabezado', () => {
        t.tiene(md, 'YA RESUELTO, no hay que hacer nada');
    });

    t.test('la precedencia entre los dos niveles está escrita', () => {
        t.tiene(md, 'Los títulos nunca en mayúsculas.');
        t.tiene(md, 'manda el comentario');
        t.tiene(md, 'No es una invitación a promediar');
    });

    t.test('las menciones se resuelven a su número', () => {
        const conMencion = comentarios.sanear({
            comentarios: [{ id: 'c01', t: 1, texto: 'Como en @[curso/logo.svg].' }]
        }, ruta, temporal.media());
        const salida = feedback.escribir(conMencion, {
            rutaVideo: ruta,
            referencias: [{ ambito: 'curso', nombre: 'logo.svg', numero: 1, tipo: 'imagen', ruta: '/tmp/logo.svg' }]
        });
        t.tiene(salida, 'Como en imagen 1.');
        t.noTiene(salida, '@[curso/logo.svg]');
    });

    t.test('sin comentario general no se escribe esa sección', () => {
        const solo = feedback.escribir(datos, { rutaVideo: ruta, clase: 'X', numeroVersion: 1 });
        t.noTiene(solo, 'todas las clases del curso');
    });

    t.test('el resumen para Claude va arriba de todo, si existe', () => {
        const conInstruccion = feedback.escribir(
            { ...datos, instruccion: { texto: 'Primero el título (c01).', modelo: 'qwen' } },
            { rutaVideo: ruta, clase: 'X', numeroVersion: 1 }
        );
        t.ok(
            conInstruccion.indexOf('## Qué hay que hacer') < conInstruccion.indexOf('## Comentarios de este video'),
            'el encargo va antes de la lista'
        );
    });

    t.test('la ficha del render dice si es vertical', () => {
        const vertical = comentarios.sanear({ comentarios: [{ id: 'c01', t: 0, texto: 'x' }] }, ruta,
            temporal.media({ ancho: 1080, alto: 1920, anchoReal: 1080, vertical: true }));
        t.tiene(feedback.escribir(vertical, { rutaVideo: ruta }), 'vertical (9:16)');
    });
};
