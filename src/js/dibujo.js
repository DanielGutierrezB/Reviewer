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
 *
 * **La presión del lápiz se guarda con cada punto.** Con una Wacom o un Apple
 * Pencil por Sidecar, un trazo de grosor fijo se siente muerto y, peor, pierde
 * lo que uno hace sin pensarlo: apretar más donde importa. El mouse y el
 * trackpad no informan presión y reportan 0.5 constante, así que para ellos el
 * resultado es el de siempre.
 */

import { $ } from './chrome.js';
import { puntoEn, rechazoDePalma, estirar, sirve } from './trazo.js';

export const COLORES = ['#ff4d4f', '#ffd666', '#4f9cf9', '#3ecf8e'];
export const LAPICES = [
    { id: 'libre', nombre: 'Trazo' },
    { id: 'flecha', nombre: 'Flecha' },
    { id: 'caja', nombre: 'Caja' },
    { id: 'elipse', nombre: 'Círculo' }
];

/** El grosor con el que se dibuja, en fracción del alto: igual en 4K y en 720p. */
const GROSOR = 0.004;

/** Cuánto puede engordar o afinar la presión al trazo, como factor. */
const PRESION_MIN = 0.45;
const PRESION_MAX = 1.75;

const estado = {
    lapiz: 'libre',
    color: COLORES[0],
    trazos: [],
    /** Los que sacó «Deshacer», para que «Rehacer» los pueda devolver. */
    deshechos: [],
    enCurso: null,
    activo: false
};

/** El portero de esta pizarra: el rechazo de palma vive en `trazo.js`. */
const puedeDibujar = rechazoDePalma();

/** Quien escucha. Lo pone `app.js`. */
export const al = { primerTrazo: () => {}, cambio: () => {}, eleccion: () => {} };

const lienzo = () => $('#pizarra');

export function hayTrazos() {
    return estado.trazos.length > 0;
}

export function cuantos() {
    return estado.trazos.length;
}

export function trazos() {
    return estado.trazos.map(t => ({ ...t, puntos: t.puntos.map(p => ({ ...p })) }));
}

export function color() {
    return estado.color;
}

export function lapiz() {
    return estado.lapiz;
}

/**
 * Cambiar de herramienta desde afuera de esta ventana: lo usa la paleta del iPad.
 *
 * **Hay una sola elección de herramienta y vive acá.** La alternativa era que
 * la segunda pantalla guardara la suya, y deja un estado mentiroso: la barra de
 * la Mac diciendo «Flecha» mientras el Pencil saca cajas, sin nada en ninguna
 * de las dos pantallas que explique por qué. Son dos mandos del mismo aparato,
 * no dos aparatos — el que dibuja es uno y tiene una mano en cada lado.
 */
export function elegirLapiz(id) {
    if (!LAPICES.some(l => l.id === id)) return;
    estado.lapiz = id;
    pintarEleccion();
    al.eleccion();
}

/**
 * Y el color, por lo mismo.
 *
 * Esta decisión estuvo tomada al revés y se dio vuelta mirando a alguien usarlo.
 * El color vivía solo en la Mac con un argumento que todavía parece bueno: el
 * color es cómo se ordena el feedback —uno por tema, o uno por persona—, se
 * decide una vez y se decide mirando el panel de comentarios, que está en la
 * Mac. Lo que el argumento no veía es que al editor igual se le ocurre cambiar
 * de color a mitad de un trazo, y para hacerlo tenía que soltar el Pencil y
 * cruzar el brazo hasta el teclado, que es exactamente el viaje que esta
 * función vino a borrar. La práctica le gana a la teoría.
 */
export function elegirColor(c) {
    if (!COLORES.includes(c)) return;
    estado.color = c;
    pintarEleccion();
    al.eleccion();
}

/**
 * Los botones de la barra, al día con `estado`.
 *
 * Se pintan leyendo el estado y no marcando el botón que se apretó porque la
 * elección puede venir de la otra pantalla, donde no hay ningún botón de acá
 * que se pueda marcar.
 */
function pintarEleccion() {
    const lapices = $('#lapices');
    if (lapices) {
        [...lapices.children].forEach(n => n.classList.toggle('is-activo', n.dataset.lapiz === estado.lapiz));
    }
    const colores = $('#colores');
    if (colores) {
        [...colores.children].forEach(n => n.classList.toggle('is-activo', n.dataset.color === estado.color));
    }
}

/**
 * Mete un trazo que no se dibujó acá.
 *
 * Es por donde entran los del Apple Pencil cuando el video está en el iPad por
 * Sidecar: llegan por el proceso principal desde la otra ventana y a partir de
 * acá son indistinguibles de los demás —se deshacen igual, se guardan igual y
 * se componen en el mismo PNG—.
 */
export function agregarTrazo(trazo) {
    if (!trazo || !Array.isArray(trazo.puntos) || trazo.puntos.length < 2) return;
    const primero = estado.trazos.length === 0;
    estado.trazos.push(trazo);
    estado.deshechos = [];
    repintar();
    if (primero) al.primerTrazo();
    al.cambio();
}

