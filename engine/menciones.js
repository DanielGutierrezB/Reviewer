'use strict';
/**
 * menciones.js — Nombrar un archivo adentro de un comentario.
 *
 * Es el mismo sistema que HyperPremiere, y se copió entero porque el problema
 * es el mismo: el editor quiere escribir *"que el logo quede como en el manual
 * de marca"* y que Claude sepa cuál es el manual de marca.
 *
 * En el texto guardado una referencia es un token:
 *
 *   Que el color del título sea el de @[curso/manual-de-marca.pdf].
 *
 * En el panel se ve como un chip (`@Imagen_1`) y a Claude le llega resuelto
 * ("imagen 1") con su ruta absoluta listada aparte.
 *
 * **Por qué texto y no un objeto.** El comentario es un string que viaja por
 * cinco sitios —el JSON, el markdown, el campo del panel, el prompt del
 * refinador y el prompt de "Preparar para Claude"—. Cualquiera de esos pasos
 * que no supiera de un campo paralelo con las referencias las perdería, y la
 * más barata de esas pérdidas es un gráfico rehecho sin la marca.
 *
 * **Por nombre y no por número.** El número es presentación: borrar la primera
 * referencia renumera todas las demás, y un comentario escrito ayer apuntaría
 * a otra imagen. El nombre sobrevive a que se reordene la lista.
 *
 * **Con ámbito**, porque el mismo nombre puede estar en los dos niveles: una
 * `captura.png` del curso y otra de este video son dos archivos distintos.
 */

/** El token, tal como aparece en el texto. */
const RE_MENCION = /@\[([^[\]\n]{1,200})\]/g;

/**
 * Los dos niveles, con la palabra que ve el editor.
 *
 * `curso` y `video` y no `course`/`sequence`: lo que el editor lee en su propio
 * comentario tiene que estar en el idioma en que lo escribió.
 */
const AMBITOS = { curso: 'curso', video: 'video' };

/** Cómo se escribe una mención. */
function escribir(ambito, nombre) {
    const prefijo = AMBITOS[ambito] ? `${AMBITOS[ambito]}/` : '';
    return `@[${prefijo}${nombre}]`;
}

/** Todas las menciones de un texto, en orden y con repetidas. */
function encontrar(texto) {
    const salida = [];
    const re = new RegExp(RE_MENCION.source, 'g');
    let m;
    while ((m = re.exec(String(texto || ''))) !== null) {
        const crudo = m[1];
        const barra = crudo.indexOf('/');
        const ambito = barra > 0 ? crudo.slice(0, barra) : null;
        salida.push({
            token: m[0],
            crudo,
            ambito: AMBITOS[ambito] ? ambito : null,
            nombre: AMBITOS[ambito] ? crudo.slice(barra + 1) : crudo,
            indice: m.index
        });
    }
    return salida;
}

/**
 * Las menciones que un refinado perdió o rompió.
 *
 * Se comparan los tokens crudos y no la cantidad: perder la del curso y repetir
 * dos veces la del video da el mismo número y no es lo mismo.
 */
function perdidas(refinado, original) {
    const quedan = new Set(encontrar(refinado).map(m => m.token));
    const faltan = [];
    for (const m of encontrar(original)) {
        if (!quedan.has(m.token) && !faltan.includes(m.token)) faltan.push(m.token);
    }
    return faltan;
}

/**
 * El texto como lo va a leer Claude, con cada mención cambiada por lo que es.
 *
 * `resolver` recibe la lista de referencias que de verdad viajan, con el número
 * que les tocó, y devuelve el texto más lo que no se pudo resolver.
 *
 * Una mención colgada —el archivo se quitó después de escribir el comentario—
 * no se borra ni se deja en crudo: se dice que estaba y que ya no. Borrarla
 * dejaría una frase hablando de "el logo" sin decir cuál, que es el modo de
 * falla más caro porque no se ve.
 *
 * @param {string} texto
 * @param {Array<{ambito:string, nombre:string, numero:number, tipo:string}>} referencias
 */
function resolver(texto, referencias) {
    const porClave = new Map();
    for (const ref of referencias || []) {
        porClave.set(`${ref.ambito}/${ref.nombre}`, ref);
        // También sin ámbito, para los comentarios escritos a mano donde alguien
        // puso `@[logo.png]` sin saber de niveles.
        if (!porClave.has(ref.nombre)) porClave.set(ref.nombre, ref);
    }

    const colgadas = [];
    const salida = String(texto || '').replace(new RegExp(RE_MENCION.source, 'g'), (token, crudo) => {
        const ref = porClave.get(crudo);
        if (!ref) {
            colgadas.push(crudo);
            const nombre = crudo.includes('/') ? crudo.slice(crudo.indexOf('/') + 1) : crudo;
            return `«${nombre}» (una referencia que ya no está adjunta)`;
        }
        if (ref.tipo === 'imagen') return `imagen ${ref.numero}`;
        return `el documento «${ref.nombre}»`;
    });

    return { texto: salida, colgadas };
}

module.exports = { RE_MENCION, AMBITOS, escribir, encontrar, perdidas, resolver };
