'use strict';
/**
 * marcadores.js — A qué comentario le hablan I y O desde donde está el cabezal.
 *
 * M deja un marcador donde estoy; I y O no dejan nada, corrigen uno que ya
 * está. Esa es toda la diferencia, y es la que permite precisar un tramo sin
 * soltar la mano del teclado: se mira la pasada entera, se deja la marca al
 * vuelo con M, y después se vuelve y se ajusta —I donde de verdad empieza, O
 * donde de verdad termina— sin tener que borrar y rehacer.
 *
 * El problema de verdad no es mover el tiempo, es **elegir a cuál**. Con quince
 * marcas en la línea, una tecla que corrige «alguno» es una tecla que no se
 * puede usar sin mirar qué hizo. Las reglas de acá abajo existen para que la
 * respuesta sea siempre la que uno tenía en la cabeza, y están en un módulo
 * aparte —sin DOM, sin estado— porque son la parte que hay que poder probar sin
 * abrir la app ni mover un video.
 *
 * **El estado no entra en la cuenta.** Un comentario resuelto que está adelante
 * se elige igual que uno abierto: lo que decide es dónde cae el cabezal, y una
 * regla que además mirara el estado obligaría a acordarse de cuáles están
 * resueltos para saber a quién le va a hablar la tecla.
 */

/**
 * Si el cabezal cae adentro del tramo de un comentario.
 *
 * Los bordes cuentan como adentro. Parado justo sobre la salida, lo que uno
 * quiere corregir es esa salida, no la de otro marcador más adelante.
 */
export function dentro(comentario, t) {
    return comentario.tHasta != null && t >= comentario.t && t <= comentario.tHasta;
}

/**
 * De varios tramos que se pisan, el que empezó último.
 *
 * Es el de adentro cuando uno contiene al otro, y el más nuevo cuando se
 * solapan a medias: en los dos casos es el que se acaba de entrar, que es del
 * que uno está hablando.
 */
function elMasAdentro(candidatos) {
    return candidatos.reduce((mejor, c) => (mejor == null || c.t > mejor.t ? c : mejor), null);
}

/**
 * A quién le mueve la entrada la tecla I.
 *
 * Primero el tramo donde estoy parado —estar adentro es decir «de este
 * hablo»— y si no, el marcador más cercano hacia adelante: la corrección
 * típica es «esto en realidad empieza antes», o sea retroceder hasta donde
 * empieza de verdad y traer la entrada hasta acá.
 *
 * Hacia atrás no se busca nunca, y es la mitad de la regla. Un marcador que
 * quedó atrás ya se pasó: si I lo agarrara, cada vez que no hubiera nada
 * adelante la tecla iría a manotear el último que uno dejó, que es justo el que
 * ya estaba bien.
 */
export function paraEntrada(comentarios, t) {
    const adentro = elMasAdentro(comentarios.filter(c => dentro(c, t)));
    if (adentro) return adentro;

    return comentarios
        .filter(c => c.t >= t)
        .reduce((mejor, c) => (mejor == null || c.t < mejor.t ? c : mejor), null);
}

/**
 * A quién le mueve la salida la tecla O.
 *
 * Primero el tramo donde estoy, igual que la entrada, y ahí O **acorta**: es lo
 * que pidió el editor —«si estoy dentro de una selección, que tome el out que
 * le sigue»— y es lo que faltaba, porque hasta acá un tramo ya cerrado no se
 * podía tocar con el teclado.
 *
 * Afuera de todo tramo, el último instante que quedó atrás, que es O de toda la
 * vida: se mira sin frenar, se deja la marca donde empieza el problema y se
 * cierra donde termina.
 *
 * **Afuera de un tramo, los tramos no se tocan**, solo los instantes. Estar
 * fuera de un tramo que quedó atrás quiere decir que ya está cerrado y que uno
 * siguió de largo; estirarlo hasta acá sería pisar un final que alguien puso a
 * propósito. Para eso está meterse adentro, o arrastrar el borde con Opt.
 */
export function paraSalida(comentarios, t) {
    const adentro = elMasAdentro(comentarios.filter(c => dentro(c, t)));
    if (adentro) return adentro;

    return comentarios
        .filter(c => c.tHasta == null && c.t < t)
        .reduce((mejor, c) => (mejor == null || c.t > mejor.t ? c : mejor), null);
}
