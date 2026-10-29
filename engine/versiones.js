'use strict';
/**
 * versiones.js — La carpeta de renders leída como una lista de clases, cada una
 * con sus versiones.
 *
 * Claude renombra lo que entrega poniéndole el número de versión al final, así
 * que en la carpeta hay esto:
 *
 *   Clase 03 - Hooks.mp4
 *   Clase 03 - Hooks v2.mp4
 *   Clase 03 - Hooks v3.mp4
 *   Clase 04 - Estado_v2.mov
 *
 * y lo que el editor quiere ver son DOS filas, no cuatro. Agrupar es lo único
 * que hace este archivo, y hay tres decisiones adentro:
 *
 * 1. **Sin sufijo es la v1.** El primer render que entrega Claude no suele
 *    llevar número, y tratarlo como una clase aparte partía en dos la historia
 *    de la misma secuencia justo donde empieza.
 * 2. **Los tres separadores valen** (` v2`, `_v2`, `-v2`), porque los tres
 *    aparecen según quién nombró el archivo, y el editor no tiene por qué
 *    acordarse de cuál usó.
 * 3. **La extensión no agrupa.** `Clase 03.mp4` y `Clase 03 v2.mov` son la misma
 *    clase: Claude puede cambiar de contenedor entre una versión y otra y eso no
 *    la convierte en otra cosa.
 *
 * Lo que NO se hace es inventar versiones que no están: si en la carpeta hay v1
 * y v3, la lista dice v1 y v3. Un hueco es información —alguien borró algo— y
 * taparlo con una fila vacía sería peor.
 *
 * **`Pre versions/` también se lee.** Cuando Claude entrega una versión nueva
 * mueve la anterior ahí con su carpeta de comentarios, para que la raíz tenga
 * solo lo final y elegir una clase sea elegir un renglón. Pero archivar no es
 * borrar: esas versiones siguen siendo de la misma clase, siguen apareciendo
 * en los botones de arriba del visor y sus comentarios siguen abriéndose. Si
 * no se leyeran, la v1 que el editor comentó el lunes desaparecería el martes
 * sin dejar rastro, que es la peor forma de perder trabajo.
 */

const fs = require('fs');
const path = require('path');

const probe = require('./media-probe');
const workspace = require('./workspace');

/** Lo que se considera un render. */
const EXTENSIONES = new Set([
    '.mp4', '.mov', '.m4v', '.mkv', '.webm', '.avi', '.mxf', '.mts', '.m2ts', '.prores'
]);

/**
 * El sufijo de versión, al final del nombre y precedido por espacio, guion o
 * guion bajo.
 *
 * El separador es obligatorio a propósito: sin él, `Clase 03 - Reactividad v2`
 * se agruparía bien pero `Entrevista Nivel 2` se leería como la versión 2 de
 * "Entrevista Nivel", que no existe. Un número pegado a una palabra es parte de
 * la palabra.
 */
const RE_VERSION = /^(.*?)[\s_-]+v(\d{1,3})$/i;

/**
 * Nombre de archivo → de qué clase es y qué versión.
 *
 * @returns {{clase: string, version: number, explicita: boolean}}
 */
function partir(nombreBase) {
    const m = RE_VERSION.exec(nombreBase);
    if (!m) return { clase: nombreBase.trim(), version: 1, explicita: false };
    return { clase: m[1].trim(), version: parseInt(m[2], 10), explicita: true };
}

/**
 * Dos nombres de clase son el mismo si solo difieren en mayúsculas y espacios.
 *
 * Es la clave de agrupación y no lo que se muestra: lo que se muestra es el
 * nombre tal cual lo escribió quien nombró el archivo.
 */
