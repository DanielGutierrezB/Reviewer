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

import { $, aRitmo, enCampoDeTexto } from './chrome.js';
import { estado, fps, comentarios } from './estado.js';
import * as fmt from './formato.js';
import * as iconos from './iconos.js';

const video = () => $('#video');

/** Quien escucha lo que pasa acá. Lo pone `app.js`. */
export const al = {
    comentar: () => {},
    mirar: () => {},
    extender: () => {},
    cambiarTiempo: () => {},
    cambiarVelocidad: () => {}
};

let arrastrando = false;

// ─── La velocidad: J más lento, L más rápido, K para ──────────

/**
 * Cuánto cambia la velocidad por cada toque, y hasta dónde.
 *
 * Es una escalera de 0.25 en 0.25 y no la de una sala de edición clásica
 * —1×, 2×, 4×, 8×—, porque acá no se usa para buscar sino para mirar. Revisar
 * un corte a 1.5× es la forma de pasar por lo que ya está bien sin perder de
 * qué habla; a 0.5× se ve dónde entra exactamente una transición. Doblar de
 * golpe se saltea justo el rango donde se mira.
 *
 * Abajo llega a 0.25× y no a cero: parar es K. Arriba corta en 3×, que es
 * donde el audio ya no se entiende y la imagen tampoco.
 */
const PASO = 0.25;
const MINIMA = 0.25;
const MAXIMA = 3;

/**
 * A qué velocidad se va a reproducir. SIEMPRE mayor que cero.
 *
 * Que sea una velocidad y no un escalón con signo es el cambio que hace que J
 * y L se comporten como uno espera. Con escalones, J desde 1.75× bajaba un
 * nivel entero y de 1× pasaba a quieto y después a marcha atrás; con un número
 * que se suma y se resta, J desde 1.75× da 1.5× y abajo de 1× sigue habiendo
 * velocidades, que es lo que «ralentizar» quiere decir.
 *
 * Pausar lo devuelve a 1: después de un K, el play siguiente es normal.
 */
let ritmo = 1;

export function velocidad() {
    return ritmo;
}

/** `1.25×`, `2×`. Sin decimales cuando no hacen falta. */
export function velocidadEnTexto(v = ritmo) {
    return `${Number.isInteger(v) ? v : v.toFixed(2).replace(/0$/, '')}×`;
}

/** El reloj que esconde el cartel grande de velocidad. */
let avisoReloj = null;

/**
 * El número, grande y sobre la imagen, por un segundo.
 *
 * Se llama también al volver a 1×: enterarse de que se volvió a normal importa
 * tanto como enterarse de que se aceleró.
 */
export function avisarVelocidad(v) {
    const cartel = $('#velocidad-aviso');
    cartel.textContent = velocidadEnTexto(v);
    cartel.classList.add('se-ve');
    clearTimeout(avisoReloj);
    avisoReloj = setTimeout(() => cartel.classList.remove('se-ve'), 900);
}

/** Deja el video quieto y la velocidad en normal. Es lo que hace K. */
export function parar() {
    const volvio = ritmo !== 1;
    ritmo = 1;
    const v = video();
    v.playbackRate = 1;
    if (v.src && !v.paused) v.pause();
    pintar();
    if (volvio) avisarVelocidad(1);
}

/**
 * Un toque de J (`-1`) o de L (`+1`).
 *
 * Mueve la velocidad un escalón y arranca: pedir ir más rápido o más lento
 * estando en pausa es pedir que ande, y obligar a apretar play además sería un
 * paso que no agrega nada.
 */
export function empujar(sentido) {
    const v = video();
    if (!v.src) return;

    const antes = ritmo;
    // Se redondea al escalón para que la cuenta no acumule error de coma
    // flotante: sin esto, cuatro toques dan 1.9999999999999998 y el cartel lo
    // muestra.
    ritmo = Math.min(MAXIMA, Math.max(MINIMA, Math.round((ritmo + sentido * PASO) / PASO) * PASO));

    v.playbackRate = ritmo;
    if (v.paused) v.play().catch(() => {});
    pintar();
    // Solo cuando de verdad cambió: en el tope, avisar de un cambio que no
    // pasó hace dudar de si la tecla entró.
    if (ritmo !== antes) {
        avisarVelocidad(ritmo);
        al.cambiarVelocidad(ritmo);
    }
}

// ─── Dónde está el cabezal ────────────────────────────────────

export function tiempo() {
    return video().currentTime || 0;
}

