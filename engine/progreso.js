'use strict';
/**
 * progreso.js — Cuánto va un trabajo del taller, leído de lo que sus scripts
 * dejan en el disco.
 *
 * `step_status.json` dice en qué etapa está un trabajo, pero no cuánto lleva
 * de ella, y una barra que salta de etapa en etapa no sirve para saber si
 * falta un minuto o diez. Lo que sí hay son rastros: las tomas renderizadas
 * son archivos, el OCR anota cuántos tramos lleva, la unión y el armado
 * escriben un archivo que crece hasta un tamaño que se puede calcular. Acá se
 * leen esos rastros y se convierten en una fracción.
 *
 * Esto está aparte de `taller.js` a propósito: aquel lee el protocolo del
 * worker —archivos que `mac_worker.sh` y `step.py` definen y que no cambian—
 * mientras que esto sabe cómo se llaman los intermedios de `render7.py`,
 * `finish4.py` y `ocrplan3.py`, que es lo que hay que tocar cuando Claude
 * cambie sus scripts. Dos razones de cambio, dos archivos.
 *
 * **Donde no hay rastro, no se inventa.** El control de calidad lee el video
 * entero sin escribir nada; la barra se queda quieta en el borde de esa etapa
 * en vez de arrastrarse sola hasta el 99 %, que es la mentira de siempre.
 */

const fs = require('fs');
const path = require('path');

/**
 * Cuánto pesa cada etapa dentro de un trabajo.
 *
 * Salen de medir una clase de diez minutos en este Mac: el render se lleva
 * unos 80 s, el control de calidad 11, la unión y el armado unos pocos, y el
 * audio ya no cuenta porque corre en paralelo con el render y no agrega
 * tiempo de reloj. El OCR solo aparece en las clases con pantallas.
 *
 * No son exactos ni pueden serlo —una clase con más pantallas pasa más tiempo
 * en OCR—, pero la barra tiene que avanzar parecido a como pasa el tiempo, y
 * repartir en partes iguales haría que el render, que es casi todo, pareciera
 * un séptimo.
 */
const PESOS = { ocr: 8, render: 72, audio: 2, video: 5, mux: 2, qa: 11 };
const ORDEN = Object.keys(PESOS);
const TOTAL = Object.values(PESOS).reduce((a, b) => a + b, 0);

function leerJSON(ruta) {
    try {
        return JSON.parse(fs.readFileSync(ruta, 'utf8'));
    } catch (e) {
        return null;
    }
}

/** El tamaño de un archivo, o 0 si no está. */
function bytesDe(ruta) {
    try {
        return fs.statSync(ruta).size;
    } catch (e) {
        return 0;
    }
}

/** Las tomas ya renderizadas: los `0000.mp4` terminados de su carpeta. */
function segmentosDe(taller, seg) {
    try {
        return fs.readdirSync(path.join(taller, seg)).filter(f => /^\d{4}\.mp4$/.test(f));
    } catch (e) {
        return [];
    }
}

/**
 * En cuántos pedazos parte el OCR las pantallas de un plan.
 *
 * Es la misma cuenta que hace `ocrplan3.py`: junta las tomas con pantalla que
 * estén a menos de 0,6 s una de otra y corta lo que queda en tramos de 45 s.
 * Se repite acá porque el script guarda cuántos tramos lleva hechos pero no
 * cuántos hay en total, y sin el total ese número no dice nada.
 *
 * Está duplicada, y eso es una deuda consciente: si allá cambia el 45 o el
 * 0,6, la barra del OCR miente hasta que alguien la mueva acá también.
 */
function tramosDeOCR(shots) {
    const ivs = [];
    for (const s of shots) {
        if (s.layout !== 'SCREEN') continue;
        const a = s.src;
        const b = s.src + s.nf / 30;
        const ultimo = ivs[ivs.length - 1];
        if (ultimo && a - ultimo[1] < 0.6) ultimo[1] = Math.max(ultimo[1], b);
        else ivs.push([a, b]);
    }
    let tramos = 0;
    for (const [a, b] of ivs) {
        for (let t = a; t < b - 0.05; t += 45) tramos++;
    }
    return tramos;
}

/**
 * Lo que hay que saber de un plan: cuántas tomas y cuántos tramos de OCR.
 *
 * Se recuerda por plan y fecha de modificación: los planes pesan megabytes y
 * esto se pregunta cada vez que la ventana se repinta. Si Claude reescribe el
 * plan, la fecha cambia y se vuelve a leer.
 */
const porPlan = new Map();
function planDe(taller, plan) {
    const ruta = path.join(taller, plan);
    let fecha;
    try {
        fecha = fs.statSync(ruta).mtimeMs;
    } catch (e) {
        return { tomas: null, tramosOCR: 0, etiqueta: null };
    }
    const guardado = porPlan.get(ruta);
    if (guardado && guardado.fecha === fecha) return guardado.datos;
    const P = leerJSON(ruta);
    const shots = P && Array.isArray(P.shots) ? P.shots : null;
    // El tag con el que `ocrplan3.py` nombra su archivo de avance sale del
    // nombre del plan (`v7/plan_c5p1c.json` → `c5p1c`), y no del tag del
    // trabajo, que es otro.
    const m = /(?:^|\/)plan_(.+)\.json$/.exec(plan);
    const datos = {
        tomas: shots ? shots.length : null,
        tramosOCR: shots ? tramosDeOCR(shots) : 0,
        etiqueta: m ? m[1] : null
    };
    porPlan.set(ruta, { fecha, datos });
    return datos;
}