function clave(nombreClase) {
    return nombreClase.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Los archivos de video de una carpeta, sin entrar en subcarpetas. */
function archivosDe(raiz) {
    let entradas;
    try {
        entradas = fs.readdirSync(raiz, { withFileTypes: true });
    } catch (e) {
        return { error: e.code === 'ENOENT' ? 'Esa carpeta ya no está.' : e.message, archivos: [] };
    }

    const archivos = entradas
        .filter(e => e.isFile() && !e.name.startsWith('.'))
        .filter(e => EXTENSIONES.has(path.extname(e.name).toLowerCase()))
        .map(e => path.join(raiz, e.name));

    return { error: null, archivos };
}

/**
 * Los renders guardados en `Pre versions/`, sin los que son copia de la raíz.
 *
 * Lo de descartar copias es por el que mueve los archivos: si en vez de mover
 * copia, el mismo render queda en los dos lados y la clase mostraría dos veces
 * la misma versión, una de ellas con los comentarios en la otra carpeta. Se
 * descarta por nombre de archivo, que es lo que se repite en ese caso —dos
 * versiones distintas nunca se llaman igual—, y gana la de la raíz porque es
 * la que el editor ve en el Finder.
 *
 * Un nivel y nada más: adentro de `Pre versions/` hay videos y las carpetas de
 * sus comentarios, no otra carpeta de versiones anteriores.
 */
function archivadasDe(raiz, deLaRaiz) {
    const carpeta = workspace.carpetaPrevias(raiz);
    if (!carpeta) return [];

    const yaEstan = new Set(deLaRaiz.map(r => path.basename(r)));
    return archivosDe(carpeta).archivos.filter(r => !yaEstan.has(path.basename(r)));
}

/**
 * Lee una carpeta y devuelve sus clases, cada una con sus versiones medidas.
 *
 * Las versiones van de la más vieja a la más nueva y la última es la que se
 * abre: revisar es mirar lo último que entregó Claude, y empezar por la v1
 * obligaría a un clic en cada clase para llegar a donde uno quería estar.
 *
 * @returns {Promise<{raiz:string, error:string|null, clases:Array}>}
 */
async function escanear(raiz) {
    const { error, archivos } = archivosDe(raiz);
    if (error) return { raiz, error, clases: [] };

    const guardadas = archivadasDe(raiz, archivos);
    const archivada = new Set(guardadas);

    const medidos = await probe.medirVarios([...archivos, ...guardadas]);
    const porClase = new Map();

    for (const media of medidos) {
        const nombreBase = path.basename(media.ruta, path.extname(media.ruta));
        const { clase, version, explicita } = partir(nombreBase);
        const k = clave(clase);
        if (!porClase.has(k)) {
            porClase.set(k, { id: k, nombre: clase, versiones: [] });
        }
        porClase.get(k).versiones.push({
            n: version,
            explicita,
            archivada: archivada.has(media.ruta),
            ruta: media.ruta,
            archivo: path.basename(media.ruta),
            carpeta: workspace.carpetaDeVersion(media.ruta),
            tieneComentarios: workspace.tieneComentarios(media.ruta),
            comentarios: workspace.cuantosComentarios(media.ruta),
            media
        });
    }

    const clases = [...porClase.values()];
    for (const c of clases) {
        // Por número, y con el nombre de archivo para desempatar: dos archivos
        // que declaran la misma versión (un `.mov` y su `.mp4`) tienen que salir
        // siempre en el mismo orden, o la versión que se abre al entrar cambia
        // de una sesión a la otra sin motivo.
        //
        // La archivada va primero cuando empatan en número, así la que se abre
        // es la de la raíz. Ese empate solo pasa si alguien archivó una versión
        // y dejó otra con el mismo número afuera —un estado raro— y ahí lo
        // razonable es abrir lo que está a la vista.
        c.versiones.sort((a, b) => a.n - b.n
            || (a.archivada === b.archivada ? 0 : (a.archivada ? -1 : 1))
            || a.archivo.localeCompare(b.archivo, 'es'));
        c.ultima = c.versiones[c.versiones.length - 1];
        c.conComentarios = c.versiones.filter(v => v.tieneComentarios).length;
    }

    // Las clases, en el orden en que el editor las lee: `localeCompare` con
    // `numeric` para que "Clase 10" vaya después de "Clase 9" y no entre la 1 y
    // la 2.
    clases.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { numeric: true }));

    return { raiz, error: null, clases };
}

/** Las rutas que la ventana va a poder pedirle al protocolo. */
function rutasDe(clases) {
    const rutas = [];
    for (const clase of clases) {
        for (const version of clase.versiones) rutas.push(version.ruta);
    }
    return rutas;
}

/** Una versión por su ruta, dentro de lo ya escaneado. */
function buscarVersion(clases, ruta) {
    for (const clase of clases) {
        const version = clase.versiones.find(v => v.ruta === ruta);
        if (version) return { clase, version };
    }
    return null;
}

module.exports = {
    EXTENSIONES,
    RE_VERSION,
    partir,
    clave,
    archivosDe,
    escanear,
    rutasDe,
    buscarVersion
};
