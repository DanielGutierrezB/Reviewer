'use strict';
/**
 * chrome.js — Lo que toda la ventana usa: buscar nodos, avisar algo, anotar en
 * el diario y escapar texto antes de meterlo en HTML.
 */

export const $ = sel => document.querySelector(sel);
export const $$ = sel => [...document.querySelectorAll(sel)];

/** Una línea en el diario de la sesión, que lo lleva el proceso principal. */
export function anotar(evento, datos) {
    try {
        window.rv.anotar(evento, datos || {});
    } catch (e) { /* el diario nunca puede romper la ventana */ }
}

let avisoReloj = null;

/**
 * El cartelito de abajo.
 *
 * Se usa para lo que pasó y se puede seguir sin leer ("copiado"), no para lo
 * que hay que decidir: eso va en el sitio donde se decide.
 */
export function avisar(texto, tono) {
    const caja = $('#aviso');
    caja.textContent = texto;
    caja.className = `aviso${tono ? ` is-${tono}` : ''}`;
    caja.hidden = false;
    clearTimeout(avisoReloj);
    avisoReloj = setTimeout(() => { caja.hidden = true; }, tono === 'mal' ? 6000 : 2600);
}

/** Texto que viene del disco o del editor, listo para meter en HTML. */
export function escapar(texto) {
    return String(texto == null ? '' : texto)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * Si este evento de teclado pasó adentro de algo donde se está escribiendo.
 *
 * Es la guarda de TODOS los atajos de una letra sola, y está acá —y no copiada
 * en cada manejador— porque una copia que se quede atrás no falla al cargar:
 * falla el día que alguien escribe la palabra «idea» dentro de un comentario y
 * se le abre otro comentario encima.
 *
 * El `target` de un `keydown` escuchado en `window` es el elemento con el foco,
 * así que mirarlo a él alcanza. `isContentEditable` se hereda, y eso importa:
 * el texto de una tarjeta es editable y adentro tiene `<span>` de menciones, de
 * modo que el foco puede caer en el span y no en el campo. El span contesta
 * `true` igual.
 */
export function enCampoDeTexto(evento) {
    const donde = evento.target;
    return Boolean(donde) && (
        /^(INPUT|TEXTAREA|SELECT)$/.test(donde.tagName) || donde.isContentEditable
    );
}

/** El nombre de una carpeta o archivo, sin la ruta. */
export function nombreDe(ruta) {
    return String(ruta || '').split('/').filter(Boolean).pop() || ruta;
}

/**
 * Llama a `fn` como mucho cada `ms`, y siempre una última vez al final.
 *
 * El arrastre del cabezal dispara cincuenta eventos por segundo y cada uno
 * repinta la línea: sin esto, mover el cabezal en un video largo se siente
 * pegajoso.
 */
export function aRitmo(fn, ms) {
    let ultimo = 0;
    let pendiente = null;
    return (...args) => {
        const ahora = Date.now();
        clearTimeout(pendiente);
        if (ahora - ultimo >= ms) {
            ultimo = ahora;
            fn(...args);
        } else {
            pendiente = setTimeout(() => { ultimo = Date.now(); fn(...args); }, ms - (ahora - ultimo));
        }
    };
}
