'use strict';
/**
 * micro.js — Qué micrófono está abierto, dicho donde se mira.
 *
 * La lista de micrófonos vive en un solo lugar y la pintan dos controles: el de
 * la barra de arriba y el de Ajustes. Antes la armaba Ajustes para sí mismo, y
 * saber con qué se iba a grabar costaba abrir un modal — demasiado lejos para
 * algo que se verifica antes de cada dictado cuando hay una interfaz de audio,
 * unos auriculares y la webcam enchufados a la vez.
 *
 * **Hay un botón de volver a buscar porque la lista no se entera sola.** Un
 * micrófono USB enchufado después de abrir la app no aparece hasta que alguien
 * pregunta de nuevo. El navegador avisa por `devicechange` y acá se escucha,
 * pero el evento no siempre llega —según el driver y según si ya se dio
 * permiso—, así que el botón es la salida cuando no llegó.
 *
 * **La primera opción dice cuál es el del sistema, no que hay uno.** «El del
 * sistema» a secas obliga a abrir el menú para saber con qué se graba, que es
 * justo lo que esta barra vino a evitar.
 *
 * **Los nombres solo existen después del permiso.** Sin él, `enumerateDevices`
 * devuelve entradas con la etiqueta vacía; en ese caso se muestra «El del
 * sistema» y se dice por qué, en vez de una lista de «Micrófono 1, Micrófono 2»
 * que no ayuda a elegir.
 */

import { $, anotar } from './chrome.js';
import { estado } from './estado.js';
import * as dictado from './dictado.js';

/** Quien escucha. Lo pone `ajustes.js` para repintar su propio desplegable. */
export const al = { cambio: () => {} };

let entradas = [];

export function lista() {
    return entradas;
}

/** El id guardado en ajustes, o '' si es el del sistema. */
function elegido() {
    return (estado.ajustes && estado.ajustes.dictado.microfono) || '';
}

/**
 * Cómo se llama el micrófono que el sistema eligió, o '' si no se puede saber.
 *
 * Chromium lo lista dos veces: una entrada `default` con la etiqueta prefijada
 * —«Default - MacBook Pro Microphone (Built-in)»— y la entrada de verdad, con
 * el mismo `groupId`. El nombre se saca de la de verdad y no de la `default`
 * porque ese prefijo viene traducido al idioma del sistema y recortarlo a mano
 * es adivinar dónde termina: hay micrófonos con guiones en el nombre.
 *
 * Sin permiso las etiquetas llegan vacías y no hay nada que decir: devuelve ''
 * y arriba se cae al texto genérico.
 */
export function nombreDelSistema(micros) {
    const sistema = micros.find(d => d.deviceId === 'default');
    if (!sistema || !sistema.label) return '';
    const real = micros.find(d => d !== sistema && d.groupId && d.groupId === sistema.groupId && d.label);
    const nombre = real ? real.label : sistema.label.replace(/^[^-]+ - /, '');

    // Se le saca el paréntesis con que el sistema desambigua el hardware
    // —«(Built-in)», «(3564:fefb)»—: el rótulo termina con un paréntesis
    // propio y dos seguidos no se leen, y acá cada letra cuenta porque el
    // desplegable de la barra se recorta a 170px.
    return nombre.replace(/\s*\([^()]*\)\s*$/, '').trim();
}

/** Llena un `<select>` con los micrófonos que haya. */
export function llenar(select) {
    if (!select) return;
    const actual = elegido();
    select.textContent = '';

    // La entrada `default` no se lista aparte: es el mismo micrófono que la
    // opción de arriba, y ahora que esa dice su nombre verlo dos veces hace
    // dudar de si son dos cosas distintas.
    const propios = entradas.filter(d => d.deviceId && d.deviceId !== 'default');

    const nombre = nombreDelSistema(entradas);
    const porDefecto = document.createElement('option');
    porDefecto.value = '';
    porDefecto.textContent = nombre ? `${nombre} (Sistema)` : 'El del sistema';
    select.appendChild(porDefecto);

    for (const d of propios) {
        const op = document.createElement('option');
        op.value = d.deviceId;
        op.textContent = d.label || 'Micrófono sin nombre';
        select.appendChild(op);
    }

    // Si el que estaba guardado ya no está —se desenchufó, o era la entrada
    // `default` de cuando esta lista la ofrecía—, el desplegable cae en «el del
    // sistema», que es lo que de verdad va a usar.
    select.value = propios.some(d => d.deviceId === actual) ? actual : '';
}

/** Vuelve a preguntarle al sistema qué micrófonos hay y repinta los dos controles. */
export async function buscar() {
    try {
        entradas = (await navigator.mediaDevices.enumerateDevices())
            .filter(d => d.kind === 'audioinput');
    } catch (e) {
        entradas = [];
    }
    llenar($('#micro-elegido'));
    pintar();
    al.cambio();
    return entradas;
}

/** El punto de color y si el desplegable se puede tocar. */
export function pintar() {
    const barra = $('#micro-barra');
    const select = $('#micro-elegido');
    barra.hidden = false;
    barra.classList.toggle('is-oyendo', dictado.oyendo());
    barra.classList.toggle('is-mudo', !estado.puedeDictar);

    // Mientras se está dictando no se cambia de micrófono: el audio ya está
    // entrando por uno y cambiarlo a mitad de frase partiría la transcripción
    // en dos pedazos que no se conocen.
    select.disabled = !estado.puedeDictar || dictado.oyendo();
    select.title = !estado.puedeDictar
        ? (estado.dictadoMotivo || 'Esta Mac no puede dictar')
        : (dictado.oyendo()
            ? 'Escuchando: no se cambia a mitad de dictado'
            : (entradas.length && entradas[0].label
                ? 'Con qué micrófono se dicta'
                : 'Los nombres aparecen después del primer dictado, cuando macOS da permiso'));
}

async function guardar(deviceId) {
    estado.ajustes = await window.rv.ajustesParchear({ dictado: { microfono: deviceId } });
    al.cambio();
    anotar('microfono.elige', { porDefecto: !deviceId });
}

export function wire() {
    $('#micro-elegido').addEventListener('change', e => guardar(e.target.value));
    $('#micro-buscar').addEventListener('click', buscar);
    $('#dict-micro-buscar').addEventListener('click', buscar);

    // Enchufar o desenchufar algo. No siempre llega, de ahí el botón.
    try {
        navigator.mediaDevices.addEventListener('devicechange', buscar);
    } catch (e) { /* no está en todas partes; queda el botón */ }
}