/** Las tomas de un trabajo: cuántas hay y cuántas pide el plan. */
function tomasDe(taller, job, plan) {
    if (!plan.tomas) return null;
    return { hechas: Math.min(segmentosDe(taller, job.seg).length, plan.tomas), total: plan.tomas };
}

/**
 * Qué fracción de cada etapa va hecha, por el rastro que deja. Una etapa que
 * no está acá —el control de calidad— no tiene rastro, y da `null`.
 *
 * @type {Object<string, (c: {taller: string, job: object, plan: object, tomas: object|null}) => number|null>}
 */
const AVANCE = {
    render: ({ tomas }) => (tomas && tomas.total ? tomas.hechas / tomas.total : null),

    ocr({ taller, plan }) {
        if (!plan.tramosOCR || !plan.etiqueta) return null;
        const st = leerJSON(path.join(taller, 'v7', `ocr3_${plan.etiqueta}.json`));
        return st && Number.isFinite(st.done) ? Math.min(1, st.done / plan.tramosOCR) : 0;
    },

    // Tres pasos sin avance interno: el wav crudo, el análisis de volumen y
    // el m4a. Se cuenta cuál de los dos archivos ya está.
    audio({ taller, job }) {
        const crudo = bytesDe(path.join(taller, `${job.tag}_audio_raw.wav`)) ? 1 : 0;
        const listo = bytesDe(path.join(taller, `${job.tag}_audio.m4a`)) ? 1 : 0;
        return (crudo + listo) / 2;
    },

    // La unión es una copia de flujo: el archivo final pesa lo que pesan todos
    // los segmentos juntos, así que lo que lleva escrito ES el avance, al byte.
    video({ taller, job }) {
        const escrito = bytesDe(path.join(taller, `${job.tag}_video.mp4`));
        if (!escrito) return 0;
        const dir = path.join(taller, job.seg);
        const total = segmentosDe(taller, job.seg).reduce((a, f) => a + bytesDe(path.join(dir, f)), 0);
        return total ? Math.min(1, escrito / total) : null;
    },

    mux({ taller, job }) {
        const esperado = bytesDe(path.join(taller, `${job.tag}_video.mp4`))
            + bytesDe(path.join(taller, `${job.tag}_audio.m4a`));
        const hecho = bytesDe(path.join(path.dirname(taller), 'Clases_Editadas', job.name));
        return esperado ? Math.min(1, hecho / esperado) : null;
    }
};

/** Qué decir al lado de la barra, cuando hay algo concreto que decir. */
function detalleDe(etapa, dentro, { plan, tomas }) {
    if (etapa === 'render' && tomas && tomas.total) return `${tomas.hechas} de ${tomas.total} tomas`;
    if (etapa === 'ocr' && plan.tramosOCR) return `${Math.round((dentro || 0) * plan.tramosOCR)} de ${plan.tramosOCR} tramos`;
    if (dentro !== null && dentro > 0 && dentro < 1) return `${Math.round(dentro * 100)}%`;
    return null;
}

/**
 * Cuánto va del trabajo entero, de 0 a 1, y qué decir al lado de la barra.
 *
 * Las etapas ya pasadas suman su peso completo; la actual suma su peso por lo
 * que lleve hecho. Un trabajo cortado se queda donde llegó: borrarle el avance
 * escondería que había hecho 116 tomas antes de fallar en el último paso. Y
 * como `step.py` pisa la etapa con `error`, lo único medible que queda son
 * las tomas: se cuenta como si estuviera en render, sin detalle.
 */
function progresoDe(taller, job, etapa) {
    if (etapa === 'delivered' || etapa === 'unchanged') return { fraccion: 1, detalle: null };
    if (etapa === 'error') return { ...progresoDe(taller, job, 'render'), detalle: null };

    const plan = planDe(taller, job.plan);
    const contexto = { taller, job, plan, tomas: tomasDe(taller, job, plan) };
    const donde = ORDEN.indexOf(etapa);
    const antes = ORDEN.slice(0, Math.max(0, donde)).reduce((a, e) => a + PESOS[e], 0);
    const dentro = AVANCE[etapa] ? AVANCE[etapa](contexto) : null;
    const fraccion = (antes + (PESOS[etapa] || 0) * (dentro === null ? 0 : dentro)) / TOTAL;
    return { fraccion: Math.min(1, fraccion), detalle: detalleDe(etapa, dentro, contexto), tomas: contexto.tomas };
}

module.exports = { PESOS, tramosDeOCR, planDe, tomasDe, progresoDe };
