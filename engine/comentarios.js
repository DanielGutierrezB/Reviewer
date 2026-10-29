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

const adjuntosLib = require('./adjuntos');
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
        // Los archivos que el editor le colgó a este comentario. Array y no
        // `null` cuando está vacío: es una lista a la que se le agrega, y
        // tener que preguntar «¿existe?» antes de cada recorrido es cómo se
        // cuela el `undefined` que rompe el guardado en el peor momento.
        adjuntos: adjuntosLib.deComentario(c),
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
 * Todo lo que un comentario tiene en el disco: su cuadro, su dibujo y los
 * archivos que el editor le adjuntó.
 *
 * Se llamaba `imagenesDe` y miraba solo los dos PNG. Cambió de nombre al entrar
 * los adjuntos porque ahora acá adentro puede haber un PDF o un WAV, y un
 * nombre que diga «imágenes» invita a que el próximo que agregue un archivo a
 * un comentario se olvide de pasarlo por acá —y el precio de olvidarse es que
 * deshacer un borrado devuelva la tarjeta sin lo que traía—.
 */
function archivosDe(comentario) {
    return [
        comentario.frame,
        comentario.dibujo,
        ...(comentario.adjuntos || []).map(a => a.archivo)
    ].filter(Boolean);
}

/**
 * Escribe el JSON y, pegado, el markdown, y deja los archivos de la carpeta
 * como dice el estado nuevo: a `.papelera` lo que se fue, de vuelta lo que
 * volvió.
 *
 * **Es la única salida al disco de este módulo, y ese es el punto.** Eran dos:
 * esta, que no miraba los archivos, y una `aplicar` que reconciliaba contra la
 * papelera antes de llamarla. Ocho funciones tenían que acordarse de elegir la
 * correcta, y elegir mal no fallaba —dejaba un archivo huérfano en la carpeta
 * del editor, que se descubre meses después mirando el Finder—. Ya había
 * pasado: reemplazar el cuadro de un comentario va por `editar`, o sea por acá,
 * y el PNG viejo se quedaba suelto mientras el comentario de `aplicar` juraba
 * cubrir justo ese caso. Con la reconciliación adentro, la invariante «borrar
 * manda los archivos a la papelera» se sostiene porque no hay otro camino, y
 * una operación nueva solo tiene que decir cómo queda la versión.
 *
 * **Se comparan los archivos y no los comentarios.** Antes esto recorría los
 * ids: lo que desaparecía de la lista se iba a la papelera y lo que volvía a
 * aparecer se traía. Con los adjuntos eso dejó de alcanzar, porque un
 * comentario puede seguir estando en los dos lados y haber perdido un archivo
 * en el medio —quitar un adjunto es exactamente eso—, y por id ese archivo
 * quedaba suelto en la carpeta sin que nadie lo nombrara. Dos conjuntos de
 * rutas y su diferencia cubren los tres casos con la misma cuenta: el
 * comentario que se va, el adjunto que se quita y el cuadro que se reemplaza.
 * Y es lo que hace que «borrar» y «deshacer el borrado» sean la misma función
 * con los argumentos al revés, que es lo único que garantiza que deshacer
 * devuelva la tarjeta entera y no una a la que le falta el cuadro.
 *
 * **Los archivos se mueven antes de decidir si la versión quedó vacía.** Borrar
 * el último comentario es las dos cosas a la vez, y sus PNG tienen que llegar a
 * la papelera igual: si el orden fuera al revés, el único borrado que no se
 * puede deshacer sería el que deja el video sin comentarios.
 *
 * El `leer` de más no se paga en la práctica: todas las operaciones del módulo
 * ya arrancan leyendo, y la que reconciliaba leía dos veces.
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
    const previo = leer(rutaVideo, contexto && contexto.media);
    const limpio = sanear(datos, rutaVideo, contexto && contexto.media);

    const antes = new Set(previo.comentarios.flatMap(archivosDe));
    const despues = new Set(limpio.comentarios.flatMap(archivosDe));
    for (const relativa of antes) if (!despues.has(relativa)) workspace.aPapelera(rutaVideo, relativa);
    for (const relativa of despues) if (!antes.has(relativa)) workspace.dePapelera(rutaVideo, relativa);

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
 * El nombre con el que el deshacer pide lo mismo: «dejá la versión así».
 *
 * Es `guardar`, sin una línea propia. Está acá porque el canal
 * `comentarios-aplicar` —⌘Z y ⌘⇧Z— manda el `comentarios.json` entero de un
 * momento anterior, no un cambio, y «aplicar este estado» es lo que ese
 * llamador está pidiendo; el alias deja que el puente lo siga diciendo así.
 *
 * Lo que se fue no es el nombre sino la ELECCIÓN. Esto era una segunda función
 * que escribía al disco, y cada operación nueva tenía que acertar cuál de las
 * dos usar. **No volver a separarlas**: la que no reconciliaba es la que dejaba
 * PNG huérfanos, y el síntoma aparece meses después y en la carpeta del editor.
 */
