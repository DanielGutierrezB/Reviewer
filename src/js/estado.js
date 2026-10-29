'use strict';
/**
 * estado.js — Lo que la ventana sabe ahora mismo.
 *
 * Un solo objeto y no uno por módulo: el reproductor, el panel y el canvas
 * tienen que estar de acuerdo en qué versión está abierta y a qué cuadro apunta
 * el cabezal, y tres copias de esa respuesta es como se desincronizan.
 */

export const estado = {
    raiz: null,
    clases: [],
    /** La clase abierta y, adentro de ella, la versión. */
    claseId: null,
    version: null,
    /** Lo que devolvió el motor para esa versión: comentarios, cuenta, rutas. */
    datos: null,
    /** El comentario del curso entero. */
    general: null,
    referencias: [],
    /** El tramo marcado con Entrada/Salida, si hay. */
    rango: { desde: null, hasta: null },
    /** Qué comentario está resaltado (y mostrando su dibujo sobre el video). */
    mirado: null,
    ajustes: null,
    puedeDictar: false
};

export function claseActual() {
    return estado.clases.find(c => c.id === estado.claseId) || null;
}

export function fps() {
    return (estado.version && estado.version.media && estado.version.media.fps) || 25;
}

export function rutaActual() {
    return estado.version ? estado.version.ruta : null;
}

export function comentarios() {
    return (estado.datos && estado.datos.comentarios) || [];
}

export function comentarioPorId(id) {
    return comentarios().find(c => c.id === id) || null;
}
