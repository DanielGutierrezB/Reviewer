'use strict';
/**
 * general.js — El comentario que vale para todas las clases del curso.
 *
 * Son dos niveles y no uno, con la misma jerarquía que HyperPremiere:
 *
 * - **El general** —lo que estás leyendo acá— es del curso entero: la marca, el
 *   ritmo, "los títulos nunca en mayúsculas", "la música siempre debajo de
 *   −18 dB". Vive en `Reviewer/comentario-general.md`, arriba de todo y no
 *   adentro de la carpeta de una versión, porque no es de una clase.
 * - **Los de cada video** son de ese render y de ningún otro, y viven en su
 *   carpeta (`comentarios.js`).
 *
 * Los dos viajan al feedback, en ese orden, y la precedencia se escribe con
 * todas las letras: el general es la base, lo puntual manda donde se
 * contradigan (`feedback.js`). Esa frase existe porque en HyperPremiere el
 * nivel de la clase **reemplazaba** al del curso, y escribir dos palabras sobre
 * el color de una clase tiraba a la basura la tipografía y el tono del curso
 * entero.
 *
 * **Vaciar el campo borra el archivo.** Un `.md` de cero bytes al lado de los
 * renders le aparece al que abra la carpeta sin querer decir nada, y Claude lo
 * leería igual. Si el archivo no está, tampoco está la duda.
 *
 * **Al cambiar, se rehacen los `feedback.md` que lo copiaron.** El texto va
 * copiado adentro de cada uno para que Claude lea un solo archivo; el precio de
 * eso es que una copia puede quedar vieja, y el precio se paga acá y no en el
 * que lee.
 */

const fs = require('fs');
const path = require('path');

const feedback = require('./feedback');
const referencias = require('./referencias');
const workspace = require('./workspace');

const VERSION_ARCHIVO = 1;

/** Lo que hay escrito para este curso. */
function leer(raiz) {
    const archivos = workspace.archivosGenerales(raiz);
    let texto = '';
    try {
        texto = fs.readFileSync(archivos.md, 'utf8');
    } catch (e) { /* todavía no hay nada escrito, que es lo normal */ }

    const meta = workspace.readJson(archivos.json) || {};
    return {
        texto,
        ruta: archivos.md,
        actualizado: meta.actualizado || null,
        referencias: referencias.listar(raiz)
    };
}

/**
 * Las versiones de la carpeta que ya tienen un `feedback.md` escrito.
 *
 * Se buscan por el disco y no por lo que la ventana tenga cargado: la ventana
 * puede tener una sola clase abierta y el texto general es de todas.
 */
function versionesConFeedback(raiz) {
    let entradas;
    try {
        entradas = fs.readdirSync(raiz, { withFileTypes: true });
    } catch (e) {
        return [];
    }

    const salida = [];
    for (const entrada of entradas) {
        if (!entrada.isDirectory() || entrada.name === workspace.GENERAL_DIR) continue;
        const carpeta = path.join(raiz, entrada.name);
        const datos = workspace.readJson(path.join(carpeta, workspace.ARCHIVOS.comentarios));
        if (!datos || !datos.video) continue;
        const rutaVideo = path.join(raiz, datos.video);
        if (!fs.existsSync(rutaVideo)) continue;
        salida.push({ rutaVideo, carpeta, datos });
    }
    return salida;
}

/**
 * Rehace los `feedback.md` de la carpeta con el texto general de ahora.
 *
 * No toca el `comentarios.json` de nadie: lo que cambia es la copia del texto
 * general que el markdown lleva adentro, y eso se deriva. Si una versión no se
 * puede reescribir —permisos, disco desmontado— se sigue con las demás: dejar
 * cuatro al día por una que falló es mejor que no actualizar ninguna.
 *
 * @returns {{rehechos:number, fallados:number}}
 */
function rehacerFeedbacks(raiz, partir) {
    const general = partir || leer(raiz);
    const refs = referencias.paraFeedback(raiz);
    let rehechos = 0;
    let fallados = 0;

    for (const { rutaVideo, carpeta, datos } of versionesConFeedback(raiz)) {
        try {
            const nombreBase = path.basename(rutaVideo, path.extname(rutaVideo));
            // `versiones.partir` haría lo mismo, pero traer ese módulo desde acá
            // cerraría un círculo (versiones → workspace → …) por un dato que se
            // saca con una expresión regular.
            const m = /^(.*?)[\s_-]+v(\d{1,3})$/i.exec(nombreBase);
            workspace.writeAtomic(path.join(carpeta, workspace.ARCHIVOS.feedback), feedback.escribir(datos, {
                rutaVideo,
                clase: m ? m[1].trim() : nombreBase,
                numeroVersion: m ? parseInt(m[2], 10) : 1,
                general: { texto: general.texto, ruta: general.ruta },
                referencias: refs
            }));
            rehechos++;
        } catch (e) {
            fallados++;
        }
    }

    return { rehechos, fallados };
}

/**
 * Guarda el comentario general. Vacío lo borra.
 *
 * @returns {{texto:string, ruta:string, rehechos:number}}
 */
function guardar(raiz, texto) {
    const archivos = workspace.archivosGenerales(raiz);
    const limpio = String(texto == null ? '' : texto).trim();

    if (!limpio) {
        workspace.borrar(archivos.md);
        workspace.borrar(archivos.json);
        // La carpeta solo se va si no queda nada adentro: las referencias
        // adjuntas pueden seguir ahí y no son del texto.
        try { fs.rmdirSync(archivos.carpeta); } catch (e) { /* algo quedó: se queda */ }
    } else {
        workspace.ensureDir(archivos.carpeta);
        workspace.writeAtomic(archivos.md, `${limpio}\n`);
        workspace.writeJson(archivos.json, {
            version: VERSION_ARCHIVO,
            actualizado: new Date().toISOString()
        });
    }

    const ahora = leer(raiz);
    const { rehechos } = rehacerFeedbacks(raiz, ahora);
    return { ...ahora, rehechos };
}

module.exports = { VERSION_ARCHIVO, leer, guardar, versionesConFeedback, rehacerFeedbacks };
