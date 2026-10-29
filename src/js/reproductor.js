'use strict';
/**
 * reproductor.js — Mirar el render y señalar un momento.
 *
 * Dos cosas que el reproductor de un navegador no hace solo y que acá son el
 * punto de todo:
 *
 * 1. **Ir de a un cuadro.** Un comentario que dice "el corte entra tarde" tiene
 *    que poder apuntar al cuadro, no al segundo. Las flechas mueven `1/fps`, y
 *    el tiempo se ancla al comienzo del cuadro para que el número que se ve y
 *    el PNG que se guarda sean el mismo.
 * 2. **Marcar un tramo.** Entrada y Salida (I y O) dejan un comentario que
 *    habla de un pedazo y no de un instante: "esta parte sobra" necesita dos
 *    tiempos.
 *
 * Las marcas de los comentarios viven en la línea y son clicables: es la única
 * forma de ver dónde se concentra lo que falta sin leer el panel entero.
 */

import { $, aRitmo } from './chrome.js';
import { estado, fps, comentarios } from './estado.js';
import * as fmt from './formato.js';

const video = () => $('#video');

/** Quien escucha lo que pasa acá. Lo pone `app.js`. */
export const al = {
    comentar: () => {},
    mirar: () => {},
    cambiarTiempo: () => {}
};

let arrastrando = false;

// ─── Dónde está el cabezal ────────────────────────────────────

export function tiempo() {
    return video().currentTime || 0;
}

/** Lleva el cabezal a un instante, anclado al comienzo de su cuadro. */
export function irA(segundos, exacto) {
    const v = video();
    if (!v.duration) return;
    const t = Math.max(0, Math.min(v.duration - 1e-3, Number(segundos) || 0));
    v.currentTime = exacto ? t : fmt.segundosDe(fmt.cuadroDe(t, fps()), fps());
    pintar();
}

export function mover(cuadros) {
    const f = fps();
    const ahora = fmt.cuadroDe(tiempo(), f);
    pausar();
    irA(fmt.segundosDe(Math.max(0, ahora + cuadros), f), true);
}

export function alternar() {
    const v = video();
    if (!v.src) return;
    if (v.paused) v.play().catch(() => {}); else v.pause();
}

export function pausar() {
    const v = video();
    if (v.src && !v.paused) v.pause();
}

// ─── Abrir una versión ────────────────────────────────────────

/**
 * Carga un render en el reproductor.
 *
 * El proceso principal decide si hace falta un proxy y lo arma; mientras tanto
 * el escenario muestra por qué está esperando. Una pantalla negra de tres
 * minutos sin explicación se lee como una app colgada.
 */
export async function abrir(version) {
    const v = video();
    pausar();
    v.removeAttribute('src');
    v.load();
    limpiarRango();
    mostrarDibujo(null);

    const aviso = $('#escenario-aviso');
    const texto = $('#escenario-aviso-texto');
    const barra = $('#escenario-barra');

    if (!version.media.ok) {
        texto.textContent = version.media.error || 'Ese archivo no se pudo leer.';
        barra.parentElement.hidden = true;
        aviso.hidden = false;
        return { ok: false };
    }

    if (version.proxy && version.proxy.hace) {
        texto.textContent = `${version.proxy.motivo}. Preparando una copia que sí se pueda…`;
        barra.parentElement.hidden = false;
        barra.style.width = '0%';
        aviso.hidden = false;
    }

    const r = await window.rv.prepararVideo(version.ruta);
    // Mientras se armaba el proxy el editor pudo haber cambiado de versión: lo
    // que vuelve de una espera larga no puede pisar lo que está abierto ahora.
    if (!estado.version || estado.version.ruta !== version.ruta) return { ok: false, tarde: true };

    if (!r.ok) {
        texto.textContent = r.error;
        barra.parentElement.hidden = true;
        aviso.hidden = false;
        return { ok: false, error: r.error };
    }

    aviso.hidden = true;
    v.src = r.url;
    v.load();
    // El tamaño real del render y no el del elemento: el canvas de dibujo se
    // estira sobre el lienzo, y el lienzo tiene que tener la proporción del
    // video desde antes de que cargue el primer cuadro, o la pantalla salta.
    $('#lienzo').style.aspectRatio = `${version.media.anchoReal} / ${version.media.alto}`;
    pintar();
    return { ok: true, proxy: r.proxy };
}