const aplicar = guardar;

// ─── Adjuntos ─────────────────────────────────────────────────────────
//
// Las tres operaciones de acá abajo arman el estado nuevo y lo guardan, sin
// mirar el disco ni acordarse de la papelera: eso lo hace `guardar` por todas.
// Importa para `quitarAdjunto`, que es la que saca un archivo de un comentario
// que se queda: antes había que elegir a mano el camino que reconciliaba, o el
// archivo quedaba huérfano en la carpeta y deshacer lo nombraba sin poder
// traerlo.

/**
 * Cuelga archivos de un comentario que ya existe.
 *
 * El id tiene que existir: adjuntar a un comentario que no está no escribe
 * nada. Es la regla de «nada en el disco hasta que hay un comentario» vista
 * desde acá —la ventana guarda primero el comentario y adjunta después—, y sin
 * esta guarda un id viejo colgado en la ventana crearía la carpeta `adjuntos/`
 * al lado de un render sin comentarios.
 */
function adjuntar(rutaVideo, id, entradas, contexto) {
    const actual = leer(rutaVideo, contexto && contexto.media);
    const comentario = actual.comentarios.find(c => c.id === id);
    if (!comentario) return { datos: actual, puestos: [], fallados: [] };

    // Los nombres que el comentario ya tiene viajan al escritor para que el
    // nuevo no repita ninguno: el `nombre` es con lo que empareja la mención
    // del texto, así que dos iguales harían un token ambiguo.
    const { puestos, fallados } = adjuntosLib.escribir(
        rutaVideo, id, entradas, comentario.adjuntos.map(a => a.nombre)
    );
    if (!puestos.length) return { datos: actual, puestos, fallados };

    return {
        datos: guardar(rutaVideo, {
            ...actual,
            comentarios: actual.comentarios.map(c => (
                c.id === id
                    ? { ...c, adjuntos: [...c.adjuntos, ...puestos], modificado: new Date().toISOString() }
                    : c
            ))
        }, contexto),
        puestos,
        fallados
    };
}

/** Saca un adjunto de un comentario. El archivo va a la papelera, no al vacío. */
function quitarAdjunto(rutaVideo, id, archivo, contexto) {
    const actual = leer(rutaVideo, contexto && contexto.media);
    return guardar(rutaVideo, {
        ...actual,
        comentarios: actual.comentarios.map(c => (
            c.id === id ? { ...c, adjuntos: c.adjuntos.filter(a => a.archivo !== archivo) } : c
        ))
    }, contexto);
}

/** Cambia para qué sirve un adjunto: de mirarlo a usarlo, o al revés. */
function usarAdjunto(rutaVideo, id, archivo, uso, contexto) {
    const actual = leer(rutaVideo, contexto && contexto.media);
    return guardar(rutaVideo, {
        ...actual,
        comentarios: actual.comentarios.map(c => (
            c.id === id
                ? { ...c, adjuntos: c.adjuntos.map(a => (a.archivo === archivo ? { ...a, uso } : a)) }
                : c
        ))
    }, contexto);
}

/**
 * Borra un comentario. Sus PNG van a la papelera, no al vacío.
 *
 * Que no se borren de verdad es lo que hace que `Cmd+Z` devuelva el comentario
 * entero y no solo su texto. La papelera se tira al cambiar de versión, que es
 * cuando el historial deja de poder llegar hasta acá.
 */
function borrar(rutaVideo, id, contexto) {
    const actual = leer(rutaVideo, contexto && contexto.media);
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
    archivosDe,
    aplicar,
    adjuntar,
    quitarAdjunto,
    usarAdjunto,
    borrar,
    guardarInstruccion,
    cuenta
};
