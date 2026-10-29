'use strict';
/**
 * referencias.js — Los archivos que el editor adjunta para que Claude los mire:
 * un logo, un manual de marca, la captura de una referencia que le gustó.
 *
 * Viven en `Reviewer/_referencias/` con un manifiesto al lado, igual que en
 * HyperPremiere, y el manifiesto no es redundante: de cada archivo hay que
 * saber tres cosas que un archivo suelto no dice —en qué **orden** va (el
 * feedback las numera *imagen 1, imagen 2…* y el editor las nombra así en sus
 * comentarios), si es imagen o documento, y si viaja o si está nada más que
 * guardada—.
 *
 * **La carpeta manda sobre el manifiesto** en lo único que puede: un archivo
 * que el manifiesto nombra y no está se muestra como faltante, con su motivo
 * (el disco externo desmontado es el caso), en vez de desaparecer de una lista
 * más corta y sin explicación; y un archivo que alguien soltó ahí desde el
 * Finder se adopta al final. La carpeta viaja con el curso: que se vea lo que
 * hay adentro es parte del trato.
 */

const fs = require('fs');
const path = require('path');

const workspace = require('./workspace');

const VERSION_MANIFIESTO = 1;

const TIPOS = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.pdf': 'application/pdf',
    '.md': 'text/markdown',
    '.txt': 'text/plain',
    '.json': 'application/json',
    '.csv': 'text/csv'
};

const RE_IMAGEN = /\.(png|jpe?g|webp|gif)$/i;

function tipoDe(nombre) {
    return TIPOS[path.extname(nombre).toLowerCase()] || 'application/octet-stream';
}

function claseDe(nombre) {
    return RE_IMAGEN.test(nombre) ? 'imagen' : 'documento';
}

/**
 * Un nombre de archivo que no pise a otro.
 *
 * Dos capturas que se llaman `captura.png` son dos referencias distintas y la
 * segunda no puede reemplazar a la primera en silencio: el comentario que
 * nombraba a la primera pasaría a hablar de otra imagen.
 */
function nombreLibre(dir, deseado) {
    const base = path.basename(deseado).replace(/[/\\:]/g, '-').replace(/^\.+/, '') || 'referencia';
    if (!fs.existsSync(path.join(dir, base))) return base;
    const ext = path.extname(base);
    const sinExt = base.slice(0, base.length - ext.length);
    for (let i = 2; i < 500; i++) {
        const prueba = `${sinExt}-${i}${ext}`;
        if (!fs.existsSync(path.join(dir, prueba))) return prueba;
    }
    return `${sinExt}-${Date.now()}${ext}`;
}

function leerManifiesto(raiz) {
    const archivos = workspace.archivosGenerales(raiz);
    const crudo = workspace.readJson(archivos.manifiesto);
    const items = crudo && Array.isArray(crudo.items) ? crudo.items : [];
    return items
        .filter(i => i && typeof i.file === 'string' && i.file)
        .map(i => ({
            file: path.basename(i.file),
            name: typeof i.name === 'string' && i.name ? i.name : path.basename(i.file),
            mediaType: typeof i.mediaType === 'string' ? i.mediaType : tipoDe(i.file)
        }));
}

function guardarManifiesto(raiz, items) {
    const archivos = workspace.archivosGenerales(raiz);
    if (!items.length) {
        workspace.borrar(archivos.manifiesto);
        try { fs.rmdirSync(archivos.referencias); } catch (e) { /* algo quedó: se queda */ }
        return;
    }
    workspace.ensureDir(archivos.referencias);
    workspace.writeJson(archivos.manifiesto, {
        version: VERSION_MANIFIESTO,
        items: items.map(i => ({ file: i.file, name: i.name, mediaType: i.mediaType }))
    });
}

/**
 * Las referencias de un curso, numeradas y resueltas contra el disco.
 *
 * Las imágenes se numeran de 1 en adelante **contando solo las que están**: una
 * que falta no puede quedarse con el número 2 y dejar un hueco, porque el
 * feedback dice "van 3 imágenes, numeradas de 1 a 3" y tiene que ser cierto.
 */
