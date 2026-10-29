'use strict';
/**
 * exportar.js — Todo el feedback del curso en una carpeta sola, para pasársela
 * a Claude de una vez.
 *
 * Hasta acá cada versión tenía su `feedback.md` al lado del render, que es lo
 * correcto mientras se revisa: el feedback viaja con el video y no hay una base
 * de datos que se pueda desincronizar. Pero para entregar el trabajo eso son
 * veintitrés archivos repartidos en veintitrés carpetas, y señalárselos uno por
 * uno al agente es donde se pierden tres.
 *
 * Lo que arma esto es un producto, no un lugar de trabajo:
 *
 *   <raíz>/Feedback/
 *     FEEDBACK.md        el curso entero, en orden
 *     imagenes/          los cuadros y los dibujos
 *     adjuntos/          lo que el editor colgó de cada comentario
 *     _referencias/      logos y manuales del curso
 *
 * Tres decisiones:
 *
 * 1. **Se reemplaza entera cada vez.** Lo que hay adentro es siempre lo de la
 *    última exportación. Una carpeta que acumula es una carpeta donde hay un
 *    cuadro de un comentario que ya se borró, y el que la lee no tiene cómo
 *    saber cuál sobra.
 * 2. **Se copian los archivos adentro.** Pesa más, pero la carpeta se vale por
 *    sí sola: se puede mandar, guardar como registro de lo que se pidió, o
 *    abrir dentro de un mes cuando los cuadros originales ya se borraron con
 *    su comentario.
 * 3. **Las rutas que se escriben son absolutas**, como en `feedback.js` y por
 *    la misma razón aprendida: el agente no indexa la carpeta donde está
 *    parado, y una ruta relativa es una ruta que no va a abrir.
 *
 * Solo van los comentarios abiertos. Es la lista de lo que hay que hacer; un
 * resuelto ya está hecho y ocupa lugar en lo que el modelo lee.
 */

const fs = require('fs');
const path = require('path');

const adjuntos = require('./adjuntos');
const comentariosLib = require('./comentarios');
const feedback = require('./feedback');
const generalLib = require('./general');
const menciones = require('./menciones');
const workspace = require('./workspace');

const DOCUMENTO = 'FEEDBACK.md';
const IMAGENES_DIR = 'imagenes';
const ADJUNTOS_DIR = 'adjuntos';

/**
 * Deja la carpeta de destino vacía y lista.
 *
 * Se niega a borrar una carpeta `Feedback` que no haya hecho Reviewer. Es
 * barato y evita el único accidente caro de todo esto: alguien que ya tenía
 * una carpeta con ese nombre y sus cosas adentro.
 */
function preparar(destino) {
    if (fs.existsSync(destino)) {
        const mia = fs.existsSync(path.join(destino, DOCUMENTO));
        const vacia = (() => {
            try { return fs.readdirSync(destino).length === 0; } catch (e) { return false; }
        })();
        if (!mia && !vacia) {
            return { ok: false, error: `Ya hay una carpeta «${workspace.EXPORTACION_DIR}» con cosas adentro que no son de Reviewer. Movela o cambiale el nombre y volvé a exportar.` };
        }
        fs.rmSync(destino, { recursive: true, force: true });
    }
    workspace.ensureDir(destino);
    return { ok: true };
}

/** Un nombre de archivo que no pise a otro dentro de la misma carpeta. */
function libre(carpeta, nombre) {
    const ext = path.extname(nombre);
    const base = path.basename(nombre, ext);
    let intento = nombre;
    let n = 2;
    while (fs.existsSync(path.join(carpeta, intento))) {
        intento = `${base}-${n}${ext}`;
        n++;
    }
    return path.join(carpeta, intento);
}

/**
 * Las versiones que tienen algo por hacer, en el orden de la lista de clases.
 *
 * Por versión y no por clase: si quedaron comentarios abiertos en la v1 y
 * Claude ya entregó la v3, esos pedidos siguen sin estar hechos y entran
 * igual. Lo que se hace es decirlo —`vieja`—, porque leerlos sin saber que son
 * de dos versiones atrás lleva a rehacer algo que ya se rehizo.
 */
function recolectar(clases) {
    const partes = [];
    for (const clase of clases) {
        const ultima = clase.versiones[clase.versiones.length - 1];
        for (const version of clase.versiones) {
            const datos = comentariosLib.leer(version.ruta, version.media);
            const abiertos = datos.comentarios.filter(c => c.estado === 'abierto');
            if (!abiertos.length) continue;
            partes.push({
                clase,
                version,
                datos,
                abiertos,
                vieja: ultima && version.ruta !== ultima.ruta ? ultima.n : null
            });
        }
    }
    return partes;
}

/**
 * Copia los archivos de un comentario y devuelve dónde quedó cada uno.
 *
 * Los nombres llevan clase, versión y id adelante porque acá se mezclan los
 * archivos de todas las clases en dos carpetas: tres comentarios distintos
 * pueden tener un `c01-00h00m12s00f.png` y sin el prefijo se pisarían.
 */
