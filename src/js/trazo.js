'use strict';
/**
 * trazo.js — Cómo NACE un trazo. Lo comparten las dos pizarras.
 *
 * Hay dos lugares donde se dibuja: la pizarra de la ventana principal
 * (`dibujo.js`) y la de la segunda pantalla (`pantalla-ventana.js`). Mientras
 * en el iPad solo se podía dibujar a mano alzada, lo repetido eran cuatro
 * líneas parecidas y no molestaba a nadie. Con las formas ya no: las dos
 * tendrían que saber que una caja son dos puntos y no los veinte que recorrió
 * el lápiz, y cuál es el largo abajo del cual una flecha es un pinchazo. Dos
 * copias de eso se desincronizan en silencio, y el síntoma es el peor de
 * todos: el mismo gesto da una forma en la Mac y nada en el iPad.
 *
 * **Acá no se pinta.** Pintar sigue en `dibujo.js` (`pintarEn`), que ya era
 * compartido y es además el que compone el PNG que ve Claude. La línea está en
 * que el que pinta necesita un canvas y un tamaño, y el que arma no necesita
 * nada: así este módulo se puede probar sin ventana (`tests/trazo.test.js`).
 */

/**
 * Más cerca que esto del punto anterior y el punto no se guarda, en fracción
 * del lado del cuadro.
 *
 * Un trazo de dos segundos son ciento veinte eventos y con esto quedan treinta:
 * el resto no cambia un píxel en pantalla y sí engorda el JSON del comentario.
 */
const JUNTOS = 0.004;

/**
 * Y una forma más corta que esto tampoco se guarda.
 *
 * Es el clic suelto: apretar para pausar el video dejaba una flecha de tres
 * píxeles. A mano alzada no se aplica —un trazo corto puede ser un punto hecho
 * a propósito—, pero una caja de la nada no es nada.
 */
const MINIMO = 0.01;

/**
 * De un evento de puntero a un punto del trazo, de 0 a 1 sobre la caja.
 *
 * La caja llega medida de afuera y no se mide acá porque esto se llama una vez
 * por evento fusionado: un `getBoundingClientRect` adentro del bucle fuerza un
 * cálculo de layout por punto, y con un Pencil a 240 Hz eso se siente.
 */
export function puntoEn(caja, evento) {
    return {
        x: Math.max(0, Math.min(1, (evento.clientX - caja.left) / caja.width)),
        y: Math.max(0, Math.min(1, (evento.clientY - caja.top) / caja.height)),
        // Un mouse informa 0.5 fijo mientras el botón está apretado; una Wacom
        // y un Apple Pencil informan de verdad. Chromium a veces manda 0 en el
        // primer evento de un lápiz, antes de tener la lectura: eso no es
        // "apoyó sin fuerza", es "todavía no sé", y vale más el 0.5 neutro.
        p: evento.pressure > 0 ? evento.pressure : 0.5
    };
}

/**
 * El portero de una pizarra: si este puntero dibuja o es la palma apoyada.
 *
 * Es una fábrica y no una función sola porque el «ya vi un lápiz» es de cada
 * pantalla. La Mac puede tener un mouse mientras el iPad tiene un Pencil, y un
 * `huboLapiz` compartido entre las dos dejaría al mouse de la Mac sin poder
 * dibujar en cuanto alguien tocara el iPad una vez.
 */
export function rechazoDePalma() {
    let huboLapiz = false;
    return evento => {
        if (evento.pointerType === 'pen') {
            huboLapiz = true;
            return true;
        }
        // Con una tableta o un iPad en Sidecar, la mano que apoya el borde de
        // la palma genera eventos `touch` mientras el lápiz dibuja, y cada uno
        // sería un trazo. Una vez visto un `pen`, el dedo deja de dibujar: en
        // una pantalla donde hay lápiz, el dedo sirve para otra cosa.
        return !(huboLapiz && evento.pointerType === 'touch');
    };
}

/**
 * Le suma al trazo en curso lo que acaba de hacer el puntero.
 *
 * **Una forma guarda dos puntos y no el camino.** Una caja, una elipse y una
 * flecha quedan definidas por dónde empezó el lápiz y dónde está ahora; lo que
 * hizo la mano en el medio no se dibuja, así que guardarlo sería guardar algo
 * que nadie va a mirar nunca. Es además lo que hace que la presión no engorde
 * una forma como engorda un trazo libre: `pintarEn` solo varía el grosor entre
 * dos puntos consecutivos, y con dos puntos no hay a lo largo de qué variar.
 * Una flecha que adelgaza en la mitad no se lee como una flecha.
 */
export function estirar(trazo, caja, evento) {
    if (trazo.lapiz !== 'libre') {
        trazo.puntos = [trazo.puntos[0], puntoEn(caja, evento)];
        return;
    }
    // Un lápiz manda hasta 240 posiciones por segundo y la pantalla solo
    // despierta a 60: Chromium junta las que pasaron entre dos cuadros y las
    // entrega acá. Sin pedirlas, un trazo rápido sale poligonal.
    const tramos = typeof evento.getCoalescedEvents === 'function'
        ? evento.getCoalescedEvents()
        : [evento];
    for (const tramo of (tramos.length ? tramos : [evento])) {
        const p = puntoEn(caja, tramo);
        const ultimo = trazo.puntos[trazo.puntos.length - 1];
        if (Math.hypot(p.x - ultimo.x, p.y - ultimo.y) < JUNTOS) continue;
        trazo.puntos.push(p);
    }
}

/** Si lo que se soltó es un trazo de verdad o fue un clic que pasaba por ahí. */
export function sirve(trazo) {
    const p = trazo && trazo.puntos;
    if (!Array.isArray(p) || p.length < 2) return false;
    if (trazo.lapiz === 'libre') return true;
    return Math.hypot(p[p.length - 1].x - p[0].x, p[p.length - 1].y - p[0].y) >= MINIMO;
}