export function limpiar() {
    estado.trazos = [];
    estado.deshechos = [];
    estado.enCurso = null;
    repintar();
    al.cambio();
}

/**
 * Deshacer y rehacer DEL DIBUJO, que es aparte del historial de comentarios.
 *
 * Son dos pilas distintas a propósito: mientras se dibuja, `Cmd+Z` tiene que
 * sacar el último trazo, no el último comentario guardado. Lo que está en la
 * pizarra todavía no es trabajo en el disco, y mezclarlo con lo que sí lo es
 * haría que la misma tecla hiciera dos cosas según algo que no se ve.
 */
export function deshacer() {
    if (!estado.trazos.length) return false;
    estado.deshechos.push(estado.trazos.pop());
    repintar();
    al.cambio();
    return true;
}

export function rehacer() {
    if (!estado.deshechos.length) return false;
    estado.trazos.push(estado.deshechos.pop());
    repintar();
    al.cambio();
    return true;
}

export function hayQueDeshacer() {
    return estado.trazos.length > 0;
}

export function hayQueRehacer() {
    return estado.deshechos.length > 0;
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
/**
 * De presión (0 a 1) a factor de grosor.
 *
 * Un punto sin presión informada vale 0.5 —es lo que manda un mouse— y 0.5
 * tiene que dar exactamente 1, o el mismo trazo saldría de otro grosor según
 * con qué se dibujó.
 */
function factorDePresion(presion) {
    const p = Number.isFinite(presion) ? Math.max(0, Math.min(1, presion)) : 0.5;
    return p < 0.5
        ? PRESION_MIN + (1 - PRESION_MIN) * (p / 0.5)
        : 1 + (PRESION_MAX - 1) * ((p - 0.5) / 0.5);
}

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
            // Tramo por tramo y no en un solo `stroke`, porque cada uno lleva
            // su grosor: el `lineWidth` del canvas es uno para todo el camino,
            // así que un trazo con presión variable son muchos caminos cortos.
            // Con `round` en punta y unión las costuras no se ven.
            for (let i = 1; i < p.length; i++) {
                ctx.lineWidth = grosor * factorDePresion((p[i - 1].p + p[i].p) / 2);
                ctx.beginPath();
                ctx.moveTo(p[i - 1].x * ancho, p[i - 1].y * alto);
                ctx.lineTo(p[i].x * ancho, p[i].y * alto);
                ctx.stroke();
            }
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

/** Contra qué se normaliza un punto: el canvas tal como está en pantalla. */
const caja = () => lienzo().getBoundingClientRect();

export function wire() {
    const c = lienzo();

    c.addEventListener('pointerdown', e => {
        if (!estado.activo || !puedeDibujar(e)) return;
        e.preventDefault();
        // Puede fallar y eso no cancela el trazo: sin captura se dibuja igual
        // mientras el puntero no se salga del canvas.
        try { c.setPointerCapture(e.pointerId); } catch (err) { /* se dibuja sin ella */ }
        estado.enCurso = { lapiz: estado.lapiz, color: estado.color, puntos: [puntoEn(caja(), e)] };
        repintar();
    });

    c.addEventListener('pointermove', e => {
        if (!estado.enCurso) return;
        estirar(estado.enCurso, caja(), e);
        repintar();
    });

    const soltar = e => {
        if (!estado.enCurso) return;
        try { c.releasePointerCapture(e.pointerId); } catch (err) { /* ya se soltó */ }
        const trazo = estado.enCurso;
        estado.enCurso = null;
        // Un clic suelto no es un trazo: sin esto, cada clic para pausar el
        // video dejaba un punto.
        if (!sirve(trazo)) {
            repintar();
            return;
        }
        const primero = estado.trazos.length === 0;
        estado.trazos.push(trazo);
        // Dibujar algo nuevo corta la rama de rehacer, igual que en el
        // historial de comentarios.
        estado.deshechos = [];
        repintar();
        if (primero) al.primerTrazo();
        al.cambio();
    };
    c.addEventListener('pointerup', soltar);
    c.addEventListener('pointercancel', soltar);

    $('#btn-deshacer').addEventListener('click', deshacer);
    $('#btn-limpiar').addEventListener('click', limpiar);

    // Las herramientas se arman una vez y no cambian. Cada botón dice en un
    // `data-` cuál representa: es lo que le permite a `pintarEleccion` marcar
    // el correcto cuando la elección vino del iPad y no de un clic de acá.
    const lapices = $('#lapices');
    for (const l of LAPICES) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'lapiz';
        b.dataset.lapiz = l.id;
        b.textContent = l.nombre;
        b.addEventListener('click', () => elegirLapiz(l.id));
        lapices.appendChild(b);
    }

    const colores = $('#colores');
    for (const color of COLORES) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'color';
        b.dataset.color = color;
        b.style.background = color;
        b.title = 'Dibujar con este color';
        b.addEventListener('click', () => elegirColor(color));
        colores.appendChild(b);
    }
    pintarEleccion();

    window.addEventListener('resize', ajustar);
    $('#video').addEventListener('loadedmetadata', ajustar);
}
