'use strict';
/**
 * frameio-vinculo.js — Qué carpeta de Frame.io es este curso, y qué archivo de
 * allá es cada render de acá.
 *
 * Vive en `Reviewer/frameio.json`, al lado del comentario general, porque es
 * del curso entero y no de una versión. Guarda dos cosas:
 *
 * 1. **La ruta vinculada**: cuenta, workspace, proyecto y carpeta de Frame.io
 *    donde van los renders de este curso. Se elige una vez.
 * 2. **El vínculo de cada render**: su `fileId` y, si está apilado, su
 *    `pilaId`. Es lo que hace que los comentarios lleguen a la versión exacta
 *    en vez de adivinarse por el nombre, y lo que evita subir dos veces lo
 *    mismo.
 *
 * **Se guarda por nombre de archivo, no por ruta.** Archivar la v2 en
 * `Pre versions/` le cambia la ruta y no el nombre, y su vínculo con Frame.io
 * tiene que sobrevivir a eso: los comentarios de la v2 siguen llegando a la v2
 * aunque esté archivada. Los nombres no se repiten dentro de un curso —archivar
 * es mover, no copiar—, así que alcanzan como clave.
 *
 * **Solo ids, nunca rutas absolutas.** La carpeta de renders se copia, se manda
 * por Drive y se abre en otra Mac con otro nombre de usuario. Un archivo con
 * `/Users/daniel/...` adentro apuntaría a ningún lado; con ids, el vínculo
 * viaja con la carpeta y sigue sirviendo.
 *
 * Acá no se habla con Frame.io ni se escribe nada que no sea este JSON: las
 * llamadas son de `frameio.js` y las colas de `main/frameio.js`.
 */

const path = require('path');

const workspace = require('./workspace');

const ARCHIVO = 'frameio.json';
const VERSION_ARCHIVO = 1;

/** En qué anda la subida de un render. */
const ESTADOS = ['pendiente', 'subiendo', 'subido', 'error'];

function rutaDel(raiz) {
    return path.join(workspace.carpetaGeneral(raiz), ARCHIVO);
}

function textoCorto(valor) {
    return typeof valor === 'string' && valor.trim() ? valor.trim() : null;
}

/**
 * La ruta vinculada, saneada.
 *
 * Los nombres se guardan junto a los ids para poder mostrar «Curso NemoClaw /
 * Entregas» sin salir a preguntar. Si en Frame.io los renombran, el vínculo
 * sigue valiendo —manda el id— y el nombre se corrige en la próxima lectura.
 */
function sanearRuta(crudo) {
    const r = crudo || {};
    if (!textoCorto(r.cuenta) || !textoCorto(r.carpeta)) return null;
    return {
        cuenta: textoCorto(r.cuenta),
        cuentaNombre: textoCorto(r.cuentaNombre),
        workspace: textoCorto(r.workspace),
        workspaceNombre: textoCorto(r.workspaceNombre),
        proyecto: textoCorto(r.proyecto),
        proyectoNombre: textoCorto(r.proyectoNombre),
        carpeta: textoCorto(r.carpeta),
        carpetaNombre: textoCorto(r.carpetaNombre)
    };
}

/** Cómo se lee la ruta vinculada en la ventana. */
function caminoDe(ruta) {
    if (!ruta) return '';
    return [ruta.workspaceNombre, ruta.proyectoNombre, ruta.carpetaNombre].filter(Boolean).join(' / ');
}

function sanearRender(crudo) {
    const r = crudo || {};
    const fileId = textoCorto(r.fileId);
    return {
        fileId,
        pilaId: textoCorto(r.pilaId),
        vista: textoCorto(r.vista),
        // Sin `fileId` no está en Frame.io, diga lo que diga el estado
        // guardado: una subida que se cortó al cerrar la app queda en
        // `subiendo` para siempre y pareceria estar en curso al abrir.
        estado: fileId ? (ESTADOS.includes(r.estado) && r.estado !== 'subiendo' ? r.estado : 'subido') : 'pendiente',
        error: textoCorto(r.error),
        subido: textoCorto(r.subido),
        // Hasta cuándo se leyeron los comentarios de este archivo, para no
        // repetir trabajo ni perder cambios entre dos consultas.
        comentariosAl: textoCorto(r.comentariosAl)
    };
}

