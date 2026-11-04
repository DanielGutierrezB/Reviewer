'use strict';
/**
 * dependencias.js — La lista de lo que la app necesita, con un botón para
 * instalar cada cosa que falte.
 *
 * Se dibuja en tres sitios con la misma función: en Ajustes, siempre; en el
 * aviso de la primera apertura, cuando falta algo; y en la pestaña Render,
 * cuando al worker le falta algo para arrancar. Los tres son la misma lista y
 * se actualizan juntos: una descarga que arrancó en el aviso sigue viéndose
 * en Ajustes.
 *
 * El motor sabe qué hay y cómo se instala (`engine/dependencias.js`); acá solo
 * se dibuja y se aprieta.
 */

import { $, anotar, avisar, escapar } from './chrome.js';

/** Los contenedores donde se dibuja, con qué claves muestra cada uno. */
const donde = new Map();
let lista = [];
/** clave → { pct, texto } de lo que se está instalando. */
const instalando = new Map();
/** clave → texto de lo último que pasó con esa dependencia. */
const resultado = new Map();
let escuchando = false;
const alCambiar = new Set();

/** Qué hacer cuando cambie la lista: el aviso se cierra solo si ya no falta nada. */
export function alActualizar(fn) {
    alCambiar.add(fn);
}

/**
 * Dibuja la lista en un contenedor y la mantiene al día.
 *
 * @param {HTMLElement} contenedor
 * @param {{solo?: string[]}} [opciones] las claves que este sitio muestra; sin
 *   ellas, todas. La pestaña Render solo quiere las que le faltan al worker.
 */
export async function montar(contenedor, { solo = null } = {}) {
    donde.set(contenedor, solo);
    if (!escuchando) {
        escuchando = true;
        window.rv.alProgresoDependencias(p => {
            instalando.set(p.clave, { pct: p.pct, texto: p.texto });
            pintar();
        });
    }
    contenedor.addEventListener('click', alClic);
    await refrescar();
}

/** Cambia qué claves muestra un contenedor ya montado. */
export function filtrar(contenedor, solo) {
    donde.set(contenedor, solo);
    pintar();
}

/** Vuelve a mirar la Mac. */
export async function refrescar() {
    lista = await window.rv.dependenciasEstado();
    pintar();
    for (const fn of alCambiar) fn(lista);
    return lista;
}

/** Lo que falta, separando lo que impide abrir una carpeta de lo que solo apaga algo. */
export function faltan() {
    const f = lista.filter(d => !d.esta);
    return { requeridas: f.filter(d => d.requerida), otras: f.filter(d => !d.requerida) };
}

function pintar() {
    for (const [contenedor, solo] of donde) {
        const filas = solo ? lista.filter(d => solo.includes(d.clave)) : lista;
        contenedor.innerHTML = filas.map(fila).join('');
    }
}

function fila(d) {
    const enCurso = instalando.get(d.clave);
    const ultimo = resultado.get(d.clave);
    const marca = d.esta ? 'is-ok' : (d.requerida ? 'is-no' : 'is-opcional');
    const signo = d.esta ? '✓' : (d.requerida ? '✕' : '!');

    let accion = '';
    if (enCurso) {
        accion = d.accion && d.accion.tipo === 'descargar'
            ? `<button type="button" class="btn btn-ghost btn-chico" data-cancelar="${escapar(d.clave)}">Cancelar</button>`
            : '';
    } else if (!d.esta && d.accion && d.accion.etiqueta) {
        accion = `<button type="button" class="btn btn-chico" data-instalar="${escapar(d.clave)}"${d.accion.nota ? ` title="${escapar(d.accion.nota)}"` : ''}>${escapar(d.accion.etiqueta)}</button>`;
    }

    let detalle;
    if (enCurso) {
        detalle = `${enCurso.pct !== null && enCurso.pct !== undefined ? `${enCurso.pct} % · ` : ''}${enCurso.texto || ''}`;
    } else if (ultimo) {
        detalle = ultimo;
    } else if (d.esta) {
        detalle = d.donde;
    } else {
        detalle = (d.accion && d.accion.nota) || d.para;
    }

    return `
        <li class="dep ${d.esta ? '' : 'es-falta'}">
            <span class="marca ${marca}">${signo}</span>
            <span class="doctor-que" title="${escapar(d.para)}">${escapar(d.nombre)}</span>
            <span class="doctor-donde ${d.esta && !ultimo ? 'es-ruta' : ''}">${escapar(detalle)}</span>
            ${accion}
        </li>`;
}