export function cerrar() {
    pausar();
    const v = video();
    v.removeAttribute('src');
    v.load();
    limpiarRango();
}

// ─── El tramo marcado ─────────────────────────────────────────

export function marcarEntrada() {
    estado.rango.desde = tiempo();
    // Una entrada después de la salida deja un tramo imposible: se tira la
    // salida en vez de rechazar la entrada, porque la que el editor acaba de
    // apretar es la que quiere.
    if (estado.rango.hasta != null && estado.rango.hasta <= estado.rango.desde) estado.rango.hasta = null;
    pintar();
}

export function marcarSalida() {
    estado.rango.hasta = tiempo();
    if (estado.rango.desde != null && estado.rango.desde >= estado.rango.hasta) estado.rango.desde = null;
    pintar();
}

export function limpiarRango() {
    estado.rango = { desde: null, hasta: null };
    pintar();
}

export function rangoHecho() {
    const { desde, hasta } = estado.rango;
    return desde != null && hasta != null && hasta > desde;
}

// ─── El dibujo de un comentario, encima del video ─────────────

export function mostrarDibujo(url) {
    const caja = $('#dibujo-visto');
    const img = $('#dibujo-visto-img');
    if (!url) {
        caja.hidden = true;
        img.removeAttribute('src');
        return;
    }
    img.src = url;
    caja.hidden = false;
}

// ─── Pintar ───────────────────────────────────────────────────

export function pintar() {
    const v = video();
    const dura = v.duration || (estado.version && estado.version.media && estado.version.media.duracion) || 0;
    const t = v.currentTime || 0;
    const pct = dura ? Math.min(100, (t / dura) * 100) : 0;

    $('#linea-vista').style.width = `${pct}%`;
    $('#linea-cabezal').style.left = `${pct}%`;
    $('#reloj').textContent = fmt.reloj(t);
    $('#reloj-total').textContent = fmt.reloj(dura);
    $('#tc').textContent = fmt.timecode(t, fps());
    $('#btn-play').textContent = v.paused ? '▶' : '❚❚';

    const rango = $('#linea-rango');
    const { desde, hasta } = estado.rango;
    if (dura && (desde != null || hasta != null)) {
        const a = ((desde == null ? 0 : desde) / dura) * 100;
        const b = ((hasta == null ? dura : hasta) / dura) * 100;
        rango.style.left = `${a}%`;
        rango.style.width = `${Math.max(0.4, b - a)}%`;
        rango.hidden = false;
    } else {
        rango.hidden = true;
    }
    $('#btn-rango-limpiar').hidden = desde == null && hasta == null;
    $('#btn-comentar').textContent = rangoHecho() ? 'Comentar el tramo' : 'Comentar';
}

/** Las marcas de los comentarios sobre la línea. */
export function pintarMarcas() {
    const caja = $('#linea-marcas');
    caja.textContent = '';
    const dura = (video().duration)
        || (estado.version && estado.version.media && estado.version.media.duracion) || 0;
    if (!dura) return;

    for (const c of comentarios()) {
        const marca = document.createElement('button');
        marca.type = 'button';
        marca.className = `marca es-${c.estado}${c.tHasta ? ' es-rango' : ''}`;
        if (estado.mirado === c.id) marca.classList.add('is-mirada');
        marca.style.left = `${(c.t / dura) * 100}%`;
        if (c.tHasta) marca.style.width = `${Math.max(0.3, ((c.tHasta - c.t) / dura) * 100)}%`;
        marca.title = `${c.id} · ${fmt.timecode(c.t, fps())}`;
        marca.addEventListener('click', e => {
            e.stopPropagation();
            al.mirar(c.id);
        });
        caja.appendChild(marca);
    }
}