function sanear(crudo) {
    const c = crudo && typeof crudo === 'object' ? crudo : {};
    const renders = {};
    for (const [nombre, valor] of Object.entries(c.renders || {})) {
        if (!textoCorto(nombre)) continue;
        const limpio = sanearRender(valor);
        // Un render sin `fileId` no es un vínculo: es basura de un intento que
        // no llegó a nada, y guardarlo haría que no se vuelva a subir.
        if (limpio.fileId) renders[nombre] = limpio;
    }
    return {
        version: VERSION_ARCHIVO,
        ruta: sanearRuta(c.ruta),
        // Prendido al vincular: vincular una carpeta ES decir «lo que entregue
        // Claude va acá». Se puede apagar por curso.
        subirSolo: c.subirSolo !== false,
        renders,
        actualizado: textoCorto(c.actualizado)
    };
}

function leer(raiz) {
    return sanear(workspace.readJson(rutaDel(raiz)));
}

function guardar(raiz, estado) {
    const limpio = sanear(estado);
    // Sin ruta vinculada y sin ningún render, el archivo no dice nada: se
    // borra, igual que un `comentarios.json` sin comentarios.
    if (!limpio.ruta && !Object.keys(limpio.renders).length) {
        workspace.borrar(rutaDel(raiz));
        return limpio;
    }
    limpio.actualizado = new Date().toISOString();
    workspace.ensureDir(workspace.carpetaGeneral(raiz));
    workspace.writeJson(rutaDel(raiz), limpio);
    return limpio;
}

/** Vincula el curso a una carpeta de Frame.io. Los renders ya vinculados se quedan. */
function vincular(raiz, ruta) {
    const actual = leer(raiz);
    const nueva = sanearRuta(ruta);
    if (!nueva) throw new Error('Esa ruta de Frame.io está incompleta.');
    // Cambiar de carpeta invalida los vínculos: los archivos de la carpeta
    // vieja no están en la nueva, y dejarlos haría que Reviewer pida
    // comentarios de archivos que no corresponden a este curso.
    const mismaCarpeta = actual.ruta && actual.ruta.carpeta === nueva.carpeta;
    return guardar(raiz, { ...actual, ruta: nueva, renders: mismaCarpeta ? actual.renders : {} });
}

function desvincular(raiz) {
    return guardar(raiz, { ruta: null, subirSolo: true, renders: {} });
}

/** Enciende o apaga la subida automática de este curso. */
function subirSolo(raiz, si) {
    return guardar(raiz, { ...leer(raiz), subirSolo: Boolean(si) });
}

/** Anota lo que pasó con un render: subido, con su id, o fallado con su motivo. */
function anotarRender(raiz, archivo, cambios) {
    const actual = leer(raiz);
    const previo = actual.renders[archivo] || {};
    return guardar(raiz, {
        ...actual,
        renders: { ...actual.renders, [archivo]: { ...previo, ...cambios } }
    });
}

/** De qué archivo de Frame.io es esta versión, o `null`. */
function deVersion(estado, version) {
    return (estado.renders || {})[version.archivo] || null;
}

/**
 * Qué hay que hacer para que una versión esté en Frame.io.
 *
 * Se calcula ANTES de subir y no después, y por eso devuelve también cómo
 * apilar: una vez subido, el archivo nuevo ya figura entre los hermanos y la
 * cuenta daría otra cosa.
 *
 * Las tres formas, que son las tres etapas de la vida de una clase en Frame.io:
 *
 *   suelto  es la primera versión que sube: va a la carpeta y nada más.
 *   crear   ya hay hermanos sueltos: se arma la pila con todos, del más viejo
 *           al más nuevo, que es el orden que pide la API.
 *   mover   ya hay pila: la versión nueva se mueve adentro y queda arriba.
 *
 * El caso `crear` con más de un hermano no es teórico: si una vez falló el
 * armado de la pila, quedan dos sueltos, y la próxima entrega tiene que juntar
 * los tres en vez de dejar el desorden crecer.
 *
 * @param {object} estado  lo leído de `frameio.json`
 * @param {object} clase   una clase del escaneo, con sus `versiones`
 * @param {object} version la versión que se quiere subir
 */
function plan(estado, clase, version) {
    const ya = deVersion(estado, version);
    if (ya && ya.fileId) return { subir: false, apilar: null, fileId: ya.fileId };

    const hermanos = (clase.versiones || [])
        .filter(v => v.archivo !== version.archivo && !v.edicion)
        .map(v => ({ v, enlace: deVersion(estado, v) }))
        .filter(x => x.enlace && x.enlace.fileId)
        .sort((a, b) => a.v.n - b.v.n);

    const conPila = hermanos.find(x => x.enlace.pilaId);
    if (conPila) return { subir: true, apilar: { tipo: 'mover', pilaId: conPila.enlace.pilaId } };
    if (hermanos.length) {
        return {
            subir: true,
            apilar: {
                tipo: 'crear',
                // Del más viejo al más nuevo: así la API deja la versión nueva
                // arriba de la pila, que es la que se abre al entrar.
                fileIds: hermanos.map(x => x.enlace.fileId),
                archivos: hermanos.map(x => x.v.archivo)
            }
        };
    }
    return { subir: true, apilar: { tipo: 'suelto' } };
}

