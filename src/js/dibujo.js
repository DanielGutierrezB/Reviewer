'use strict';
/**
 * dibujo.js — Señalar con el dedo sobre el cuadro.
 *
 * Es lo que hace que un comentario sobre un encuadre se pueda contestar: decir
 * "el logo está muy pegado al borde" es ambiguo; un círculo rojo alrededor del
 * logo no lo es.
 *
 * **Los trazos se guardan en coordenadas de 0 a 1**, no en píxeles de pantalla.
 * La ventana se redimensiona, el video puede estar a 1920 o a 1280 en la caja, y
 * un trazo guardado en píxeles de pantalla caería corrido en cuanto cambiara
 * cualquiera de las dos cosas. Normalizado, el mismo trazo sirve para repintarlo
 * en la ventana y para componerlo a resolución del render.
 *
 * **El PNG que se guarda lo compone esto y no ffmpeg.** El trazo ya está acá,
 * dibujado; traducirlo a un filtro de ffmpeg lo dibujaría parecido pero no
 * igual, y lo que tiene que ver Claude es lo que vio el editor.
 */

import { $ } from './chrome.js';

export const COLORES = ['#ff4d4f', '#ffd666', '#4f9cf9', '#3ecf8e'];
export const LAPICES = [
    { id: 'libre', nombre: 'Trazo' },
    { id: 'flecha', nombre: 'Flecha' },
    { id: 'caja', nombre: 'Caja' },
    { id: 'elipse', nombre: 'Círculo' }
];

/** El grosor con el que se dibuja, en fracción del alto: igual en 4K y en 720p. */
const GROSOR = 0.004;

const estado = {
    lapiz: 'libre',
    color: COLORES[0],
    trazos: [],
    enCurso: null,
    activo: false
};

/** Quien escucha. Lo pone `app.js`. */
export const al = { primerTrazo: () => {} };

const lienzo = () => $('#pizarra');

export function hayTrazos() {
    return estado.trazos.length > 0;
}

export function trazos() {
    return estado.trazos.map(t => ({ ...t, puntos: t.puntos.map(p => ({ ...p })) }));
}

export function limpiar() {
    estado.trazos = [];
    estado.enCurso = null;
    repintar();
}

/** Prende o apaga el canvas: apagado no recibe clics y el video se puede pausar. */
export function activar(si) {
    estado.activo = Boolean(si);
    const c = lienzo();
    c.hidden = !estado.activo;
    $('#herramientas').hidden = !estado.activo;
    if (!estado.activo) limpiar();
    else ajustar();
}

export function activo() {
    return estado.activo;
}

/** El canvas, a los píxeles que de verdad ocupa en pantalla. */
function ajustar() {
    const c = lienzo();
    const caja = c.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(caja.width * dpr));
    const h = Math.max(1, Math.round(caja.height * dpr));
    if (c.width !== w || c.height !== h) {
        c.width = w;
        c.height = h;
    }
    repintar();
}

/**
 * Dibuja una lista de trazos en cualquier contexto y a cualquier tamaño.
 *
 * La misma función para la pantalla y para el PNG final: si fueran dos, el
 * archivo que ve Claude podría no ser lo que el editor dibujó.
 */
export function pintarEn(ctx, lista, ancho, alto) {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (const trazo of lista) {
        const grosor = Math.max(1.5, alto * GROSOR);
        ctx.strokeStyle = trazo.color;
        ctx.fillStyle = trazo.color;
        ctx.lineWidth = grosor;
        const p = trazo.puntos;
        if (!p.length) continue;

        if (trazo.lapiz === 'libre') {
            ctx.beginPath();
            ctx.moveTo(p[0].x * ancho, p[0].y * alto);
            for (let i = 1; i < p.length; i++) ctx.lineTo(p[i].x * ancho, p[i].y * alto);
            ctx.stroke();
            continue;
        }

        const a = p[0];
        const b = p[p.length - 1];
        const x1 = a.x * ancho;
        const y1 = a.y * alto;
        const x2 = b.x * ancho;
        const y2 = b.y * alto;

        if (trazo.lapiz === 'caja') {
            ctx.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
        } else if (trazo.lapiz === 'elipse') {
            ctx.beginPath();
            ctx.ellipse(
                (x1 + x2) / 2, (y1 + y2) / 2,
                Math.abs(x2 - x1) / 2, Math.abs(y2 - y1) / 2,
                0, 0, Math.PI * 2
            );
            ctx.stroke();
        } else if (trazo.lapiz === 'flecha') {
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();
            // La punta crece con el trazo, no con el lienzo: una flecha corta con
            // una punta de cuarenta píxeles es una mancha.
            const largo = Math.hypot(x2 - x1, y2 - y1);
            const punta = Math.max(grosor * 3, Math.min(largo * 0.3, grosor * 7));
            const ang = Math.atan2(y2 - y1, x2 - x1);
            ctx.beginPath();
            ctx.moveTo(x2, y2);
            ctx.lineTo(x2 - punta * Math.cos(ang - Math.PI / 7), y2 - punta * Math.sin(ang - Math.PI / 7));
            ctx.lineTo(x2 - punta * Math.cos(ang + Math.PI / 7), y2 - punta * Math.sin(ang + Math.PI / 7));
            ctx.closePath();
            ctx.fill();
        }
    }
}