// ─── Cableado ─────────────────────────────────────────────────

function tiempoDeClic(evento) {
    const pista = $('#linea-pista');
    const caja = pista.getBoundingClientRect();
    const dura = video().duration || 0;
    if (!dura || !caja.width) return null;
    const x = Math.max(0, Math.min(caja.width, evento.clientX - caja.left));
    return (x / caja.width) * dura;
}

export function wire() {
    const v = video();
    const repintar = aRitmo(pintar, 60);

    v.addEventListener('timeupdate', () => { repintar(); al.cambiarTiempo(tiempo()); });
    v.addEventListener('seeked', () => { pintar(); al.cambiarTiempo(tiempo()); });
    v.addEventListener('play', pintar);
    v.addEventListener('pause', pintar);
    v.addEventListener('loadedmetadata', () => { pintar(); pintarMarcas(); });
    v.addEventListener('click', alternar);

    $('#btn-play').addEventListener('click', alternar);
    $('#btn-atras').addEventListener('click', () => mover(-1));
    $('#btn-adelante').addEventListener('click', () => mover(1));
    $('#btn-in').addEventListener('click', marcarEntrada);
    $('#btn-out').addEventListener('click', marcarSalida);
    $('#btn-rango-limpiar').addEventListener('click', limpiarRango);
    $('#btn-comentar').addEventListener('click', () => al.comentar());

    // Arrastrar el cabezal. `pointer` y no `mouse` para que el trackpad con
    // fuerza y un lápiz hagan lo mismo, y con captura para que soltar el botón
    // fuera de la ventana no deje el arrastre pegado.
    const linea = $('#linea');
    linea.addEventListener('pointerdown', e => {
        const t = tiempoDeClic(e);
        if (t == null) return;
        arrastrando = true;
        linea.setPointerCapture(e.pointerId);
        pausar();
        irA(t, true);
    });
    linea.addEventListener('pointermove', e => {
        if (!arrastrando) return;
        const t = tiempoDeClic(e);
        if (t != null) irA(t, true);
    });
    const soltar = e => {
        if (!arrastrando) return;
        arrastrando = false;
        try { linea.releasePointerCapture(e.pointerId); } catch (err) { /* ya se soltó */ }
        // Al soltar sí se ancla al cuadro: durante el arrastre anclar hace que
        // el cabezal tironee.
        irA(tiempo());
    };
    linea.addEventListener('pointerup', soltar);
    linea.addEventListener('pointercancel', soltar);
}

/**
 * Los atajos.
 *
 * No corren si el foco está en un campo de texto: la barra espaciadora adentro
 * de un comentario es un espacio, no un play.
 */
export function teclas(evento) {
    const dentroDeTexto = /^(INPUT|TEXTAREA|SELECT)$/.test(evento.target.tagName)
        || evento.target.isContentEditable;
    if (dentroDeTexto) return false;
    if (evento.metaKey || evento.ctrlKey || evento.altKey) return false;

    switch (evento.key) {
        case ' ':
            alternar();
            return true;
        case 'ArrowLeft':
            mover(evento.shiftKey ? -10 : -1);
            return true;
        case 'ArrowRight':
            mover(evento.shiftKey ? 10 : 1);
            return true;
        case 'i': case 'I':
            marcarEntrada();
            return true;
        case 'o': case 'O':
            marcarSalida();
            return true;
        case 'c': case 'C':
            al.comentar();
            return true;
        case 'j': case 'J':
            mover(-5);
            return true;
        case 'k': case 'K':
            pausar();
            return true;
        case 'l': case 'L':
            mover(5);
            return true;
        default:
            return false;
    }
}
