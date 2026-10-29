'use strict';
/**
 * workspace.js — Dónde escribe Reviewer, que es al lado del render y en ningún
 * otro lado.
 *
 * El trato con el editor es que el feedback viaje con el video: si mañana le
 * pasa la carpeta a otra persona, o se la da a Claude, los comentarios están
 * ahí. Por eso no hay base de datos ni una carpeta de la app con todo adentro.
 *
 *   <carpeta de renders>/
 *     Clase 03 - Hooks v1.mp4
 *     Clase 03 - Hooks v2.mp4
 *     Clase 03 - Hooks v2/            ← la carpeta de ESA versión
 *       feedback.md                     lo que se le pasa a Claude
 *       comentarios.json                la fuente de verdad, que la app relee
 *       frames/                         el cuadro limpio de cada comentario
 *       dibujos/                        ese mismo cuadro con el trazo encima
 *     Reviewer/
 *       comentario-general.md           lo que aplica a TODAS las clases
 *       comentario-general.json
 *       _referencias/                   logos, manuales de marca, capturas
 *
 * **La carpeta de una versión no se crea hasta que hay algo que escribir.** Es
 * la regla que pidió el editor y acá está partida en dos funciones a propósito:
 * `carpetaDeVersion` solo arma la ruta y nunca crea, `asegurarCarpeta` crea.
 * Con una sola función que hiciera las dos cosas, abrir una carpeta para mirar
 * los renders dejaría treinta carpetas vacías al lado de treinta videos — que es
 * exactamente lo que el editor no quiere ver.
 *
 * Se escribe siempre a un temporal y se renombra: el `feedback.md` se reescribe
 * entero en cada tecla, así que un cierre a mitad de guardado tiene que dejar el
 * de antes y no medio archivo que Claude leería sin sospechar nada.
 */

const fs = require('fs');
const path = require('path');

/** La carpeta de la app dentro de la del editor: lo que es del curso entero. */
const GENERAL_DIR = 'Reviewer';
const REFERENCIAS_DIR = '_referencias';

const ARCHIVOS = {
    feedback: 'feedback.md',
    comentarios: 'comentarios.json',
    general: 'comentario-general.md',
    generalJson: 'comentario-general.json',
    manifiesto: 'referencias.json'
};

const FRAMES_DIR = 'frames';
const DIBUJOS_DIR = 'dibujos';

/**
 * Un nombre cualquiera → un nombre de archivo.
 *
 * El mismo `slugify` que usa HyperPremiere, y por el mismo motivo: los nombres
 * de clase traen acentos, barras y dos puntos, y de acá salen nombres de PNG
 * que después viajan escritos dentro de un markdown.
 */
function slug(texto) {
    const limpio = String(texto == null ? '' : texto)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return limpio || 'sin-nombre';
}

/**
 * La carpeta de una versión: al lado del archivo y con su mismo nombre.
 *
 * Con el mismo nombre y no con un sufijo propio porque es lo que el editor
 * pidió, y porque así la carpeta se ordena pegada a su video en el Finder.
 *
 * **No crea nada.** Ver la cabecera del archivo.
 */
function carpetaDeVersion(rutaVideo) {
    const dir = path.dirname(rutaVideo);
    const nombre = path.basename(rutaVideo, path.extname(rutaVideo));
    return path.join(dir, nombre);
}

function archivosDeVersion(rutaVideo) {
    const base = carpetaDeVersion(rutaVideo);
    return {
        carpeta: base,
        feedback: path.join(base, ARCHIVOS.feedback),
        comentarios: path.join(base, ARCHIVOS.comentarios),
        frames: path.join(base, FRAMES_DIR),
        dibujos: path.join(base, DIBUJOS_DIR)
    };
}

/** Crea la carpeta de una versión. Se llama al escribir, nunca al leer. */
function asegurarCarpeta(rutaVideo) {
    const archivos = archivosDeVersion(rutaVideo);
    ensureDir(archivos.carpeta);
    return archivos;
}

/** ¿Esta versión ya tiene trabajo hecho? Es lo que pinta la marca en la lista. */
function tieneComentarios(rutaVideo) {
    return fs.existsSync(archivosDeVersion(rutaVideo).comentarios);
}

// ─── Lo que es del curso entero ───────────────────────────────────────

function carpetaGeneral(raiz) {
    return path.join(raiz, GENERAL_DIR);
}

function archivosGenerales(raiz) {
    const base = carpetaGeneral(raiz);
    return {
        carpeta: base,
        md: path.join(base, ARCHIVOS.general),
        json: path.join(base, ARCHIVOS.generalJson),
        referencias: path.join(base, REFERENCIAS_DIR),
        manifiesto: path.join(base, REFERENCIAS_DIR, ARCHIVOS.manifiesto)
    };
}

// ─── Disco ────────────────────────────────────────────────────────────

/**
 * Si una ruta cae de verdad adentro de una carpeta.
 *
 * Se usa antes de cada escritura y de cada borrado. Los nombres de clase y de
 * referencia los tipea el editor y viajan por el puente desde la ventana; entre
 * "no debería" y "no puede" hay un `path.resolve`, y del otro lado hay archivos
 * que se borran.
 *
 * Se compara resuelto y con el separador pegado: sin él, `/tmp/renders-viejos`
 * pasaría por estar adentro de `/tmp/renders`.
 */
function dentroDe(base, ruta) {
    const raiz = path.resolve(base);
    const donde = path.resolve(ruta);
    return donde === raiz || donde.startsWith(raiz + path.sep);
}

function ensureDir(dir) {
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

/**
 * Escritura atómica: primero un temporal al lado (mismo volumen, para que el
 * rename sea instantáneo y no una copia), después el rename.
 */
function writeAtomic(filePath, contents) {
    ensureDir(path.dirname(filePath));
    const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tmp, contents);
    fs.renameSync(tmp, filePath);
    return filePath;
}

function writeJson(filePath, value) {
    return writeAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function readJson(filePath) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (e) {
        return null;
    }
}

/** Borra un archivo si está. Que no esté no es un error: es el estado que se quería. */
function borrar(filePath) {
    try {
        fs.unlinkSync(filePath);
        return true;
    } catch (e) {
        return false;
    }
}

module.exports = {
    GENERAL_DIR,
    REFERENCIAS_DIR,
    ARCHIVOS,
    FRAMES_DIR,
    DIBUJOS_DIR,
    slug,
    carpetaDeVersion,
    archivosDeVersion,
    asegurarCarpeta,
    tieneComentarios,
    carpetaGeneral,
    archivosGenerales,
    dentroDe,
    ensureDir,
    writeAtomic,
    writeJson,
    readJson,
    borrar
};
