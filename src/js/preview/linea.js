'use strict';
/**
 * linea.js — La barra de reproducción convertida en línea de montaje.
 *
 * Con un render, la barra es un rectángulo liso: adentro del archivo no hay
 * nada que mostrar. Con una edición sí lo hay, y lo que hay es una línea de
 * tiempo de verdad: cada elemento en su pista, con su duración y sus cortes,
 * como en cualquier mesa de edición. Las pistas van en el orden en que se
 * dibujan —lo de arriba tapa a lo de abajo—, así que la línea no es solo un
 * índice de cuándo pasa cada cosa, es también el orden de composición.
 *
 * **Es para mirar y señalar, no para montar.** No se arrastra, no se corta, no
 * se reordena. Esa es la razón de que sea tan baja: sin manijas que agarrar,
 * una pista no necesita más alto que el que hace falta para verla, y cada
 * píxel que no se lleva la línea se lo queda la imagen, que es lo que se vino
 * a revisar.
 *
 * Tres decisiones que no son obvias:
 *
 * 1. **Los nombres de pista van en una columna aparte, afuera de la pista.**
 *    Adentro correrían el mapa de tiempos: el píxel 0 de `#linea-pista` tiene
 *    que seguir siendo el segundo 0, porque el cabezal, las marcas de los
 *    comentarios y el arrastre están escritos contra esa regla y ninguno de
 *    los tres necesita enterarse de que ahora hay pistas.
 *
 * 2. **Las posiciones no se falsean.** El clip más corto dura 0.27 s, que en
 *    una línea de 900 px son 0.45 px. La tentación es darle un ancho mínimo
 *    generoso, y eso correría a todos los que vienen después: el cabezal
 *    dejaría de caer sobre el clip que se está viendo. Se dibuja cada uno en
 *    su sitio exacto con un mínimo de 2 px, aceptando que dos clips muy cortos
 *    se pisen un píxel. Se ve el corte, y el cabezal dice la verdad.
 *
 * 3. **Los shots seguidos que hacen lo mismo se juntan en un clip.** En la
 *    pista de cámara no importa cuántas veces cortó el montaje mientras la
 *    cámara siguió en pantalla; importa desde cuándo hasta cuándo se la ve. El
 *    corte igual está dibujado, en la pista CLIPS, que es la que habla de eso.
 */

import { $, escapar } from '../chrome.js';
import * as fmt from '../formato.js';
import * as modelo from './modelo.js';

/**
 * Un color por layout, para la pista de clips.
 *
 * Elegidos para distinguirse en una franja de doce píxeles de alto, que es
 * donde de verdad se van a ver, y no en un muestrario. Los dos de cámara son
 * vecinos a propósito —`CAM_WIDE` y `CAM_MED` son el mismo material, más
 * abierto o más cerrado— y la pantalla se va al otro lado de la rueda porque
 * es lo que uno busca cuando busca algo.
 *
 * Son cinco colores y no 157: un color por clip no son 157 informaciones, son
 * ruido. Con cinco se lee la forma del montaje de un vistazo —dónde se habla a
 * cámara, dónde se muestra la pantalla, dónde entran las animaciones—, que es
 * la pregunta que uno se hace mirando una línea de tiempo.
 */
const COLORES = {
    CAM_WIDE: '#4f9cf9',
    CAM_MED: '#6fb4ff',
    SCREEN: '#f5b544',
    SCENE: '#3ecf8e',
    SCENE_L: '#5fdfa6',
    SCENE_FULL: '#2fae75',
    SPLIT: '#c88bf5'
};

/** Para un layout que esta versión no conoce. Gris: se ve que está, no finge. */
const COLOR_RARO = '#6f7889';

const COLOR_ESCENA = '#3ecf8e';
const COLOR_OVERLAY = '#c88bf5';

