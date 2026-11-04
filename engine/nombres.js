'use strict';
/**
 * nombres.js — De qué clase es un archivo, qué versión, y cómo se la nombra.
 *
 * Sin dependencias, a propósito. Lo necesitan el escaneo, la lectura de
 * ediciones, el aviso de entregas nuevas y el texto general, y cualquiera de
 * ellos que importara a otro cerraría un círculo. Por eso mismo `general.js` llevaba su propia copia de
 * la expresión regular, y una copia de una regla es una regla que un día dice
 * otra cosa.
 */

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

/** Lo que se considera un render. */
const EXTENSIONES = new Set([
    '.mp4', '.mov', '.m4v', '.mkv', '.webm', '.avi', '.mxf', '.mts', '.m2ts', '.prores'
]);

function esRender(nombreArchivo) {
    const punto = nombreArchivo.lastIndexOf('.');
    return !nombreArchivo.startsWith('.') && punto > 0 && EXTENSIONES.has(nombreArchivo.slice(punto).toLowerCase());
}

/**
 * Nombre de archivo sin extensión → de qué clase es y qué versión, mirándolo
 * solo.
 *
 * Casi siempre alcanza. Cuando no, hace falta saber qué otras clases hay en la
 * carpeta, y para eso está `partirEntre`: todo lo que agrupa versiones tiene
 * que pasar por esa, no por esta.
 *
 * @returns {{clase: string, version: number, explicita: boolean}}
 */
function partir(nombreBase) {
    const m = RE_VERSION.exec(nombreBase);
    if (!m) return { clase: nombreBase.trim(), version: 1, explicita: false };
    return { clase: m[1].trim(), version: parseInt(m[2], 10), explicita: true };
}

/** El sufijo con forma de versión al final de un nombre, tal cual: `V2`, `v4`. */
const RE_COLA = /[\s_-]+(v\d{1,3})$/i;

/**
 * Los sufijos que en esta carpeta son parte del nombre de una clase.
 *
 * Salen de las clases que, ya sin su versión, siguen terminando en algo con
 * forma de versión: `01_Curso_V2_v4` es la v4 de `01_Curso_V2`, así que `V2`
 * es parte del nombre de la serie.
 *
 * @param {string[]} nombresDeClase ya sin la versión
 */
function marcasDe(nombresDeClase) {
    const marcas = new Set();
    for (const nombre of nombresDeClase) {
        const m = RE_COLA.exec(nombre);
        if (m) marcas.add(m[1]);
    }
    return marcas;
}

/** Lo mismo, a partir de los nombres de los archivos. */
function marcasDeArchivos(nombresBase) {
    return marcasDe(nombresBase.map(n => partir(n).clase));
}

/**
 * De qué clase es un archivo, sabiendo cómo se nombra el resto de la carpeta.
 *
 * Resuelve el único caso en que un nombre se lee de dos maneras: un sufijo con
 * forma de versión que en realidad es parte del nombre de la serie. En una
 * carpeta con `01_Curso_V2.mp4`, `01_Curso_V2_v3.mp4` y `01_Curso_V2_v4.mp4`,
 * el primero mirado solo es «la v2 de 01_Curso»; pero `V2` es el nombre de la
 * serie —lo dicen los otros dos— y ese archivo es su primera versión, la que
 * Claude entrega sin número. Leerlo solo partía cada clase en dos —una de
 * ellas fantasma, con un único archivo viejo— y lo que se comentaba en la
 * fantasma iba a parar al render archivado sin que nada lo dijera.
 *
 * La comparación respeta mayúsculas, y es lo que la hace segura: en esa misma
 * carpeta `Clase_v2.mp4`, con la «v» chica de las versiones, sigue siendo la
 * v2 de `Clase`.
 *
 * @param {Set<string>} marcas las de `marcasDe` sobre toda la carpeta
 */
function partirEntre(nombreBase, marcas) {
    const p = partir(nombreBase);
    const cola = p.explicita && RE_COLA.exec(nombreBase);
    if (cola && marcas.has(cola[1])) return { clase: nombreBase.trim(), version: 1, explicita: false };
    return p;
}

/** La marca de parte de un nombre: el `_p1` de `06_Curso_p1_V2`. */
const RE_PARTE = /[\s_-](p\d{1,2})(?=$|[\s_-])/i;

/** La parte de una clase partida, o `null`: `p1`, `p2`. */
function parteDe(nombreClase) {
    const m = RE_PARTE.exec(nombreClase);
    return m ? m[1] : null;
}

/**
 * El nombre de la clase sin su marca de parte.
 *
 * Es lo que tienen en común una clase y sus partes: `06_Curso_V2` antes de
 * partirse y `06_Curso_p1_V2` después dan lo mismo.
 */
function sinParte(nombreClase) {
    return nombreClase.replace(RE_PARTE, '');
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

/**
 * Cómo se nombra una versión ante una persona o ante Claude.
 *
 * Una edición no tiene número propio: es una propuesta SOBRE la v3, no una
 * v4. Cuando cada uno la nombraba con `v${n}`, la edición salía como «v3» en
 * el export, en el `feedback.md` y en lo que se le manda a Claude:
 * indistinguible del render que propone cambiar, que es justo lo que hay que
 * distinguir.
 *
 * `parte` es la de una versión vieja que entró a la clase desde una parte que
 * después se juntó con las demás: en `08_Curso_V2` hay una «v1 p1» y una
 * «v1 p2», y dos botones que dijeran «v1» no se distinguirían.
 */
function etiquetaDe({ n, edicion, parte }) {
    if (edicion) return `edición de la v${n}`;
    return parte ? `v${n} ${parte}` : `v${n}`;
}

module.exports = {
    RE_VERSION, EXTENSIONES, esRender, partir, marcasDe, marcasDeArchivos, partirEntre,
    parteDe, sinParte, clave, etiquetaDe
};