function copiarDe(parte, comentario, destino) {
    const carpeta = workspace.carpetaDeVersion(parte.version.ruta);
    const prefijo = `${workspace.slug(parte.clase.nombre)}-v${parte.version.n}-${comentario.id}`;

    const salida = [];
    for (const archivo of feedback.archivosDe(comentario, carpeta)) {
        if (!fs.existsSync(archivo.ruta)) continue;

        const esAdjunto = archivo.origen === 'adjunto';
        const sub = path.join(destino, esAdjunto ? ADJUNTOS_DIR : IMAGENES_DIR);
        workspace.ensureDir(sub);

        const nombre = esAdjunto
            ? `${prefijo}-${archivo.nombre || path.basename(archivo.ruta)}`
            : `${prefijo}-${archivo.origen}${path.extname(archivo.ruta)}`;

        const copia = libre(sub, nombre);
        fs.copyFileSync(archivo.ruta, copia);
        salida.push({ ...archivo, original: archivo.ruta, ruta: copia });
    }
    return salida;
}

/** Las referencias del curso, copiadas adentro de la exportación. */
function copiarReferencias(raiz, destino) {
    const sub = path.join(destino, workspace.REFERENCIAS_DIR);
    const salida = [];
    for (const ref of generalLib.leer(raiz).referencias) {
        if (ref.falta || !fs.existsSync(ref.ruta)) continue;
        workspace.ensureDir(sub);
        const copia = libre(sub, path.basename(ref.ruta));
        fs.copyFileSync(ref.ruta, copia);
        salida.push({ ...ref, ruta: copia });
    }
    return salida;
}

/**
 * Arma la carpeta `Feedback/` del curso.
 *
 * @param {string} raiz la carpeta de renders
 * @param {Array} clases lo que devolvió `versiones.escanear`
 * @param {{soloClase?: string}} opciones el id de una clase, para mandar una sola
 */
function exportar(raiz, clases, opciones) {
    const soloClase = (opciones || {}).soloClase || null;
    const elegidas = soloClase ? clases.filter(c => c.id === soloClase) : clases;

    const partes = recolectar(elegidas);
    if (!partes.length) {
        return {
            ok: false,
            error: soloClase
                ? 'Esa clase no tiene comentarios por hacer.'
                : 'No hay ningún comentario por hacer para exportar.'
        };
    }

    const destino = path.join(raiz, workspace.EXPORTACION_DIR);
    const listo = preparar(destino);
    if (!listo.ok) return listo;

    const referencias = copiarReferencias(raiz, destino);
    const general = generalLib.leer(raiz);

    // Se copia todo primero y se escribe después: el documento nombra las
    // rutas de las copias, así que tienen que existir antes de nombrarlas.
    for (const parte of partes) {
        parte.archivos = new Map(parte.abiertos.map(c => [c.id, copiarDe(parte, c, destino)]));
    }

    const texto = documento({ raiz, destino, partes, general, referencias, soloClase });
    fs.writeFileSync(path.join(destino, DOCUMENTO), texto, 'utf8');

    return {
        ok: true,
        carpeta: destino,
        documento: path.join(destino, DOCUMENTO),
        clases: new Set(partes.map(p => p.clase.id)).size,
        comentarios: partes.reduce((n, p) => n + p.abiertos.length, 0),
        archivos: partes.reduce((n, p) => n + [...p.archivos.values()].reduce((m, a) => m + a.length, 0), 0)
            + referencias.length,
        viejas: partes.filter(p => p.vieja).map(p => `${p.clase.nombre} v${p.version.n}`)
    };
}