/**
 * Las versiones de un curso que todavía no están en Frame.io.
 *
 * Las ediciones quedan afuera: una edición es un `edit.json` con proxies al
 * lado, no un video que se pueda subir. Las archivadas también: si no se
 * subieron en su momento, subirlas ahora las dejaría arriba de la pila, como si
 * fueran lo último entregado.
 */
function faltan(estado, clases) {
    const salida = [];
    for (const clase of clases || []) {
        for (const version of clase.versiones || []) {
            if (version.edicion || version.archivada) continue;
            const ya = deVersion(estado, version);
            if (!ya || !ya.fileId) salida.push({ clase, version });
        }
    }
    return salida;
}

/**
 * Empareja por nombre lo que ya estaba en Frame.io, subido a mano.
 *
 * Es el único lugar donde se adivina, y se adivina de la forma más estricta
 * posible: el nombre del archivo tiene que ser idéntico. Emparejar por
 * parecido —sin extensión, sin mayúsculas, por la clase— es cómo un comentario
 * de la v2 termina en la v3.
 *
 * Recibe la lista ya aplanada para que esto siga siendo puro: quien recorre
 * carpetas y pilas es `main/frameio.js`.
 *
 * @param {object} estado
 * @param {object[]} clases
 * @param {{id: string, nombre: string, pilaId?: string, vista?: string}[]} enFrameio
 * @returns {{emparejados: object[], sinEmparejar: object[], huerfanos: object[]}}
 */
function emparejar(estado, clases, enFrameio) {
    const locales = new Map();
    for (const clase of clases || []) {
        for (const version of clase.versiones || []) {
            if (!version.edicion) locales.set(version.archivo, { clase, version });
        }
    }
    const yaVinculados = new Set(Object.values(estado.renders || {}).map(r => r.fileId));

    const emparejados = [];
    const huerfanos = [];
    for (const remoto of enFrameio || []) {
        const local = locales.get(remoto.nombre);
        if (!local) {
            // En Frame.io y no acá: lo subió otro, o es de otra cosa. No se
            // toca; se lista para que el editor lo empareje a mano si quiere.
            huerfanos.push(remoto);
            continue;
        }
        const enlace = deVersion(estado, local.version);
        if (enlace && enlace.fileId === remoto.id) continue;
        if (enlace && enlace.fileId) continue;
        if (yaVinculados.has(remoto.id)) continue;
        emparejados.push({ archivo: remoto.nombre, fileId: remoto.id, pilaId: remoto.pilaId || null, vista: remoto.vista || null });
    }

    const sinEmparejar = [...locales.values()]
        .filter(({ version }) => {
            const enlace = deVersion(estado, version);
            return (!enlace || !enlace.fileId) && !emparejados.some(e => e.archivo === version.archivo);
        })
        .map(({ clase, version }) => ({ clase: clase.nombre, archivo: version.archivo, etiqueta: version.etiqueta }));

    return { emparejados, sinEmparejar, huerfanos };
}

/** Aplica de una sola vez lo que `emparejar` encontró. */
function aplicarEmparejados(raiz, emparejados) {
    const actual = leer(raiz);
    const renders = { ...actual.renders };
    for (const e of emparejados) {
        renders[e.archivo] = {
            ...(renders[e.archivo] || {}),
            fileId: e.fileId,
            pilaId: e.pilaId || null,
            vista: e.vista || null,
            estado: 'subido'
        };
    }
    return guardar(raiz, { ...actual, renders });
}

/** Los archivos de Frame.io que hay que consultar, con la versión de cada uno. */
function paraTraer(estado, clases) {
    const salida = [];
    for (const clase of clases || []) {
        for (const version of clase.versiones || []) {
            const enlace = deVersion(estado, version);
            if (enlace && enlace.fileId) salida.push({ clase, version, fileId: enlace.fileId });
        }
    }
    return salida;
}

module.exports = {
    ARCHIVO,
    caminoDe,
    leer,
    vincular,
    desvincular,
    subirSolo,
    anotarRender,
    deVersion,
    plan,
    faltan,
    emparejar,
    aplicarEmparejados,
    paraTraer
};
