'use strict';
/**
 * marca.js — El dibujo de Reviewer, en un solo lugar.
 *
 * Lo usan dos cosas que tienen que verse iguales: la barra de arriba de la
 * ventana y el icono del Dock, que `tools/hacer-icono.js` lee de acá. Con el
 * dibujo copiado en dos sitios, el día que cambie va a cambiar en uno y nadie
 * se va a enterar hasta ver los dos juntos.
 *
 * Es lo que hace la app: una marca puesta sobre un cuadro. El cuadro es el
 * rectángulo; la marca, el círculo con el punto adentro.
 *
 * El viewBox es de 24 y el trazo de 1.5 porque así está dibujado el resto de
 * los iconos de la interfaz, y porque a 16 píxeles —el tamaño más chico del
 * `.icns`— un trazo más fino desaparece.
 */

export const VIEWBOX = 24;

export const MARCA = [
    // El cuadro.
    '<rect x="2.25" y="4.75" width="19.5" height="14.5" rx="2.5"/>',
    // La marca encima: el anillo y el punto, que es lo que queda legible
    // cuando el icono mide 16 píxeles y el rectángulo ya es una línea.
    '<circle cx="12" cy="12" r="4.4"/>',
    '<circle cx="12" cy="12" r="1.35" fill="currentColor" stroke="none"/>'
].join('');

/** El `<svg>` entero, listo para meter en el DOM. */
export function svg(tamano = 16) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${tamano}" height="${tamano}"
        viewBox="0 0 ${VIEWBOX} ${VIEWBOX}" fill="none" stroke="currentColor"
        stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"
        aria-hidden="true">${MARCA}</svg>`;
}
