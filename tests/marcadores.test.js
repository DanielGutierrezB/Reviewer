'use strict';
/**
 * A qué marcador le hablan I y O.
 *
 * Esto se prueba porque es la parte que no se puede verificar mirando: con una
 * sola marca en la línea cualquier regla parece correcta, y el error aparece
 * con quince, cuando la tecla corrige una que no era y el editor se entera dos
 * comentarios después. Los casos de acá son las situaciones donde dos
 * marcadores compiten.
 */

const path = require('path');

const RUTA = path.join(__dirname, '..', 'src', 'js', 'marcadores.js');

/** Un instante. */
function punto(id, t) {
    return { id, t, tHasta: null };
}

/** Un tramo. */
function tramo(id, t, tHasta) {
    return { id, t, tHasta };
}

module.exports = async function (t) {
    t.grupo('Marcadores');

    const m = await import(RUTA);

    t.test('los bordes de un tramo cuentan como estar adentro', () => {
        // Parado justo sobre la salida, lo que uno quiere corregir es esa
        // salida. Con el borde afuera, O se iría a buscar un instante anterior
        // y dejaría el tramo —el que uno está mirando— sin tocar.
        const c = tramo('c01', 4, 8);
        t.eq(m.dentro(c, 4), true, 'la entrada');
        t.eq(m.dentro(c, 8), true, 'la salida');
        t.eq(m.dentro(c, 6), true, 'el medio');
        t.eq(m.dentro(c, 3.9), false);
        t.eq(m.dentro(c, 8.1), false);
    });

    t.test('un instante no tiene adentro', () => {
        t.eq(m.dentro(punto('c01', 4), 4), false);
    });

    t.test('sin marcadores, las dos teclas no eligen nada', () => {
        t.eq(m.paraEntrada([], 5), null);
        t.eq(m.paraSalida([], 5), null);
    });

    // ── La entrada (I) ──────────────────────────────────────────

    t.test('la entrada agarra el marcador más cercano hacia adelante', () => {
        const lista = [punto('c01', 2), punto('c02', 10), punto('c03', 20)];
        t.eq(m.paraEntrada(lista, 5).id, 'c02', 'el de 10, no el de 20');
    });

    t.test('la entrada no mira hacia atrás', () => {
        // Es la mitad de la regla: un marcador que quedó atrás ya se pasó. Si I
        // lo agarrara, la tecla iría a manotear el último que uno dejó bien.
        t.eq(m.paraEntrada([punto('c01', 2)], 5), null);
    });

    t.test('parado justo sobre un marcador, la entrada lo elige a él', () => {
        // Hace falta que lo devuelva para poder contestar «ya empieza acá» en
        // vez de «no hay ninguno adelante», que sería mentira con la marca
        // abajo del cabezal.
        t.eq(m.paraEntrada([punto('c01', 5)], 5).id, 'c01');
    });

    t.test('adentro de un tramo, la entrada corrige ese tramo y no el de adelante', () => {
        const lista = [tramo('c01', 4, 12), punto('c02', 7)];
        t.eq(m.paraEntrada(lista, 6).id, 'c01', 'el tramo donde estoy parado');
    });

    // ── La salida (O) ───────────────────────────────────────────

    t.test('adentro de un tramo, la salida acorta ese tramo', () => {
        // Lo que faltaba: hasta acá un tramo ya cerrado no se podía tocar con
        // el teclado, y para recortarlo había que borrar el comentario entero.
        const lista = [punto('c01', 1), tramo('c02', 4, 12)];
        t.eq(m.paraSalida(lista, 6).id, 'c02');
    });

    t.test('afuera de todo tramo, la salida cierra el último instante de atrás', () => {
        const lista = [punto('c01', 2), punto('c02', 6), punto('c03', 20)];
        t.eq(m.paraSalida(lista, 10).id, 'c02', 'el más cercano por atrás');
    });

    t.test('afuera de un tramo que quedó atrás, la salida no lo estira', () => {
        // Estar afuera de un tramo cerrado quiere decir que uno siguió de
        // largo; estirarlo hasta acá sería pisar un final puesto a propósito.
        // Para eso hay que meterse adentro, o arrastrar el borde con Opt.
        t.eq(m.paraSalida([tramo('c01', 2, 5)], 9), null);
    });

    t.test('la salida no se va a buscar un instante que está adelante', () => {
        t.eq(m.paraSalida([punto('c01', 20)], 5), null);
    });

    // ── Tramos que se pisan ─────────────────────────────────────

    t.test('entre dos tramos que se pisan gana el que empezó último', () => {
        // Es el de adentro cuando uno contiene al otro, y el más nuevo cuando
        // se solapan a medias: en los dos casos es el que uno acaba de entrar.
        const lista = [tramo('c01', 0, 30), tramo('c02', 10, 20)];
        t.eq(m.paraEntrada(lista, 15).id, 'c02');
        t.eq(m.paraSalida(lista, 15).id, 'c02');
    });

    t.test('el orden de la lista no cambia a quién eligen', () => {
        // Los comentarios llegan en el orden en que se escribieron, que no es
        // el orden del video: uno puede comentar el final y después el medio.
        const lista = [punto('c03', 20), punto('c01', 2), punto('c02', 10)];
        t.eq(m.paraEntrada(lista, 5).id, 'c02');
        t.eq(m.paraSalida(lista, 15).id, 'c02');
    });
};
