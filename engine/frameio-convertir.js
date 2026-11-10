'use strict';
/**
 * frameio-convertir.js — Un comentario de Frame.io, dicho en la forma de
 * Reviewer.
 *
 * Es puro: entra lo que contestó la API y sale lo que `comentarios.js` guarda.
 * Todo lo que sabe de los dos formatos vive acá, así que cuando Frame.io
 * cambie algo hay un solo archivo que mirar.
 *
 * Las cuatro traducciones que importan:
 *
 * 1. **El instante.** Se pide `timestamp_as_timecode=false`, así que llega como
 *    número de CUADRO. Pasa a segundos con los fps que midió ffprobe del render
 *    de verdad, y no con 24 ni 30 de fábrica: una clase a 29.97 comentada en el
 *    cuadro 2500 cae un segundo y medio más adelante si se divide por 30.
 * 2. **El tramo.** `duration` también viene en cuadros, y es la LARGO del
 *    tramo, no su final: `tHasta = (timestamp + duration) / fps`.
 * 3. **El dibujo.** `annotation` es un JSON en texto, con las figuras en
 *    coordenadas de 0 a 1 —igual que los trazos de Reviewer—, así que la
 *    conversión es directa. Lo único documentado es `rect`; el resto de las
 *    herramientas las escribe la web de Frame.io y su forma no está publicada,
 *    así que se reconoce lo que se puede y lo que no se entiende **no se tira**:
 *    queda crudo en el comentario, que es lo que deja que un dibujo raro se
 *    pueda mirar en Frame.io en vez de desaparecer sin dejar rastro.
 * 4. **Las respuestas.** Van adentro del texto, debajo, con su autor. Un hilo
 *    partido en cinco comentarios sueltos no se entiende; junto, sí.
 *
 * **El id y el autor se conservan en `origen`.** Es lo que hace que importar
 * dos veces no duplique, que un cambio en Frame.io actualice en vez de agregar,
 * y que resolver acá sepa a qué comentario de allá hay que marcarle la casilla.
 */

/** Las herramientas de Frame.io que Reviewer sabe dibujar, y su lápiz. */
const LAPICES = {
    rect: 'caja',
    rectangle: 'caja',
    square: 'caja',
    ellipse: 'elipse',
    circle: 'elipse',
    oval: 'elipse',
    arrow: 'flecha',
    line: 'flecha',
    pen: 'libre',
    path: 'libre',
    freehand: 'libre',
    draw: 'libre',
    pencil: 'libre'
};

/** El color de Reviewer por defecto, para una figura que no trae el suyo. */
const COLOR = '#ff4d4f';

const num = v => (Number.isFinite(Number(v)) ? Number(v) : null);
const entre01 = v => Math.max(0, Math.min(1, v));
const punto = (x, y) => ({ x: entre01(x), y: entre01(y), p: 0.5 });

/**
 * Los puntos de un trazo a mano alzada, venga como venga.
 *
 * La web de Frame.io los manda en una lista que, según la versión, se llama
 * `points`, `path` o `vertices`, y cada punto es `[x, y]` o `{x, y}`. Se
 * aceptan las dos formas en vez de elegir una: adivinar mal deja el dibujo
 * vacío, y un trazo vacío se ve exactamente igual que no tener dibujo.
 */
function puntosDe(figura) {
    const lista = figura.points || figura.path || figura.vertices;
    if (!Array.isArray(lista)) return [];
    return lista
        .map(p => (Array.isArray(p)
            ? { x: num(p[0]), y: num(p[1]) }
            : { x: num(p && p.x), y: num(p && p.y) }))
        .filter(p => p.x !== null && p.y !== null)
        .map(p => punto(p.x, p.y));
}

/**
 * Una figura de Frame.io a un trazo de Reviewer, o `null` si no se entiende.
 *
 * Las figuras de dos puntos —caja, elipse, flecha— se guardan en Reviewer como
 * el primero y el último punto del trazo, que es como las dibuja `pintarEn`.
 */
function trazoDe(figura) {
    if (!figura || typeof figura !== 'object') return null;
    const lapiz = LAPICES[String(figura.tool || figura.type || '').toLowerCase()];
    if (!lapiz) return null;
    const color = typeof figura.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(figura.color) ? figura.color : COLOR;

    if (lapiz === 'libre') {
        const puntos = puntosDe(figura);
        return puntos.length >= 2 ? { lapiz, color, puntos } : null;
    }

    // Caja y elipse llegan como esquina más tamaño; flecha y línea, como dos
    // extremos. Se acepta cualquiera de las dos descripciones.
    const x = num(figura.x);
    const y = num(figura.y);
    const w = num(figura.w !== undefined ? figura.w : figura.width);
    const h = num(figura.h !== undefined ? figura.h : figura.height);
    if (x !== null && y !== null && w !== null && h !== null) {
        return { lapiz, color, puntos: [punto(x, y), punto(x + w, y + h)] };
    }
    const x1 = num(figura.x1 !== undefined ? figura.x1 : figura.ix);
    const y1 = num(figura.y1 !== undefined ? figura.y1 : figura.iy);
    const x2 = num(figura.x2);
    const y2 = num(figura.y2);
    if (x1 !== null && y1 !== null && x2 !== null && y2 !== null) {
        return { lapiz, color, puntos: [punto(x1, y1), punto(x2, y2)] };
    }
    return null;
}

