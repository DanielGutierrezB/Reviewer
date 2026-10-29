'use strict';
/**
 * menu-arroba.js — Escribir `@` y elegir un archivo de la lista.
 *
 * Existe porque tocar una miniatura obliga a sacar la mano del teclado en
 * medio de una frase, y el pedido fue poder referenciar «fácilmente». Con el
 * menú, `@2` y Enter deja escrita la referencia sin mover la mano.
 *
 * **`@2` no es una sintaxis: es una consulta.** Lo tecleado se reemplaza
 * entero por el token con el NOMBRE del archivo (`@[adjunto/paleta.png]`). El
 * editor escribe lo que piensa —«la 2»— y lo que queda guardado sobrevive a
 * que la lista se mueva. Si se guardara el `@2`, borrar el adjunto de arriba
 * haría que el comentario pasara a hablar de otro archivo y nada fallaría: se
 * vería en el render de mañana. Esa es toda la razón de este módulo.
 *
 * **Uno solo para toda la ventana.** Hay un campo con el foco a la vez, así
 * que un menú por tarjeta serían quince nodos escuchando el teclado para que
 * catorce no hagan nada.
 *
 * Las reglas difíciles —cuándo un `@` NO abre el menú, cómo filtra— viven en
 * `menciones-campo.js` como funciones puras y tienen sus tests. Acá está el
 * DOM, que es lo que no se puede fijar sin ventana.
 */

import { $, escapar } from './chrome.js';
import * as campoMenciones from './menciones-campo.js';

let caja = null;
let abierto = null;

/** Quién pinta la lista de candidatos. Lo pone `app.js`. */
export const al = { items: () => [], elegir: () => {} };

function nodo() {
    if (caja) return caja;
    caja = document.createElement('div');
    caja.className = 'menu-arroba';
    caja.hidden = true;
    document.body.appendChild(caja);
    // `mousedown` y no `click`: el clic le saca el foco al campo antes de
    // llegar acá, y para insertar hace falta que el cursor siga donde estaba.
    caja.addEventListener('mousedown', evento => {
        const fila = evento.target.closest('[data-indice]');
        if (!fila) return;
        evento.preventDefault();
        elegir(Number(fila.dataset.indice));
    });
    return caja;
}

export function cerrar() {
    abierto = null;
    if (caja) caja.hidden = true;
}

export function estaAbierto() {
    return Boolean(abierto);
}

/**
 * El texto y el cursor del campo que tenga el foco.
 *
 * El `<textarea>` del redactor y el `contenteditable` de una tarjeta se
 * preguntan distinto, pero la consulta del `@` **siempre cae adentro de un
 * solo nodo de texto**: no puede tener espacios ni corchetes, y los chips son
 * nodos aparte. Por eso en la tarjeta alcanza con mirar el nodo donde está el
 * cursor, y no hace falta traducir una posición global —que es justo la
 * aritmética que este diseño evita en todos lados.
 */
function leer(campo) {
    if (campo.tagName === 'TEXTAREA') {
        return { texto: campo.value, cursor: campo.selectionStart, nodoTexto: null };
    }
    const sel = document.getSelection();
    if (!sel || !sel.rangeCount) return null;
    const n = sel.focusNode;
    if (!n || n.nodeType !== 3 || !campo.contains(n)) return null;
    return { texto: n.nodeValue, cursor: sel.focusOffset, nodoTexto: n };
}

/** Repinta y coloca el menú debajo del cursor, o lo cierra si no hay nada. */
export function revisar(campo) {
    const leido = leer(campo);
    if (!leido) return cerrar();

    const d = campoMenciones.disparo(leido.texto, leido.cursor);
    if (!d) return cerrar();

    const items = campoMenciones.candidatos(al.items(campo), d.consulta);
    abierto = { campo, ...d, items, elegido: 0, nodoTexto: leido.nodoTexto };
    pintar();
}

function pintar() {
    const c = nodo();
    if (!abierto) return;

    // Con cero referencias no se abre un menú vacío: se dice de dónde salen.
    // Un recuadro en blanco parece que la app se colgó.
    if (!abierto.items.length) {
        c.innerHTML = '<p class="menu-arroba-vacio">No hay archivos en este comentario. '
            + 'Soltá uno sobre la tarjeta, o pegá una imagen con ⌘V.</p>';
    } else {
        c.innerHTML = abierto.items.map((i, n) => `
            <button type="button" class="menu-arroba-fila${n === abierto.elegido ? ' is-elegida' : ''}"
                    data-indice="${n}">
                <span class="menu-arroba-num">${escapar(String(i.numero))}</span>
                <span class="menu-arroba-nombre">${escapar(i.nombre)}</span>
                <span class="menu-arroba-que">${escapar(i.detalle || '')}</span>
            </button>`).join('');
    }

    c.hidden = false;
    const caja2 = abierto.campo.getBoundingClientRect();
    c.style.left = `${Math.round(caja2.left)}px`;
    c.style.top = `${Math.round(caja2.bottom + 2)}px`;
    c.style.width = `${Math.round(caja2.width)}px`;
}

function elegir(indice) {
    if (!abierto || !abierto.items.length) return cerrar();
    const item = abierto.items[Math.max(0, Math.min(abierto.items.length - 1, indice))];
    const { campo, desde, hasta, nodoTexto } = abierto;
    cerrar();
    al.elegir(campo, item, { desde, hasta, nodoTexto });
}

/**
 * Las teclas del menú. Devuelve `true` si se la quedó.
 *
 * Enter se ataja con todo: si se le escapa al campo, elegir una referencia
 * deja además un renglón suelto en el comentario —y en el redactor, donde
 * ⌘Enter guarda, un Enter perdido es un párrafo de más en cada mención—.
 */
export function teclas(evento) {
    if (!abierto) return false;
    const n = abierto.items.length;

    switch (evento.key) {
        case 'Escape':
            cerrar();
            return true;
        case 'ArrowDown':
            if (n) { abierto.elegido = (abierto.elegido + 1) % n; pintar(); }
            return true;
        case 'ArrowUp':
            if (n) { abierto.elegido = (abierto.elegido - 1 + n) % n; pintar(); }
            return true;
        case 'Enter':
        case 'Tab':
            if (!n) { cerrar(); return true; }
            elegir(abierto.elegido);
            return true;
        default:
            return false;
    }
}

/** Cerrarlo al hacer clic en cualquier otro lado. */
export function wire() {
    document.addEventListener('mousedown', evento => {
        if (caja && !caja.hidden && !caja.contains(evento.target)) cerrar();
    });
    window.addEventListener('resize', cerrar);
    $('#panel').addEventListener('scroll', cerrar);
}
