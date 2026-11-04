'use strict';
/**
 * vistas.js — Las dos pestañas de la ventana, Revisión y Render, y la
 * insignia que dice si hay que mirar la segunda.
 *
 * Las pestañas están desde la primera pantalla, antes de abrir ninguna
 * carpeta: el que abre la app solo para que el Mac renderice tiene que poder
 * entrar a Render sin elegir nada que revisar. Por eso «Revisión» sin carpeta
 * es la pantalla de inicio —elegir carpeta, recientes— y con carpeta es el
 * visor; las dos son la misma pestaña.
 *
 * Las vistas se esconden, no se desarman: el reproductor sigue cargado con su
 * cabezal donde estaba y el comentario a medio escribir sigue en el campo. Ir
 * a ver cómo va un render y volver no puede costar el lugar en el video.
 */

import { $ } from './chrome.js';
import { estado } from './estado.js';
import * as reproductor from './reproductor.js';
import * as render from './render.js';

/**
 * Pasa de Revisión a Render y al revés.
 *
 * Lo único que sí se hace al salir de Revisión es pausar. Un video que sigue
 * sonando desde una pestaña que no se ve es un ruido que no se sabe apagar.
 */
export function ver(cual) {
    const aRender = cual === 'render';
    if (aRender) reproductor.pausar();

    $('#vistas').hidden = false;
    $('#vista-inicio').hidden = aRender || Boolean(estado.raiz);
    $('#vista-revision').hidden = aRender || !estado.raiz;
    $('#vista-render').hidden = !aRender;
    for (const tab of document.querySelectorAll('.vista-tab')) {
        tab.classList.toggle('is-activa', tab.dataset.vista === cual);
    }
    if (aRender) render.alAbrir();
    pintarInsignia();
}

/** Si lo que se está viendo es la pestaña de Render. */
export const enRender = () => !$('#vista-render').hidden;

/**
 * La insignia de la pestaña de Render.
 *
 * Es lo que hace que la pestaña sirva sin abrirla, así que dice lo mínimo: un
 * punto de color y, cuando hay varias, cuántas. Qué es urgente no se decide
 * acá —viene resuelto en `resumen`, que tiene sus tests— salvo lo único que
 * esta ventana sabe y el disco no: qué entregas todavía no miró nadie.
 */
export function pintarInsignia() {
    const caja = $('#vista-insignia');
    const estadoDelTaller = render.ultimo();
    const r = estadoDelTaller && estadoDelTaller.resumen;
    const sinVer = enRender() ? 0 : render.sinVer();

    let tono = null;
    let cuantos = '';
    let titulo = '';
    if (r && r.tono === 'mal') {
        tono = 'es-mal';
        cuantos = String(r.cuantos || '');
        titulo = r.texto;
    } else if (r && r.tono === 'trabajando') {
        tono = 'es-trabajando';
        cuantos = r.porcentaje === null || r.porcentaje === undefined ? '' : `${r.porcentaje}%`;
        titulo = r.texto;
    } else if (sinVer) {
        tono = 'es-listo';
        cuantos = String(sinVer);
        titulo = `${sinVer} ${sinVer === 1 ? 'entrega nueva' : 'entregas nuevas'} sin ver`;
    }

    caja.hidden = !tono;
    caja.className = `vista-insignia ${tono || ''}`;
    caja.textContent = cuantos;
    caja.closest('.vista-tab').title = titulo || 'Lo que el Mac está exportando';
}

/** Ata las pestañas y deja la ventana en Revisión, que sin carpeta es el inicio. */
export function wire() {
    for (const tab of document.querySelectorAll('.vista-tab')) {
        tab.addEventListener('click', () => ver(tab.dataset.vista));
    }
    render.al.cambio = pintarInsignia;
    ver('revision');
}
