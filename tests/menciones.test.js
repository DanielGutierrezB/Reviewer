'use strict';
/**
 * Las menciones a archivos dentro de un comentario.
 *
 * Es el sistema que se copió de HyperPremiere y el modo de falla que vino a
 * tapar —una referencia que se pierde al reescribir y deja la nota hablando de
 * «el logo» sin decir cuál— no se ve desde afuera. Por eso tiene tests.
 */

const menciones = require('../engine/menciones');

module.exports = function (t) {
    t.grupo('Menciones');

    t.test('se escriben con su ámbito', () => {
        t.eq(menciones.escribir('curso', 'manual.pdf'), '@[curso/manual.pdf]');
        t.eq(menciones.escribir('video', 'captura.png'), '@[video/captura.png]');
    });

    t.test('se encuentran en el texto, en orden', () => {
        const encontradas = menciones.encontrar('Como en @[curso/logo.svg] y @[video/captura 2.png].');
        t.eq(encontradas.length, 2);
        t.eq(encontradas[0].ambito, 'curso');
        t.eq(encontradas[0].nombre, 'logo.svg');
        t.eq(encontradas[1].nombre, 'captura 2.png', 'los espacios del nombre llegan enteros');
    });

    t.test('una sin ámbito también cuenta', () => {
        const [m] = menciones.encontrar('mirá @[logo.png]');
        t.eq(m.ambito, null);
        t.eq(m.nombre, 'logo.png');
    });

    t.test('se ve cuál perdió un refinado', () => {
        const original = 'El color de @[curso/manual.pdf] y el encuadre de @[curso/ref.png].';
        t.deep(menciones.perdidas('El color del manual y el encuadre de @[curso/ref.png].', original), ['@[curso/manual.pdf]']);
        t.deep(menciones.perdidas(original, original), [], 'si están todas, no falta nada');
    });

    t.test('perder una y repetir otra NO da cero', () => {
        // Comparar la cantidad en vez de los tokens dejaría pasar justo esto.
        const original = 'Van @[curso/a.png] y @[curso/b.png].';
        t.deep(menciones.perdidas('Van @[curso/b.png] y @[curso/b.png].', original), ['@[curso/a.png]']);
    });

    t.test('una mención reescrita a medias cuenta como perdida', () => {
        const original = 'mirá @[curso/manual-de-marca.pdf]';
        t.deep(menciones.perdidas('mirá @[curso/manual-de-marca]', original), ['@[curso/manual-de-marca.pdf]']);
    });

    t.grupo('Menciones: resolver para Claude');

    const refs = [
        { ambito: 'curso', nombre: 'logo.svg', numero: 1, tipo: 'imagen' },
        { ambito: 'curso', nombre: 'manual.pdf', numero: null, tipo: 'documento' }
    ];

    t.test('una imagen se vuelve su número', () => {
        const { texto } = menciones.resolver('Usá @[curso/logo.svg] arriba.', refs);
        t.eq(texto, 'Usá imagen 1 arriba.');
    });

    t.test('un documento se nombra', () => {
        const { texto } = menciones.resolver('Mirá @[curso/manual.pdf].', refs);
        t.eq(texto, 'Mirá el documento «manual.pdf».');
    });

    t.test('una que ya no está se DICE, no se borra', () => {
        // Borrarla dejaría la frase hablando de nada y nadie se enteraría.
        const r = menciones.resolver('Como en @[curso/paleta.png].', refs);
        t.tiene(r.texto, 'ya no está adjunta');
        t.deep(r.colgadas, ['curso/paleta.png']);
    });
};
