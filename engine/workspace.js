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
 * Los archivos que el editor le colgó a un comentario: la imagen pegada, el
 * logo que va en el video, la pista de música.
 *
 * Acá y no en `Reviewer/_referencias/` —donde viven los del curso entero—
 * porque esto pertenece a UN comentario de UNA versión: tiene que viajar con su
 * carpeta, y tiene que irse a la papelera cuando ese comentario se borra. Ver
 * la cabecera de `engine/adjuntos.js`, donde está la decisión completa.
 */
const ADJUNTOS_DIR = 'adjuntos';

/**
 * Donde esperan los PNG de un comentario borrado hasta que se cierre la versión.
 *
 * Borrar un comentario tiene que poder deshacerse, y el texto solo no alcanza:
 * el cuadro y el dibujo son la mitad de lo que decía. Si se borraran del disco,
 * «deshacer» devolvería una tarjeta sin sus imágenes —peor que no deshacer
 * nada, porque parecería que volvió entero.
 *
 * Empieza con punto para que el Finder no la muestre: no es trabajo del editor,
 * es la red del deshacer. Se vacía al cambiar de versión y al cerrar la app.
 */
const PAPELERA_DIR = '.papelera';

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
        dibujos: path.join(base, DIBUJOS_DIR),
        adjuntos: path.join(base, ADJUNTOS_DIR),
        papelera: path.join(base, PAPELERA_DIR)
    };
}

/**
 * Lleva un archivo a la papelera de su versión. `dePapelera` lo trae de vuelta.
 *
 * Adentro se guarda con la ruta relativa aplanada (`frames_c01.png`), así que
 * un cuadro y un dibujo del mismo comentario no se pisan y volver es poner la
 * ruta original de nuevo.
 *
 * Devuelve `true` solo si de verdad se movió algo: quien llama repinta con lo
 * que el disco tiene, no con lo que pidió.
 */
function aPapelera(rutaVideo, relativa) {
    const archivos = archivosDeVersion(rutaVideo);
    const origen = path.join(archivos.carpeta, relativa);
    if (!dentroDe(archivos.carpeta, origen) || !fs.existsSync(origen)) return false;
    ensureDir(archivos.papelera);
    fs.renameSync(origen, path.join(archivos.papelera, relativa.split(path.sep).join('_')));
    return true;
}

/**
 * Lo trae de vuelta, **salvo que ya haya algo con ese nombre en la carpeta**.
 *
 * La guarda importa porque los nombres de archivo se reciclan: el del disco lo
 * elige `nombreLibre`, que mira qué hay en la carpeta, y lo que está en la
 * papelera no está en la carpeta. Entonces quitar `c01-logo.png` y adjuntar
 * otro logo distinto con el mismo nombre deja dos archivos que se llaman igual
 * en dos lugares, y «traer de vuelta» pisaría el que el editor acaba de poner
 * con el que había sacado. No falla: el adjunto se llama como el nuevo y por
 * dentro es el viejo, que es la clase de error que solo se ve en el render.
 *
 * Si el archivo ya está donde tiene que estar no hay nada que devolver, así que
 * `false` es la respuesta correcta y no una excepción.
 */
function dePapelera(rutaVideo, relativa) {
    const archivos = archivosDeVersion(rutaVideo);
    const guardado = path.join(archivos.papelera, relativa.split(path.sep).join('_'));
    const destino = path.join(archivos.carpeta, relativa);
    if (!dentroDe(archivos.carpeta, destino) || !fs.existsSync(guardado)) return false;
    if (fs.existsSync(destino)) return false;
    ensureDir(path.dirname(destino));
    fs.renameSync(guardado, destino);
    return true;
}

/** Tira la papelera de una versión. Se llama al soltar el historial, no antes. */
function vaciarPapelera(rutaVideo) {
    try {
        fs.rmSync(archivosDeVersion(rutaVideo).papelera, { recursive: true, force: true });
    } catch (e) { /* no estaba, que es el estado que se quería */ }
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
    ADJUNTOS_DIR,
    PAPELERA_DIR,
    slug,
    aPapelera,
    dePapelera,
    vaciarPapelera,
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
