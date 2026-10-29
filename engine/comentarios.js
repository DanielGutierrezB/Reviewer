'use strict';
/**
 * comentarios.js — Los comentarios de UNA versión, en su carpeta.
 *
 * El `comentarios.json` es la fuente de verdad y el `feedback.md` es lo que se
 * lee: cada vez que acá cambia algo se reescriben los dos, en ese orden. Que el
 * markdown se derive del JSON y nunca al revés es lo que permite que el editor
 * cambie el estado de un comentario tres veces y el archivo que va a leer
 * Claude siga siendo coherente.
 *
 * **Las rutas adentro del JSON son relativas a su carpeta.** El `feedback.md`
 * las escribe absolutas porque Claude las va a abrir, pero el JSON no: la
 * carpeta de una versión se copia, se manda por Drive y se abre en otra Mac con
 * otro nombre de usuario, y un JSON con `/Users/daniel/...` adentro apuntaría a
 * ningún lado. Lo que viaja junto tiene que referirse a sí mismo.
 *
 * **La carpeta se crea con el primer comentario y no antes.** Es la regla que
 * pidió el editor; `leer` nunca escribe nada.
 */

const fs = require('fs');
const path = require('path');

const feedback = require('./feedback');
const tiempo = require('./tiempo');
const workspace = require('./workspace');

const VERSION_ARCHIVO = 1;

const ESTADOS = ['abierto', 'resuelto'];

/** El esqueleto de una versión sin comentarios, que es lo que `leer` devuelve. */
function vacio(rutaVideo, media) {
    return {
        version: VERSION_ARCHIVO,
        video: path.basename(rutaVideo),
        fps: (media && media.fps) || tiempo.FPS_PORDEFECTO,
        ancho: (media && media.anchoReal) || 0,
        alto: (media && media.alto) || 0,
        duracion: (media && media.duracion) || 0,
        actualizado: null,
        instruccion: null,
        ultimoId: 0,
        comentarios: []
    };
}

/** Un comentario que vino de afuera, con todos sus campos y ninguno de más. */
function sanearComentario(crudo, indice) {
    const c = crudo || {};
    const t = Math.max(0, Number(c.t) || 0);
    const hasta = Number.isFinite(Number(c.tHasta)) && Number(c.tHasta) > t ? Number(c.tHasta) : null;
    return {
        id: typeof c.id === 'string' && c.id ? c.id : `c${String(indice + 1).padStart(2, '0')}`,
        t,
        tHasta: hasta,
        texto: typeof c.texto === 'string' ? c.texto : '',
        // Lo que se había dictado o tecleado antes de que el modelo lo
        // reescribiera. Es lo que devuelve el botón «↩ texto original», y vale
        // guardarlo: un refinado que cambió el sentido se arregla volviendo, no
        // reescribiendo de memoria lo que uno había dicho.
        textoCrudo: typeof c.textoCrudo === 'string' && c.textoCrudo ? c.textoCrudo : null,
        estado: ESTADOS.includes(c.estado) ? c.estado : 'abierto',
        frame: typeof c.frame === 'string' && c.frame ? c.frame : null,
        dibujo: typeof c.dibujo === 'string' && c.dibujo ? c.dibujo : null,
        trazos: Array.isArray(c.trazos) ? c.trazos : null,
        creado: c.creado || new Date().toISOString(),
        modificado: c.modificado || null
    };
}

/**
 * El número más alto que se entregó alguna vez en esta versión.
 *
 * Se guarda en el archivo en vez de deducirlo de la lista porque los ids
 * viajan: están en el `feedback.md` que ya se le pasó a Claude, en el nombre de
 * los PNG y en la instrucción consolidada. Si se borra c02 y el siguiente
 * comentario vuelve a llamarse c02, todo eso queda apuntando a otra cosa sin
 * que nada falle a la vista.
 */
function numeroDeId(comentarios, guardado) {
    let maximo = Number.isFinite(Number(guardado)) ? Math.max(0, Number(guardado)) : 0;
    for (const c of comentarios) {
        const m = /^c(\d+)$/.exec(c.id || '');
        if (m) maximo = Math.max(maximo, parseInt(m[1], 10));
    }
    return maximo;
}

function sanear(crudo, rutaVideo, media) {
    const base = vacio(rutaVideo, media);
    if (!crudo || typeof crudo !== 'object') return base;
    const comentarios = (Array.isArray(crudo.comentarios) ? crudo.comentarios : [])
        .map(sanearComentario)
        // Por tiempo y no por orden de escritura: la lista del panel es la línea
        // de tiempo del video, y un comentario agregado al final sobre el
        // segundo 3 tiene que aparecer arriba de todo.
        .sort((a, b) => a.t - b.t || a.id.localeCompare(b.id));

    return {
        ...base,
        // De lo guardado se conserva lo que el disco sabe mejor que el archivo:
        // si el render se reemplazó y ahora mide otra cosa, mandan los fps que
        // acaba de medir ffprobe y no los que anotó la sesión anterior.
        fps: (media && media.fps) || crudo.fps || base.fps,
        ancho: (media && media.anchoReal) || crudo.ancho || 0,
        alto: (media && media.alto) || crudo.alto || 0,
        duracion: (media && media.duracion) || crudo.duracion || 0,
        actualizado: crudo.actualizado || null,
        instruccion: crudo.instruccion && typeof crudo.instruccion.texto === 'string'
            ? {
                texto: crudo.instruccion.texto,
                modelo: crudo.instruccion.modelo || null,
                creado: crudo.instruccion.creado || null
            }
            : null,
        ultimoId: numeroDeId(comentarios, crudo.ultimoId),
        comentarios
    };
}