function listar(raiz) {
    const archivos = workspace.archivosGenerales(raiz);
    const manifiesto = leerManifiesto(raiz);

    let enDisco = [];
    try {
        enDisco = fs.readdirSync(archivos.referencias)
            .filter(n => !n.startsWith('.') && n !== workspace.ARCHIVOS.manifiesto);
    } catch (e) { /* no hay carpeta todavía */ }

    const nombrados = new Set(manifiesto.map(i => i.file));
    const adoptadas = enDisco
        .filter(n => !nombrados.has(n))
        .sort((a, b) => a.localeCompare(b, 'es', { numeric: true }))
        .map(n => ({ file: n, name: n, mediaType: tipoDe(n), adoptada: true }));

    let numero = 0;
    return [...manifiesto, ...adoptadas].map(item => {
        const ruta = path.join(archivos.referencias, item.file);
        const falta = !fs.existsSync(ruta);
        const tipo = claseDe(item.file);
        if (!falta && tipo === 'imagen') numero++;
        return {
            ambito: 'curso',
            file: item.file,
            nombre: item.name,
            mediaType: item.mediaType,
            tipo,
            ruta,
            falta,
            adoptada: Boolean(item.adoptada),
            numero: !falta && tipo === 'imagen' ? numero : null,
            // La mención tal como se escribe en un comentario. Va calculada acá
            // y no en la ventana para que el chip que se inserta y el token que
            // el feedback resuelve salgan del mismo lugar.
            token: `@[curso/${item.name}]`
        };
    });
}

/** Las que de verdad viajan al feedback: las que están. */
function paraFeedback(raiz) {
    return listar(raiz)
        .filter(r => !r.falta)
        .map(r => ({ ambito: r.ambito, nombre: r.nombre, numero: r.numero, tipo: r.tipo, ruta: r.ruta }));
}

/**
 * Guarda un archivo como referencia del curso.
 *
 * @param {string} raiz
 * @param {{nombre:string, bytes?:Buffer, origen?:string}} entrada
 */
function agregar(raiz, entrada) {
    const archivos = workspace.archivosGenerales(raiz);
    workspace.ensureDir(archivos.referencias);

    const deseado = entrada.nombre || (entrada.origen ? path.basename(entrada.origen) : 'referencia');
    const file = nombreLibre(archivos.referencias, deseado);
    const destino = path.join(archivos.referencias, file);
    if (!workspace.dentroDe(archivos.referencias, destino)) {
        throw new Error('Esa referencia cae fuera de la carpeta.');
    }

    if (entrada.bytes) {
        workspace.writeAtomic(destino, Buffer.isBuffer(entrada.bytes) ? entrada.bytes : Buffer.from(entrada.bytes));
    } else if (entrada.origen) {
        // Se COPIA y no se enlaza: la carpeta tiene que poder viajar entera. Un
        // alias a un archivo del Escritorio del editor es una referencia que
        // funciona hasta que alguien abre la carpeta en otra máquina.
        fs.copyFileSync(entrada.origen, destino);
    } else {
        throw new Error('No vino ni el archivo ni su contenido.');
    }

    const items = leerManifiesto(raiz);
    items.push({ file, name: file, mediaType: tipoDe(file) });
    guardarManifiesto(raiz, items);
    return listar(raiz);
}

/** Quita una referencia: del manifiesto y del disco. */
function quitar(raiz, file) {
    const archivos = workspace.archivosGenerales(raiz);
    const destino = path.join(archivos.referencias, path.basename(file));
    if (workspace.dentroDe(archivos.referencias, destino)) workspace.borrar(destino);
    guardarManifiesto(raiz, leerManifiesto(raiz).filter(i => i.file !== path.basename(file)));
    return listar(raiz);
}

module.exports = {
    VERSION_MANIFIESTO,
    TIPOS,
    tipoDe,
    claseDe,
    nombreLibre,
    leerManifiesto,
    guardarManifiesto,
    listar,
    paraFeedback,
    agregar,
    quitar
};
