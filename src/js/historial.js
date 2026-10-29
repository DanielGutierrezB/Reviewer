'use strict';
/**
 * historial.js — Deshacer y rehacer.
 *
 * **Una acción se guarda como dos fotos del estado completo, no como su
 * inversa.** Escribir la inversa de cada cosa —"deshacer un borrado es volver a
 * insertarlo en su posición, con su id, con su cuadro"— es una función por
 * acción, y la que se olvida de escribir es siempre la que alguien agregó
 * después. Con dos fotos, deshacer es el mismo guardado de siempre con otro
 * contenido, y una acción nueva entra al historial sin tocar este archivo.
 *
 * Se puede hacer porque el `comentarios.json` de una versión es chico —unos
 * pocos KB— y porque el motor ya sabe escribir un estado entero: es lo que hace
 * en cada tecla.
 *
 * **El historial es de la versión abierta.** Al cambiar de render se vacía, y
 * con él la papelera donde esperaban los PNG de lo borrado: un `Cmd+Z` que
 * cruzara de video resucitaría un comentario adentro de otro archivo.
 *
 * Lo que NO entra acá son las cosas que no tocan el disco —qué comentario está
 * resaltado, dónde quedó el cabezal—. `Cmd+Z` en un editor devuelve trabajo; si
 * también devolviera la selección, harían falta tres para desandar un cambio.
 */

import { anotar } from './chrome.js';

const MAXIMO = 60;

const pila = {
    ruta: null,
    atras: [],
    adelante: []
};

/** Quien escucha para repintar los botones. Lo pone `app.js`. */
export const al = { cambio: () => {} };

export function sePuedeDeshacer() {
    return pila.atras.length > 0;
}

export function sePuedeRehacer() {
    return pila.adelante.length > 0;
}

/** Qué desharía el próximo `Cmd+Z`, para poder decirlo en pantalla. */
export function queSigue() {
    return {
        atras: sePuedeDeshacer() ? pila.atras[pila.atras.length - 1].nombre : null,
        adelante: sePuedeRehacer() ? pila.adelante[pila.adelante.length - 1].nombre : null
    };
}

/**
 * Empieza (o cambia) el historial de una versión.
 *
 * Vaciar la papelera acá y no al cerrar la app: si Reviewer se cae, los PNG de
 * lo borrado siguen en `.papelera` y se pueden rescatar a mano. Tirarlos en el
 * cierre los perdería justo en el caso en que alguien los querría.
 */
export function abrir(ruta) {
    if (pila.ruta === ruta) return;
    const anterior = pila.ruta;
    pila.ruta = ruta;
    pila.atras = [];
    pila.adelante = [];
    if (anterior) window.rv.papeleraVaciar(anterior);
    al.cambio();
}

/**
 * Anota que algo cambió.
 *
 * `antes` y `despues` son el `comentarios.json` entero de cada lado. Quien
 * llama ya los tiene: `antes` es lo que tenía en pantalla y `despues` es lo que
 * le devolvió el motor.
 */
export function registrar(nombre, antes, despues) {
    if (!pila.ruta || !antes || !despues) return;
    pila.atras.push({ nombre, antes, despues });
    // Rehacer deja de tener sentido en cuanto se hace algo nuevo: la rama que
    // quedaba adelante ya no sale del estado en el que estamos.
    pila.adelante = [];
    if (pila.atras.length > MAXIMO) pila.atras.shift();
    al.cambio();
}

async function viajar(paso, hacia) {
    const datos = await window.rv.comentariosAplicar(pila.ruta, paso[hacia]);
    al.cambio();
    return { datos, nombre: paso.nombre };
}

/** Devuelve el estado nuevo, o `null` si no había nada que deshacer. */
export async function deshacer() {
    if (!sePuedeDeshacer()) return null;
    const paso = pila.atras.pop();
    pila.adelante.push(paso);
    anotar('historial.deshace', { que: paso.nombre });
    return viajar(paso, 'antes');
}

export async function rehacer() {
    if (!sePuedeRehacer()) return null;
    const paso = pila.adelante.pop();
    pila.atras.push(paso);
    anotar('historial.rehace', { que: paso.nombre });
    return viajar(paso, 'despues');
}