/** Si el video está corriendo ahora mismo, sea a la velocidad que sea. */
export function andando() {
    const v = video();
    return Boolean(v.src) && !v.paused;
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

/**
 * La barra espaciadora: andar o quedarse quieto.
 *
 * Al arrancar siempre va a 1×, nunca a la velocidad que había antes de pausar.
 * Una velocidad rara que sobrevive a la pausa es una velocidad que uno se
 * olvida de que puso: tres minutos después el video va a 1.75× y la explicación
 * quedó diez interacciones atrás.
 */
export function alternar() {
    const v = video();
    if (!v.src) return;
    if (!v.paused) return pausar();
    ritmo = 1;
    v.playbackRate = 1;
    v.play().catch(() => {});
    pintar();
}

/** Quieto y a velocidad normal. */
export function pausar() {
    parar();
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
    return { ok: true, proxy: r.proxy, url: r.url };
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
    $('#btn-play').classList.toggle('is-andando', !v.paused);

    // A qué velocidad va. Sin esto, J y L cambian algo que solo se nota
    // mirando correr el cabezal, y no hay forma de saber si uno está en 1.5× o
    // en 2× sin contar las veces que apretó.
    const chip = $('#shuttle');
    chip.hidden = ritmo === 1;
    chip.textContent = velocidadEnTexto();
    $('#btn-mas-lento').disabled = ritmo <= MINIMA;
    $('#btn-mas-rapido').disabled = ritmo >= MAXIMA;

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

    // El play lleva los dos dibujos puestos y el CSS muestra el que va: así
    // cambiar de andando a pausado no toca el DOM sesenta veces por segundo.
    $('#btn-play').innerHTML = `${iconos.play}${iconos.pausa}`;
    $('#btn-atras').innerHTML = iconos.cuadroAtras;
    $('#btn-adelante').innerHTML = iconos.cuadroAdelante;
    $('#btn-mas-lento').innerHTML = iconos.masLento;
    $('#btn-mas-rapido').innerHTML = iconos.masRapido;

    v.addEventListener('timeupdate', () => { repintar(); al.cambiarTiempo(tiempo()); });
    v.addEventListener('seeked', () => { pintar(); al.cambiarTiempo(tiempo()); });
    v.addEventListener('play', pintar);
    v.addEventListener('pause', pintar);
    // Llegar al final tiene que dejar la velocidad en normal: si no, el play
    // siguiente arranca a 2.5× sin que nadie lo haya pedido.
    v.addEventListener('ended', parar);
    v.addEventListener('loadedmetadata', () => { pintar(); pintarMarcas(); });
    v.addEventListener('click', alternar);

    $('#btn-play').addEventListener('click', alternar);
    $('#btn-atras').addEventListener('click', () => mover(-1));
    $('#btn-adelante').addEventListener('click', () => mover(1));
    $('#btn-mas-lento').addEventListener('click', () => empujar(-1));
    $('#btn-mas-rapido').addEventListener('click', () => empujar(1));
    // Apretar el número vuelve a 1×, que es lo mismo que hace K.
    $('#shuttle').addEventListener('click', () => {
        const andaba = !video().paused;
        parar();
        if (andaba) alternar();
    });
    $('#btn-in').addEventListener('click', marcarEntrada);
    $('#btn-out').addEventListener('click', marcarSalida);
    $('#btn-extender').addEventListener('click', () => al.extender(tiempo()));
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
 *
 * J y L no son la lanzadera de un NLE: J ralentiza y L acelera, de a 0.25×, y
 * ninguna de las dos da marcha atrás. Para moverse hacia atrás están las
 * flechas y la línea de tiempo; lo que no había antes era mirar a media
 * velocidad, que es lo que hace falta para ver dónde entra un corte.
 *
 * **I y O son la entrada y la salida de un comentario, no de un tramo suelto.**
 * Es la convención de cualquier sala de edición llevada a lo que acá se está
 * marcando: I abre —el cuadro donde estoy pasa a ser el principio de lo que
 * voy a decir— y O cierra, poniéndole la salida al último comentario que quedó
 * atrás. Sirven para mirar una pasada entera sin frenar: I donde empieza el
 * problema, se sigue mirando, O donde termina.
 *
 * Marcar un tramo ANTES de comentarlo sigue existiendo y se mudó a Shift: ⇧I y
 * ⇧O. Que el par con Shift haga el gesto parecido pero de otro orden es lo que
 * permite acordarse de los cuatro sabiendo dos.
 */
export function teclas(evento) {
    if (enCampoDeTexto(evento)) return false;
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
        case 'j': case 'J':
            empujar(-1);
            return true;
        case 'k': case 'K':
            parar();
            return true;
        case 'l': case 'L':
            empujar(1);
            return true;
        case 'i': case 'I':
            if (evento.shiftKey) marcarEntrada();
            else al.comentar();
            return true;
        case 'o': case 'O':
            if (evento.shiftKey) marcarSalida();
            else al.extender(tiempo());
            return true;
        // M por «marcar» y C por «comentar»: las dos siguen andando porque las
        // dos estuvieron documentadas y hay dedos que ya las aprendieron.
        case 'm': case 'M':
        case 'c': case 'C':
            al.comentar();
            return true;
        default:
            return false;
    }
}