/**
 * El audio, en un gris azulado que no es de nadie.
 *
 * Tentaba pintarlo del azul de la cámara, que es de donde sale. Pero entonces
 * la pista de abajo es una cuarta franja azul y el ojo la lee como una cámara
 * más; lo que esta pista tiene para contar es dónde están SUS cortes, y para
 * eso le conviene no parecerse a ninguna de las de imagen.
 */
const COLOR_AUDIO = '#5f6c86';

/**
 * Los usos de la cámara, cada uno con su tono del mismo azul.
 *
 * Bien separados y no vecinos: en una franja de nueve píxeles, dos azules
 * parecidos son un azul. Lo que hay que poder ver de un vistazo es cuándo la
 * cámara pasa de llenar el cuadro a ser una cajita. La caja y el lateral
 * comparten tono porque son lo mismo —un recorte al costado— en dos layouts.
 */
const TONOS_CAMARA = { entera: '#5aa5ff', caja: '#3a7bc8', lateral: '#3a7bc8', pip: '#27547f' };

let edicion = null;
let duracion = 0;

/**
 * Las pistas, con sus clips ordenados y cuál está encendido.
 *
 * Se guarda el índice del clip activo de cada pista para no recorrer
 * quinientos elementos en cada aviso de tiempo. Por pista y no una sola vez
 * para todas porque los cortes de audio NO caen donde los de imagen: son 152
 * pedazos en sitios propios, y encender el de audio solo cuando cambia el shot
 * lo dejaría un rato atrasado.
 */
let filas = [];

const nombres = () => $('#linea-nombres');
const cuerpo = () => $('#linea-pistas');

const pct = segundos => `${(segundos / duracion) * 100}%`;

/**
 * Junta en un solo clip los shots seguidos que hacen lo mismo.
 *
 * @param {Function} modoDe  shot → con qué etiqueta entra, o `null` si no entra
 */
function tramos(ed, modoDe) {
    const juntados = [];
    for (const shot of ed.shots) {
        const modo = modoDe(shot);
        if (!modo) continue;
        const ultimo = juntados[juntados.length - 1];
        // Se corta el tramo si cambia el modo o si hay un hueco: dos usos de
        // la cámara separados por tres shots de pantalla son dos clips, no uno
        // largo con un agujero adentro.
        if (ultimo && ultimo.modo === modo && ultimo.hastaF === shot.f0) {
            ultimo.hastaF = shot.f0 + shot.nf;
            ultimo.shots++;
        } else {
            juntados.push({ modo, desdeF: shot.f0, hastaF: shot.f0 + shot.nf, shots: 1 });
        }
    }
    return juntados.map(t => ({
        modo: t.modo,
        shots: t.shots,
        desde: t.desdeF / ed.fps,
        hasta: t.hastaF / ed.fps
    }));
}

/**
 * Agrega una pista: su nombre en la columna de la izquierda y su fila vacía.
 *
 * @returns {{poner: Function}} con qué meterle clips
 */
function pista(nombre, alto, clase) {
    const rotulo = document.createElement('div');
    rotulo.className = 'linea-nombre';
    rotulo.style.height = `${alto}px`;
    rotulo.textContent = nombre;
    nombres().appendChild(rotulo);

    const fila = document.createElement('div');
    fila.className = `linea-fila${clase ? ` ${clase}` : ''}`;
    fila.style.height = `${alto}px`;
    cuerpo().appendChild(fila);

    const clips = [];
    filas.push({ clips, activo: -1 });

    return {
        poner({ desde, hasta, color, texto, titulo }) {
            const el = document.createElement('div');
            el.className = 'clip';
            el.style.left = pct(desde);
            el.style.width = pct(hasta - desde);
            if (color) el.style.background = color;
            if (titulo) el.title = titulo;
            if (texto) el.innerHTML = `<span>${escapar(texto)}</span>`;
            fila.appendChild(el);
            clips.push({ el, desde, hasta });
            return el;
        }
    };
}