/**
 * El dibujo de un comentario: los trazos que se entendieron, y si quedó algo
 * afuera.
 *
 * `crudo` se devuelve para guardarlo tal cual cuando no se pudo traducir todo.
 * No es paranoia: el día que Frame.io agregue una herramienta, el comentario va
 * a seguir diciendo que tiene un dibujo y va a poder mandar a verlo allá, en
 * vez de mostrarse como si no tuviera nada.
 */
function dibujoDe(annotation) {
    if (typeof annotation !== 'string' || !annotation.trim()) return { trazos: null, completo: true };
    let figuras;
    try {
        figuras = JSON.parse(annotation);
    } catch (e) {
        return { trazos: null, completo: false };
    }
    if (!Array.isArray(figuras)) figuras = [figuras];
    const trazos = figuras.map(trazoDe).filter(Boolean);
    return {
        trazos: trazos.length ? trazos : null,
        completo: trazos.length === figuras.length
    };
}

/** Cómo se llama quien escribió algo en Frame.io. */
function autorDe(algo) {
    const o = (algo && algo.owner) || {};
    return (typeof o.name === 'string' && o.name.trim())
        || (typeof o.email === 'string' && o.email.trim())
        || 'alguien';
}

/**
 * El texto del comentario con sus respuestas debajo.
 *
 * Las respuestas llevan el autor adelante y el comentario de arriba no, porque
 * de ese ya lo dice la tarjeta. Un hilo con dos respuestas se lee como una
 * conversación corta, que es lo que es.
 */
function textoDe(comentario) {
    const base = String(comentario.text || '').trim();
    const respuestas = (comentario.replies || [])
        .filter(r => String(r.text || '').trim())
        .map(r => `↳ ${autorDe(r)}: ${String(r.text).trim()}`);
    return [base, ...respuestas].filter(Boolean).join('\n');
}

/**
 * Un comentario de Frame.io, listo para `comentarios.fusionarDeFrameio`.
 *
 * No lleva `id`: el id de Reviewer lo pone la fusión, porque depende de qué
 * números ya se entregaron en esa versión. Lo que sí lleva es `origen`, que es
 * por donde se lo reconoce entre una importación y la siguiente.
 *
 * @param {object} comentario  lo que contestó la API
 * @param {{fps: number, fileId: string}} contexto
 */
function comentario(crudo, contexto = {}) {
    const fps = Number(contexto.fps) > 0 ? Number(contexto.fps) : 30;
    const cuadro = num(crudo.timestamp);
    const largo = num(crudo.duration);
    const t = cuadro !== null ? Math.max(0, cuadro / fps) : 0;
    const dibujo = dibujoDe(crudo.annotation);

    return {
        t,
        // Un tramo es instante más largo. Sin `duration`, o con cero, es un
        // instante: `comentarios.js` ya descarta un `tHasta` que no sea mayor.
        tHasta: cuadro !== null && largo ? (cuadro + largo) / fps : null,
        texto: textoDe(crudo),
        estado: crudo.completed_at ? 'resuelto' : 'abierto',
        trazos: dibujo.trazos,
        creado: crudo.created_at || null,
        origen: {
            frameio: {
                id: crudo.id,
                fileId: crudo.file_id || contexto.fileId || null,
                autor: autorDe(crudo),
                // Con qué versión de allá se armó esto. Si cambia, se reimporta;
                // si no, se deja como está aunque el editor lo haya movido acá.
                actualizado: crudo.updated_at || crudo.created_at || null,
                vista: typeof crudo.view_url === 'string' ? crudo.view_url : null,
                // El dibujo que no se pudo traducir, para no perderlo.
                annotation: dibujo.completo ? null : (crudo.annotation || null),
                respuestas: (crudo.replies || []).length
            }
        }
    };
}

/** Varios de una, en el orden en que van a aparecer en la línea de tiempo. */
function comentarios(crudos, contexto) {
    return (crudos || [])
        .filter(c => c && c.id)
        .map(c => comentario(c, contexto))
        .sort((a, b) => a.t - b.t);
}

module.exports = { comentario, comentarios };