function repintar() {
    const c = lienzo();
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    const lista = estado.enCurso ? [...estado.trazos, estado.enCurso] : estado.trazos;
    pintarEn(ctx, lista, c.width, c.height);
}

/**
 * Los trazos solos, sobre transparente, a la resolución del render, como PNG.
 *
 * **Acá no se toca el `<video>`.** El fondo lo pone ffmpeg en el proceso
 * principal, que lo saca del archivo original (`engine/frames.js`). Esta función
 * se intentó una vez tomando el cuadro de la pantalla con `drawImage`, y falla
 * callada: cuando la ventana no está componiendo, `drawImage` sobre un `<video>`
 * no tira, devuelve transparente, y el PNG quedaba con el trazo flotando sobre
 * nada.
 *
 * Lo que sí se mantiene es que el trazo lo dibuja `pintarEn`, el mismo que lo
 * dibujó en pantalla: lo que ve Claude es lo que vio el editor.
 *
 * @returns {Promise<ArrayBuffer|null>}
 */
export async function componer(ancho, alto) {
    if (!estado.trazos.length) return null;
    const video = $('#video');
    const w = ancho || video.videoWidth;
    const h = alto || video.videoHeight;
    if (!w || !h) return null;

    const fuera = document.createElement('canvas');
    fuera.width = w;
    fuera.height = h;
    pintarEn(fuera.getContext('2d'), estado.trazos, w, h);

    const blob = await new Promise(r => fuera.toBlob(r, 'image/png'));
    return blob ? await blob.arrayBuffer() : null;
}

// ─── Cableado ─────────────────────────────────────────────────

function donde(evento) {
    const caja = lienzo().getBoundingClientRect();
    return {
        x: Math.max(0, Math.min(1, (evento.clientX - caja.left) / caja.width)),
        y: Math.max(0, Math.min(1, (evento.clientY - caja.top) / caja.height))
    };
}

export function wire() {
    const c = lienzo();

    c.addEventListener('pointerdown', e => {
        if (!estado.activo) return;
        e.preventDefault();
        c.setPointerCapture(e.pointerId);
        estado.enCurso = { lapiz: estado.lapiz, color: estado.color, puntos: [donde(e)] };
        repintar();
    });

    c.addEventListener('pointermove', e => {
        if (!estado.enCurso) return;
        const p = donde(e);
        if (estado.lapiz === 'libre') {
            const ultimo = estado.enCurso.puntos[estado.enCurso.puntos.length - 1];
            // Puntos muy juntos no agregan nada y engordan el JSON: un trazo de
            // dos segundos son 120 eventos y con esto quedan 30.
            if (Math.hypot(p.x - ultimo.x, p.y - ultimo.y) < 0.004) return;
            estado.enCurso.puntos.push(p);
        } else {
            estado.enCurso.puntos = [estado.enCurso.puntos[0], p];
        }
        repintar();
    });

    const soltar = e => {
        if (!estado.enCurso) return;
        try { c.releasePointerCapture(e.pointerId); } catch (err) { /* ya se soltó */ }
        const trazo = estado.enCurso;
        estado.enCurso = null;
        // Un clic suelto no es un trazo: sin esto, cada clic para pausar el
        // video dejaba un punto.
        const p = trazo.puntos;
        const largo = p.length > 1 ? Math.hypot(p[p.length - 1].x - p[0].x, p[p.length - 1].y - p[0].y) : 0;
        if (p.length < 2 || (trazo.lapiz !== 'libre' && largo < 0.01)) {
            repintar();
            return;
        }
        const primero = estado.trazos.length === 0;
        estado.trazos.push(trazo);
        repintar();
        if (primero) al.primerTrazo();
    };
    c.addEventListener('pointerup', soltar);
    c.addEventListener('pointercancel', soltar);

    $('#btn-deshacer').addEventListener('click', () => {
        estado.trazos.pop();
        repintar();
    });
    $('#btn-limpiar').addEventListener('click', limpiar);

    // Las herramientas se arman una vez y no cambian.
    const lapices = $('#lapices');
    for (const l of LAPICES) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `lapiz${l.id === estado.lapiz ? ' is-activo' : ''}`;
        b.textContent = l.nombre;
        b.addEventListener('click', () => {
            estado.lapiz = l.id;
            [...lapices.children].forEach(n => n.classList.toggle('is-activo', n === b));
        });
        lapices.appendChild(b);
    }

    const colores = $('#colores');
    for (const color of COLORES) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `color${color === estado.color ? ' is-activo' : ''}`;
        b.style.background = color;
        b.title = 'Dibujar con este color';
        b.addEventListener('click', () => {
            estado.color = color;
            [...colores.children].forEach(n => n.classList.toggle('is-activo', n === b));
        });
        colores.appendChild(b);
    }

    window.addEventListener('resize', ajustar);
    $('#video').addEventListener('loadedmetadata', ajustar);
}