/** Lo que dice un clip del montaje al pasarle el puntero por encima. */
function fichaDeShot(shot, ed) {
    const partes = [
        `Clip ${shot.i} · ${shot.layout}`,
        `bloque ${shot.block}`,
        `${(shot.nf / ed.fps).toFixed(2)} s`,
        `fuente ${fmt.reloj(shot.src)}`
    ];
    if (shot.scene) partes.push(`escena ${shot.scene}`);
    if (shot.pip) partes.push('con PiP');
    return partes.join(' · ');
}

const NOMBRE_DE_USO = { entera: 'a cuadro completo', caja: 'en caja', lateral: 'al costado', pip: 'en PiP' };

/**
 * Dibuja la línea de tiempo de una edición.
 *
 * Todo en porcentajes y de una sola vez: así redimensionar la ventana o plegar
 * un panel no obliga a repintar quinientos elementos, lo resuelve el navegador
 * solo. El orden de las llamadas a `pista` es el orden de arriba abajo, y de
 * OVERLAY para abajo es además el orden en que el compositor las dibuja.
 */
export function montar(ed) {
    desmontar();
    if (!ed) return;
    duracion = ed.duracion || (ed.cuadros / ed.fps);
    if (!duracion) return;
    edicion = ed;

    // ── Bloques: la división temática de la clase ────────────────────
    // No es una capa de imagen, es el índice. Por eso va arriba de todo y
    // separado, como los capítulos de un video.
    const bloques = pista('BLOQUES', 11, 'es-bloques');
    for (const bloque of ed.bloques || []) {
        const suyos = ed.shots.filter(s => s.block === bloque.id);
        if (!suyos.length) continue;
        const ultimo = suyos[suyos.length - 1];
        const desde = suyos[0].f0 / ed.fps;
        const hasta = (ultimo.f0 + ultimo.nf) / ed.fps;
        bloques.poner({
            desde,
            hasta,
            texto: bloque.id,
            titulo: `Bloque ${bloque.id} · ${suyos.length} clips · ${fmt.reloj(hasta - desde)}`
        });
    }

    // ── Clips: los cortes ────────────────────────────────────────────
    // La pista que se navega con las flechas y la que contesta «¿de dónde
    // sale lo que estoy viendo?». Un clip por shot, con el color de su layout.
    const clips = pista('CLIPS', 12);
    for (const shot of ed.shots) {
        const el = clips.poner({
            desde: shot.f0 / ed.fps,
            hasta: (shot.f0 + shot.nf) / ed.fps,
            color: COLORES[shot.layout] || COLOR_RARO,
            titulo: fichaDeShot(shot, ed)
        });
        el.dataset.shot = String(shot.i);
    }

    // ── Overlay ──────────────────────────────────────────────────────
    // Va encima de todo lo demás en el cuadro, así que va encima de todo lo
    // demás acá.
    if ((ed.overlays || []).length) {
        const overlays = pista('OVERLAY', 9);
        for (const ov of ed.overlays) {
            overlays.poner({
                desde: ov.out,
                hasta: ov.out + ov.dur,
                color: COLOR_OVERLAY,
                texto: sinCarpetaNiExtension(ov.file),
                titulo: `${ov.file} · ${ov.dur.toFixed(2)} s`
            });
        }
    }

    // ── Cámara ───────────────────────────────────────────────────────
    // Un solo material con tres usos: llena el cuadro, es una caja al lado de
    // la escena, o es un PiP sobre la pantalla. Tres tonos del mismo azul y no
    // tres pistas, porque es la misma cámara y el mismo archivo.
    const camara = pista('CÁMARA', 9);
    for (const t of tramos(ed, modelo.camaraDe)) {
        camara.poner({
            desde: t.desde,
            hasta: t.hasta,
            color: TONOS_CAMARA[t.modo],
            titulo: `Cámara ${NOMBRE_DE_USO[t.modo]} · ${fmt.reloj(t.hasta - t.desde)} · ${t.shots} clips`
        });
    }

    // ── Escenas ──────────────────────────────────────────────────────
    const escenas = Object.entries(ed.escenas || {});
    if (escenas.length) {
        const pistaEscenas = pista('ESCENAS', 9);
        for (const [nombre, e] of escenas) {
            pistaEscenas.poner({
                desde: e.out,
                hasta: e.out + e.dur,
                color: COLOR_ESCENA,
                texto: nombre,
                titulo: `Escena ${nombre} · ${e.dur.toFixed(2)} s`
            });
        }
    }

    // ── Pantalla ─────────────────────────────────────────────────────
    const pantalla = pista('PANTALLA', 9);
    for (const t of tramos(ed, s => (modelo.layoutDe(s).pantalla ? 'pantalla' : null))) {
        pantalla.poner({
            desde: t.desde,
            hasta: t.hasta,
            color: COLORES.SCREEN,
            titulo: `Pantalla · ${fmt.reloj(t.hasta - t.desde)} · ${t.shots} clips`
        });
    }

    // ── Audio ────────────────────────────────────────────────────────
    // Abajo, como en cualquier mesa. Y cortado, porque lo está: sus 152
    // pedazos no caen en los mismos sitios que los de imagen, y ver que un
    // corte de audio NO coincide con uno de imagen es la mitad de lo que se
    // revisa en un montaje.
    if ((ed.audio || []).length) {
        const audio = pista('AUDIO', 10, 'es-audio');
        for (const a of ed.audio) {
            audio.poner({
                desde: a.out,
                hasta: a.out + a.dur,
                color: COLOR_AUDIO,
                titulo: `Audio · ${a.dur.toFixed(2)} s · fuente ${fmt.reloj(a.src)}`
            });
        }
    }

    // No se dibuja el fondo animado. Está en los nueve minutos enteros, así
    // que su pista sería una barra sólida de punta a punta: ocupa alto y no
    // contesta ninguna pregunta.

    nombres().hidden = false;
    cuerpo().hidden = false;
    $('#linea').classList.add('con-pistas');
    $('#linea-pista').classList.add('con-pistas');
}

