'use strict';
/**
 * iconos.js — Los dibujos de los mandos del reproductor.
 *
 * Están dibujados y no escritos con caracteres. «◀|» y «|▶» eran dos glifos
 * Unicode pegados, y ahí está el problema que se veía: el triángulo y la barra
 * vienen de la misma tipografía pero no comparten caja. La barra vertical se
 * apoya en la línea base del texto y ocupa el alto de una letra; el triángulo
 * está centrado en su propio cuadro y es más alto. Pegados, la barra queda
 * corrida hacia abajo y más corta que el triángulo de al lado — que es
 * exactamente lo que se ve en los dos botones de al lado del play.
 *
 * No hay forma de arreglar eso con CSS: no se puede mover media letra de un
 * texto. Dibujados en un `viewBox` propio, cada pieza cae donde uno la pone.
 *
 * **Todos ocupan de 6.25 a 19.5 sobre 24 y están centrados en el 12.** Tres
 * botones en fila con los dibujos descentrados de a poco se ven torcidos sin
 * que se note por qué, así que la regla es que el centro del dibujo sea el
 * centro del botón, siempre.
 *
 * **Este es el único módulo que escribe la cadena del `<svg>` y el único que
 * decide el grosor del trazo.** Llegó a haber tres helpers `svg()` en tres
 * archivos, los tres con el mismo `viewBox`, el mismo `fill="none"` y el mismo
 * `stroke-linecap`, y con tres grosores distintos que nadie había comparado.
 * `svg`, `RELLENO` y `LINEA` se exportan para que el que necesite dibujar algo
 * importe en vez de volver a escribirlos.
 *
 * La excepción es `marca.js`, que se queda con los suyos y está bien que así
 * sea: lo lee `tools/hacer-icono.js` desde Node para generar el icono del
 * Dock, así que no puede depender de un módulo de la ventana —y además es otro
 * caso de uso, un dibujo de 16 px al que un trazo de acá le quedaría grueso—.
 * Si alguien intenta «unificar» los dos, rompe el generador de iconos.
 */

/** Alto y ancho de la caja de todos los dibujos. */
const CAJA = 24;

/**
 * @param {string} dentro Las piezas del dibujo.
 * @param {number} tamano A cuántos píxeles se pinta. 15 es la fila de botones
 *   de la barra del reproductor; la paleta del iPad pide 22 porque se toca con
 *   el dedo y con el lápiz.
 */
export function svg(dentro, tamano = 15, extra = '') {
    return `<svg viewBox="0 0 ${CAJA} ${CAJA}" width="${tamano}" height="${tamano}" aria-hidden="true"${extra}>${dentro}</svg>`;
}

/** Las piezas macizas: lo que marca una posición o un sentido de reproducción. */
export const RELLENO = 'fill="currentColor"';

/**
 * El triángulo va centrado por su caja y no por su centro de masa.
 *
 * Un triángulo tiene el peso visual del lado de la base, así que centrarlo por
 * su centroide lo correría casi un píxel a la derecha, que es lo que suele
 * hacerse cuando el play está solo. Acá está en una fila con cuatro dibujos
 * más que sí están centrados por caja: alineado con ellos se ve derecho, y
 * compensado se vería como el único corrido.
 */
export const play = svg(`<path ${RELLENO} d="M6 5 L18 12 L6 19 Z"/>`);

export const pausa = svg(
    `<rect ${RELLENO} x="7" y="5" width="3.5" height="14" rx="1"/>` +
    `<rect ${RELLENO} x="13.5" y="5" width="3.5" height="14" rx="1"/>`
);

/**
 * Un cuadro atrás y un cuadro adelante.
 *
 * La barra va del lado del play, que es como estaba. Lo que cambia es que
 * ahora mide lo mismo que el triángulo y está a su misma altura.
 */
export const cuadroAtras = svg(
    `<path ${RELLENO} d="M14.5 5 L14.5 19 L4.5 12 Z"/>` +
    `<rect ${RELLENO} x="16.5" y="5" width="3" height="14" rx="1"/>`
);

export const cuadroAdelante = svg(
    `<rect ${RELLENO} x="4.5" y="5" width="3" height="14" rx="1"/>` +
    `<path ${RELLENO} d="M9.5 5 L9.5 19 L19.5 12 Z"/>`
);

/**
 * Más lento y más rápido.
 *
 * Van de línea y no macizos a propósito. Los macizos son el transporte —dónde
 * está el cabezal y hacia dónde va—; estos dos no mueven el cabezal, cambian
 * a qué ritmo corre. Que se vean de otra familia evita leerlos como el
 * rebobinado que supieron ser, y el número que aparece al lado termina de
 * decirlo.
 */
/**
 * El grosor de todo lo que va de línea, en toda la app. Uno solo, y 2.2.
 *
 * Había tres —2.2 acá, 2 en la paleta del iPad y 1.5 en el icono del Dock— y
 * ninguno se había elegido mirando a los otros. Queda el 2.2 porque es el
 * único de los tres que se midió: sobre la caja de 24 es un 9 % del alto, que
 * es lo que hace que a los 15 px de un botón de barra el trazo siga leyéndose
 * y no se emplaste contra sí mismo en una curva cerrada. El número es del
 * `viewBox`, así que escala solo: los mismos 2.2 a los 22 px de la paleta del
 * iPad dan un trazo proporcionalmente igual, que es justo lo que no pasaba con
 * dos números distintos —los mismos dibujos de deshacer y rehacer se veían con
 * dos pesos y nadie lo había decidido—.
 *
 * El 1.5 de `marca.js` sigue aparte y con su propio motivo escrito: a 16 px un
 * trazo más grueso se cierra.
 */
export const LINEA = 'fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"';

export const masLento = svg(
    `<path ${LINEA} d="M12.25 6.5 L6.25 12 L12.25 17.5"/>` +
    `<path ${LINEA} d="M17.75 6.5 L11.75 12 L17.75 17.5"/>`
);

export const masRapido = svg(
    `<path ${LINEA} d="M11.75 6.5 L17.75 12 L11.75 17.5"/>` +
    `<path ${LINEA} d="M6.25 6.5 L12.25 12 L6.25 17.5"/>`
);
