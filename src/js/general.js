'use strict';
/**
 * general.js — El bloque de arriba del panel: lo que vale para todas las clases,
 * y los archivos que lo acompañan.
 *
 * Va arriba y plegado. Arriba porque el panel se lee de alcance más ancho a más
 * angosto —el curso, después este video—, y plegado porque es lo que menos
 * cambia: se escribe una vez al empezar el curso y después se mira de vez en
 * cuando. El badge dice si tiene algo sin desplegarlo.
 */

import { $, avisar, escapar } from './chrome.js';
import { estado } from './estado.js';

/** Quien escucha. Lo pone `app.js`. */
export const al = { cambio: () => {} };

let guardando = null;

function pintarBadge() {
    const badge = $('#general-badge');
    const hay = Boolean(estado.general && estado.general.texto.trim());
    const refs = (estado.referencias || []).filter(r => !r.falta).length;
    badge.textContent = hay
        ? `✓ escrito${refs ? ` · ${refs} adj.` : ''}`
        : (refs ? `${refs} adj.` : 'sin escribir');
    badge.className = `badge${hay ? ' is-lleno' : ''}`;
}

function pintarReferencias() {
    const lista = $('#refs-lista');
    lista.textContent = '';
    const refs = estado.referencias || [];

    for (const ref of refs) {
        const li = document.createElement('li');
        li.className = `ref${ref.falta ? ' falta' : ''}`;
        const mini = ref.tipo === 'imagen' && ref.url
            ? `<img src="${ref.url}" alt="">`
            : `<span class="ref-icono">${ref.tipo === 'imagen' ? '🖼' : '📄'}</span>`;
        li.innerHTML = `
            ${mini}
            <span class="ref-nombre" title="${escapar(ref.ruta)}">${escapar(ref.nombre)}</span>
            <span class="ref-num">${ref.falta ? 'no está' : (ref.numero ? `imagen ${ref.numero}` : 'doc')}</span>
            <button type="button" class="icono icono-chico" data-quitar="${escapar(ref.file)}" title="Quitarla">✕</button>`;
        // Un clic en el nombre inserta la mención en el comentario que se esté
        // escribiendo: es más rápido que acordarse de cómo se escribe el token.
        li.querySelector('.ref-nombre').addEventListener('click', () => {
            insertarMencion(ref.token);
        });
        lista.appendChild(li);
    }

    $('#refs-nota').hidden = refs.length === 0;
}

/**
 * Mete una mención en el campo que tenga el foco, o en el del redactor si está
 * abierto.
 *
 * El redactor gana porque el clic en la referencia se lleva el foco del campo:
 * cuando uno escribe un comentario y va a buscar una referencia a la lista de
 * abajo, para cuando el clic llega acá `activeElement` ya es el botón. Sin esta
 * excepción, la mención se copiaría al portapapeles en vez de escribirse donde
 * se estaba escribiendo.
 *
 * Si no hay ningún campo donde escribir, se copia: así el clic nunca se pierde
 * sin hacer nada.
 */
function insertarMencion(token) {
    const abierto = !$('#redactor').hidden;
    const campo = abierto ? $('#redactor-texto') : document.activeElement;

    if (campo && campo.tagName === 'TEXTAREA') {
        const i = campo.selectionStart == null ? campo.value.length : campo.selectionStart;
        const j = campo.selectionEnd == null ? i : campo.selectionEnd;
        const antes = campo.value.slice(0, i);
        const separador = antes && !/\s$/.test(antes) ? ' ' : '';
        campo.value = `${antes}${separador}${token} ${campo.value.slice(j)}`;
        const cursor = (antes + separador + token).length + 1;
        campo.setSelectionRange(cursor, cursor);
        campo.focus();
        campo.dispatchEvent(new Event('input'));
        return;
    }

    if (campo && campo.isContentEditable) {
        document.execCommand('insertText', false, `${token} `);
        return;
    }

    window.rv.copiar(token);
    avisar('Copiado. Pegalo adentro de un comentario.');
}

export function pintar() {
    const campo = $('#general-texto');
    const texto = (estado.general && estado.general.texto) || '';
    // Solo si cambió: pisar el valor mientras alguien escribe le mueve el cursor
    // al final de la frase.
    if (document.activeElement !== campo && campo.value !== texto) campo.value = texto;
    pintarBadge();
    pintarReferencias();
}

async function guardar() {
    const texto = $('#general-texto').value;
    const r = await window.rv.generalGuardar(texto);
    if (!r) return;
    estado.general = r;
    estado.referencias = (r.referencias || []).map(x => ({ ...x }));
    // Las referencias vuelven sin url desde `general-guardar`: se piden aparte
    // para que las miniaturas se puedan pedir por el protocolo.
    estado.referencias = await window.rv.referenciasListar();
    pintar();
    al.cambio();
}

export function wire() {
    const plegar = $('#general-plegar');
    plegar.addEventListener('click', () => {
        const abierto = plegar.getAttribute('aria-expanded') === 'true';
        plegar.setAttribute('aria-expanded', String(!abierto));
        $('#general-cuerpo').hidden = abierto;
    });

    const campo = $('#general-texto');
    // Se guarda al dejar de escribir y no en cada tecla: cada guardado reescribe
    // los `feedback.md` de la carpeta, y hacerlo por letra sería escribir
    // cuarenta veces el mismo archivo.
    campo.addEventListener('input', () => {
        clearTimeout(guardando);
        guardando = setTimeout(guardar, 700);
    });
    campo.addEventListener('blur', () => {
        clearTimeout(guardando);
        guardar();
    });

    $('#refs-lista').addEventListener('click', async evento => {
        const file = evento.target.dataset.quitar;
        if (!file) return;
        estado.referencias = await window.rv.referenciasQuitar(file);
        pintar();
    });

    $('#btn-ref-agregar').addEventListener('click', async () => {
        const elegidos = await window.rv.elegirReferencias();
        for (const origen of elegidos) {
            estado.referencias = await window.rv.referenciasAgregar({ origen });
        }
        pintar();
        if (elegidos.length) avisar(`${elegidos.length} referencia(s) adjunta(s).`, 'bien');
    });
}

export { insertarMencion };