async function alClic(e) {
    const boton = e.target.closest('button[data-instalar], button[data-cancelar]');
    if (!boton) return;
    if (boton.dataset.cancelar) {
        await window.rv.dependenciasCancelar(boton.dataset.cancelar);
        return;
    }
    await instalarUna(boton.dataset.instalar);
}

/** Instala una y cuenta cómo salió, en la fila y en el aviso de abajo. */
export async function instalarUna(clave) {
    const d = lista.find(x => x.clave === clave);
    if (!d || instalando.has(clave)) return;
    instalando.set(clave, { pct: null, texto: 'Empezando…' });
    resultado.delete(clave);
    pintar();
    anotar('dependencias.boton', { clave, tipo: d.accion && d.accion.tipo });

    const r = await window.rv.dependenciasInstalar(clave);
    instalando.delete(clave);
    if (r.ok && !r.sigue) {
        resultado.set(clave, 'Instalado.');
        avisar(`${d.nombre}: listo.`);
    } else if (r.ok) {
        resultado.set(clave, r.mensaje);
        avisar(r.mensaje);
    } else {
        resultado.set(clave, r.error);
        avisar(r.error, 'mal');
    }
    await refrescar();
}

/**
 * El aviso de la primera apertura: si falta algo, se dice antes de que nadie
 * abra una carpeta.
 *
 * Lo que impide abrir una carpeta va en rojo y cambia el título; lo que solo
 * apaga una función va en ámbar y se puede dejar para después. Cerrarlo no
 * insiste: lo que falta queda en Ajustes → Esta Mac. Y si mientras está
 * abierto se instala lo último que faltaba, se cierra solo.
 */
export async function avisoAlAbrir() {
    const modal = $('#modal-deps');
    const cerrar = () => { modal.hidden = true; };
    $('#deps-cerrar').addEventListener('click', cerrar);
    $('#btn-deps-despues').addEventListener('click', cerrar);
    $('#btn-deps-todo').addEventListener('click', async () => {
        $('#btn-deps-todo').disabled = true;
        try { await instalarTodo(); } finally { $('#btn-deps-todo').disabled = false; }
    });

    alActualizar(() => {
        const { requeridas, otras } = faltan();
        if (!requeridas.length && !otras.length) {
            cerrar();
            return;
        }
        $('#deps-titulo').textContent = requeridas.length ? 'Falta algo para poder revisar' : 'Antes de empezar';
        $('#deps-nota').textContent = requeridas.length
            ? 'Sin esto Reviewer no puede abrir una carpeta de renders. Se instala desde acá.'
            : 'Se puede revisar, pero con esto la app hace más: dictar comentarios y renderizar en esta Mac. Lo podés instalar ahora o después desde Ajustes.';
    });

    const filas = await montar($('#deps-aviso'), { solo: null });
    const { requeridas, otras } = faltan();
    if (requeridas.length || otras.length) {
        modal.hidden = false;
        anotar('dependencias.aviso', { requeridas: requeridas.map(d => d.clave), otras: otras.map(d => d.clave) });
    }
    return filas;
}

/** Instala todo lo que falta y se puede instalar sin salir de la app, una detrás de otra. */
export async function instalarTodo() {
    for (const d of lista) {
        if (d.esta || !d.accion || !['descargar', 'brew'].includes(d.accion.tipo)) continue;
        await instalarUna(d.clave);
    }
    // Lo que sigue afuera —Homebrew, las herramientas de Apple— se abre al
    // final y de a uno: dos instaladores a la vez pidiendo contraseña no se
    // entienden.
    const afuera = lista.find(d => !d.esta && d.accion && ['homebrew', 'xcode'].includes(d.accion.tipo));
    if (afuera) await instalarUna(afuera.clave);
}