/** El markdown entero. */
function documento({ raiz, destino, partes, general, referencias, soloClase }) {
    const L = [];
    const cuantos = partes.reduce((n, p) => n + p.abiertos.length, 0);
    const cuantasClases = new Set(partes.map(p => p.clase.id)).size;

    L.push(`# Feedback de edición · ${path.basename(raiz)}`);
    L.push('');
    L.push('Lo escribió el editor revisando los renders, con Reviewer. Es todo lo que hay que');
    L.push('hacer: cada comentario dice en qué momento exacto del video pasa lo que se pide y,');
    L.push('cuando hace falta, trae el cuadro.');
    L.push('');
    L.push(`- **Ajustes por hacer:** ${cuantos} en ${cuantasClases} ${cuantasClases === 1 ? 'clase' : 'clases'}`);
    L.push(`- **Los renders están en:** ${path.resolve(raiz)}`);
    L.push(`- **Esta carpeta:** ${destino}`);
    if (soloClase) L.push('- **Ojo:** es una sola clase, no el curso entero.');
    L.push('');

    L.push('Los comentarios ya resueltos no están acá. Lo que figura es lo que falta.');
    L.push('');

    if (general.texto && general.texto.trim()) {
        L.push('## Lo que vale para todas las clases del curso');
        L.push('');
        L.push('Es la base: marca, tipografía, tono, reglas que no cambian de una clase a la otra.');
        L.push('Donde un comentario de una clase diga algo distinto, **manda el comentario**; en');
        L.push('todo lo demás, sigue mandando esto. No es una invitación a promediar.');
        L.push('');
        L.push(general.texto.trim());
        L.push('');
    }

    // El índice existe porque esto puede tener veinte secciones. Sin él, saber
    // cuánto trabajo hay en cada clase obliga a recorrer el documento entero, y
    // es lo primero que se quiere saber para repartir el trabajo.
    L.push('## Las clases, en orden');
    L.push('');
    for (const p of partes) {
        const cuantos_ = p.abiertos.length;
        const vieja = p.vieja ? `, de la v${p.version.n} —ya hay una v${p.vieja}—` : '';
        L.push(`- **${p.clase.nombre} · v${p.version.n}** — ${cuantos_} ${cuantos_ === 1 ? 'ajuste' : 'ajustes'}${vieja}`);
    }
    L.push('');

    for (const p of partes) {
        L.push('---');
        L.push('');
        L.push(`## ${p.clase.nombre} · v${p.version.n}`);
        L.push('');
        L.push(`- **Video:** ${path.resolve(p.version.ruta)}`);
        L.push(`- **El render:** ${feedback.fichaDelVideo(p.datos)}`);
        if (p.vieja) {
            L.push('');
            L.push(`> Estos comentarios son de la **v${p.version.n}** y de esta clase ya hay una **v${p.vieja}**.`);
            L.push('> Quedaron sin marcar como resueltos, así que puede que algunos ya estén hechos.');
            L.push('> Mirá la v' + p.vieja + ' antes de rehacer nada.');
        }
        L.push('');

        for (const comentario of p.abiertos) {
            const archivos = p.archivos.get(comentario.id) || [];
            L.push(feedback.cabeceraDe(comentario, p.datos.fps));
            L.push('');

            // Las menciones se resuelven contra las COPIAS: si apuntaran al
            // original, el documento mandaría a abrir un archivo de afuera de
            // la carpeta y la exportación dejaría de valerse por sí sola.
            const carpeta = workspace.carpetaDeVersion(p.version.ruta);
            const deEste = adjuntos.paraResolver(comentario, carpeta).map(item => {
                const copia = archivos.find(a => a.original === item.ruta);
                return copia ? { ...item, ruta: copia.ruta } : item;
            });
            const { texto } = menciones.resolver(comentario.texto, [...referencias, ...deEste]);
            L.push(texto.trim() || '_(sin texto)_');

            if (archivos.length) {
                L.push('');
                for (const a of archivos) {
                    L.push(`- ${a.titulo}: ${a.ruta}`);
                    if (a.frase) L.push(`  ${a.frase}`);
                }
            }
            L.push('');
        }
    }

    // La lista de todo junto, igual que en el feedback de una versión: es lo
    // que un agente necesita para abrir las imágenes de una antes de empezar.
    const todos = [];
    for (const p of partes) {
        for (const comentario of p.abiertos) {
            for (const a of (p.archivos.get(comentario.id) || [])) {
                todos.push({ etiqueta: `${p.clase.nombre} v${p.version.n} · ${comentario.id} (${a.corto})`, ruta: a.ruta });
            }
        }
    }
    for (const ref of referencias) {
        todos.push({
            etiqueta: ref.tipo === 'imagen' ? `imagen ${ref.numero} («${ref.nombre}»)` : `documento «${ref.nombre}»`,
            ruta: ref.ruta
        });
    }

    if (todos.length) {
        L.push('---');
        L.push('');
        L.push('## Dónde está cada archivo');
        L.push('');
        L.push(`No van adjuntos a este texto: son ${todos.length} archivos que están al lado de este`);
        L.push('documento, adentro de esta misma carpeta. Abrilos con tu herramienta de lectura');
        L.push('**antes** de tocar la edición: un comentario sobre un encuadre no se puede');
        L.push('contestar sin mirar el cuadro del que habla.');
        L.push('');
        for (const a of todos) L.push(`- ${a.etiqueta} → ${a.ruta}`);
        L.push('');

        if (partes.some(p => p.abiertos.some(c => (c.adjuntos || []).length))) {
            L.push('Entre los archivos que adjuntó el editor hay dos clases y no se pueden tratar igual.');
            L.push('Los que dicen **SOLO DE REFERENCIA** se miran para entender qué se pide, y nada más.');
            L.push('Los que dicen **PARA USAR TAL CUAL** son el material: ese archivo entra a la pieza, no');
            L.push('una versión parecida ni una recreación. Ante la duda, preguntá antes de usar uno.');
            L.push('');
        }
    }

    L.push('---');
    L.push('');
    L.push(`Lo exportó Reviewer el ${new Date().toISOString().slice(0, 10)}.`);
    L.push('Esta carpeta se rehace entera en cada exportación: lo que se escriba acá a mano se');
    L.push('pierde. Lo que vale es lo que el editor tiene en Reviewer.');
    L.push('');

    return L.join('\n');
}

module.exports = { DOCUMENTO, IMAGENES_DIR, ADJUNTOS_DIR, exportar, recolectar };