/** Lo que hay en el disco para esta versión. No crea nada. */
function leer(rutaVideo, media) {
    const archivos = workspace.archivosDeVersion(rutaVideo);
    return sanear(workspace.readJson(archivos.comentarios), rutaVideo, media);
}

/**
 * Escribe el JSON y, pegado, el markdown.
 *
 * Si no queda ningún comentario y tampoco hay instrucción, **se borran los dos
 * archivos**: la misma disciplina que el comentario general. Un `feedback.md`
 * con cero comentarios al lado de un render es un archivo que parece decir algo
 * y no dice nada, y lo peor es que Claude lo leería igual. Lo que no se borra es
 * la carpeta: adentro quedan los PNG de los cuadros, que son trabajo —y si está
 * vacía, se va.
 */
function guardar(rutaVideo, datos, contexto) {
    const archivos = workspace.archivosDeVersion(rutaVideo);
    const limpio = sanear(datos, rutaVideo, contexto && contexto.media);

    if (!limpio.comentarios.length && !limpio.instruccion) {
        workspace.borrar(archivos.comentarios);
        workspace.borrar(archivos.feedback);
        try { fs.rmdirSync(archivos.carpeta); } catch (e) { /* algo quedó adentro: se queda */ }
        return limpio;
    }

    limpio.actualizado = new Date().toISOString();
    workspace.asegurarCarpeta(rutaVideo);
    workspace.writeJson(archivos.comentarios, limpio);
    workspace.writeAtomic(archivos.feedback, feedback.escribir(limpio, {
        rutaVideo,
        ...(contexto || {})
    }));
    return limpio;
}

/** El id que sigue: el mayor que se entregó alguna vez, más uno. */
function proximoId(datos) {
    const anterior = Array.isArray(datos)
        ? numeroDeId(datos, 0)
        : numeroDeId(datos.comentarios || [], datos.ultimoId);
    return `c${String(anterior + 1).padStart(2, '0')}`;
}

/**
 * Agrega un comentario y devuelve el estado nuevo entero.
 *
 * Devuelve todo y no solo el comentario a propósito: la ventana repinta con lo
 * que el disco dice ahora, no con lo que ella creía más lo que acaba de mandar.
 * Es la diferencia entre una lista que se desincroniza y una que no puede.
 */
function agregar(rutaVideo, comentario, contexto) {
    const actual = leer(rutaVideo, contexto && contexto.media);
    const nuevo = sanearComentario(
        { ...comentario, id: proximoId(actual) },
        actual.comentarios.length
    );
    return {
        datos: guardar(
            rutaVideo,
            { ...actual, ultimoId: actual.ultimoId + 1, comentarios: [...actual.comentarios, nuevo] },
            contexto
        ),
        id: nuevo.id
    };
}

/** Cambia lo que se le pase de un comentario; lo que no, queda. */
function editar(rutaVideo, id, cambios, contexto) {
    const actual = leer(rutaVideo, contexto && contexto.media);
    const comentarios = actual.comentarios.map(c => (
        c.id === id ? { ...c, ...cambios, id: c.id, modificado: new Date().toISOString() } : c
    ));
    return guardar(rutaVideo, { ...actual, comentarios }, contexto);
}

/**
 * Borra un comentario y, con él, sus PNG.
 *
 * Los PNG se borran porque son suyos y de nadie más: dejarlos haría crecer la
 * carpeta con cuadros que ya nadie nombra, y el editor que la abre no tendría
 * manera de saber cuáles sobran.
 */
function borrar(rutaVideo, id, contexto) {
    const actual = leer(rutaVideo, contexto && contexto.media);
    const victima = actual.comentarios.find(c => c.id === id);
    const archivos = workspace.archivosDeVersion(rutaVideo);

    for (const relativa of [victima && victima.frame, victima && victima.dibujo]) {
        if (!relativa) continue;
        const absoluta = path.join(archivos.carpeta, relativa);
        // La ruta sale del JSON, que es un archivo que alguien puede editar a
        // mano: antes de borrar se comprueba que caiga adentro de la carpeta.
        if (workspace.dentroDe(archivos.carpeta, absoluta)) workspace.borrar(absoluta);
    }

    return guardar(rutaVideo, {
        ...actual,
        comentarios: actual.comentarios.filter(c => c.id !== id)
    }, contexto);
}

/** La instrucción consolidada que escribe el botón «Preparar para Claude». */
function guardarInstruccion(rutaVideo, texto, modelo, contexto) {
    const actual = leer(rutaVideo, contexto && contexto.media);
    const limpio = String(texto || '').trim();
    return guardar(rutaVideo, {
        ...actual,
        instruccion: limpio ? { texto: limpio, modelo: modelo || null, creado: new Date().toISOString() } : null
    }, contexto);
}

function cuenta(datos) {
    const abiertos = datos.comentarios.filter(c => c.estado === 'abierto').length;
    return { total: datos.comentarios.length, abiertos, resueltos: datos.comentarios.length - abiertos };
}

module.exports = {
    VERSION_ARCHIVO,
    ESTADOS,
    vacio,
    sanear,
    sanearComentario,
    leer,
    guardar,
    proximoId,
    agregar,
    editar,
    borrar,
    guardarInstruccion,
    cuenta
};