function sinCarpetaNiExtension(ruta) {
    return String(ruta || '').split('/').pop().replace(/\.[^.]+$/, '');
}

/**
 * El clip de una pista que contiene a `t`, o -1 si en ese instante no hay.
 *
 * Búsqueda binaria: los clips están ordenados y sin solaparse, y esto corre
 * una vez por pista en cada aviso de tiempo.
 */
function clipEn(clips, t) {
    let bajo = 0;
    let alto = clips.length - 1;
    while (bajo <= alto) {
        const medio = (bajo + alto) >> 1;
        const c = clips[medio];
        if (t < c.desde) alto = medio - 1;
        else if (t >= c.hasta) bajo = medio + 1;
        else return medio;
    }
    return -1;
}

/**
 * Enciende, en cada pista, el clip que se está viendo.
 *
 * Solo toca el DOM cuando el clip activo de esa pista cambió. Esto se llama
 * con cada aviso de tiempo, treinta veces por segundo, con un compositor
 * corriendo al lado: apagar y encender quinientas clases para dejar todo igual
 * es trabajo que se nota.
 */
export function seguir(t) {
    if (!edicion) return;
    for (const fila of filas) {
        const i = clipEn(fila.clips, t);
        if (i === fila.activo) continue;
        if (fila.activo >= 0) fila.clips[fila.activo].el.classList.remove('is-aqui');
        if (i >= 0) fila.clips[i].el.classList.add('is-aqui');
        fila.activo = i;
    }
}

export function desmontar() {
    edicion = null;
    duracion = 0;
    filas = [];
    nombres().textContent = '';
    nombres().hidden = true;
    cuerpo().textContent = '';
    cuerpo().hidden = true;
    $('#linea').classList.remove('con-pistas');
    $('#linea-pista').classList.remove('con-pistas');
}

export { COLORES, tramos, clipEn };
