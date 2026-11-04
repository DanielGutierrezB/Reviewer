'use strict';
/**
 * entrega.js — La carpeta `Feedback/` como ida y vuelta con Claude.
 *
 * De ida, el export le deja a Claude un documento por entrega. De vuelta,
 * Claude marca en ese mismo documento lo que ya hizo: cada comentario lleva su
 * casilla,
 *
 *   - [ ] Hecho · [03-curso-v2-v4-c01]
 *
 * y al terminar el ajuste la cambia por `- [x]`, si quiere con una nota de qué
 * hizo. Reviewer lee esas casillas y marca el comentario como resuelto. Es lo
 * que evita que, si una clase se le pasó sola y después se le pasa el curso
 * entero, Claude rehaga lo que ya había hecho: lo resuelto no se exporta.
 *
 * Tres cosas que este archivo cuida:
 *
 * 1. **El código y no el id.** `c01` se repite en cada versión de cada clase;
 *    el código lleva la clase y la versión adelante y es único en el curso.
 *    Qué comentario es cada código lo dice el índice que deja el export, y no
 *    el texto del documento, que es de Claude y puede tener cualquier cosa.
 * 2. **Una marca vale para lo que se pidió, no para lo que hay ahora.** Cada
 *    pedido guarda una huella del comentario tal como se mandó. Si el editor
 *    lo cambió después, es otro pedido, y una casilla marcada sobre el viejo
 *    no lo resuelve.
 * 3. **Una marca se usa una sola vez.** Si el editor vuelve a abrir un
 *    comentario que Claude dio por hecho —porque no quedó bien—, la casilla
 *    que sigue marcada en el documento no lo puede volver a cerrar.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const comentariosLib = require('./comentarios');
const { etiquetaDe } = require('./nombres');
const workspace = require('./workspace');

/** Los archivos de todos los documentos, juntos. Ver `exportar.js`. */
const RECURSOS_DIR = 'References';

/**
 * Lo que el export sabe de lo que dejó: qué archivos usa cada documento, qué
 * comentario es cada código, y qué marcas ya se usaron.
 *
 * Es también la marca de que la carpeta la hizo Reviewer.
 */
const INDICE = '.reviewer-export.json';

/**
 * Una casilla marcada: `- [x] Hecho · [codigo]`, con lo que venga después.
 *
 * Al principio del renglón y sin sangría: el documento trae un ejemplo de
 * casilla marcada en un bloque con sangría, y ese ejemplo no puede resolver
 * nada.
 */
const RE_MARCADA = /^[-*]\s*\[[xX]\]\s*Hecho\s*·\s*\[([a-z0-9-]+)\]\s*(?:[—–-]\s*)?(.*)$/;

function carpetaDe(raiz) {
    return path.join(raiz, workspace.EXPORTACION_DIR);
}

// ─── La ruta de la carpeta, escrita una sola vez ──────────────────────
//
// Los documentos no llevan la ruta de esta máquina en cada renglón. La llevan
// una vez, en una línea propia —`FEEDBACK = /Users/…/Feedback`—, y todas las
// demás rutas empiezan con `{FEEDBACK}`. Así, si la carpeta se abre en otra
// computadora o se muda, hay un solo lugar que corregir, y lo corrige
// `corregirBase` al abrir la carpeta, antes de cualquier otra cosa.

const VARIABLE = 'FEEDBACK';

/** La línea que define la variable, sola y al principio del renglón. */
const RE_BASE = new RegExp(`^${VARIABLE} = .*$`, 'm');

function lineaDeBase(carpeta) {
    return `${VARIABLE} = ${carpeta}`;
}

/** Una ruta como la escribe el documento: a partir de la variable. */
function rutaEn(carpeta, ruta) {
    const relativa = path.relative(carpeta, ruta);
    return relativa ? `{${VARIABLE}}/${relativa}` : `{${VARIABLE}}`;
}

/**
 * Deja la línea de la variable con la ruta de esta máquina, en cada documento.
 *
 * Solo toca esa línea: el resto del documento —las casillas que Claude ya
 * marcó, lo que haya escrito al lado— queda como estaba. Y solo en los
 * documentos del índice, que son los que hizo el export.
 *
 * @returns {number} cuántos documentos se corrigieron
 */
function corregirBase(raiz) {
    const carpeta = carpetaDe(raiz);
    if (!fs.existsSync(rutaDelIndice(carpeta))) return 0;
    const correcta = lineaDeBase(carpeta);

    let corregidos = 0;
    for (const doc of Object.keys(leerIndice(carpeta).documentos)) {
        const archivo = path.join(carpeta, doc);
        let texto;
        try {
            texto = fs.readFileSync(archivo, 'utf8');
        } catch (e) {
            continue;
        }
        const actual = RE_BASE.exec(texto);
        if (!actual || actual[0] === correcta) continue;
        fs.writeFileSync(archivo, texto.replace(RE_BASE, correcta), 'utf8');
        corregidos++;
    }
    return corregidos;
}

function rutaDelIndice(carpeta) {
    return path.join(carpeta, RECURSOS_DIR, INDICE);
}

/**
 * El índice, siempre con la misma forma.
 *
 * Los exports de antes guardaban por documento solo la lista de archivos; se
 * leen igual, como un documento sin pedidos.
 */
function leerIndice(carpeta) {
    const crudo = workspace.readJson(rutaDelIndice(carpeta)) || {};
    const documentos = {};
    for (const [doc, valor] of Object.entries(crudo.documentos || {})) {
        documentos[doc] = Array.isArray(valor)
            ? { archivos: valor, pedidos: {} }
            : { archivos: valor.archivos || [], pedidos: valor.pedidos || {} };
    }
    return { documentos, aplicados: Array.isArray(crudo.aplicados) ? crudo.aplicados : [] };
}

function escribirIndice(carpeta, indice) {
    workspace.ensureDir(path.join(carpeta, RECURSOS_DIR));
    workspace.writeJson(rutaDelIndice(carpeta), indice);
}

/**
 * El código con el que un comentario viaja en los documentos.
 *
 * Es el mismo prefijo que llevan sus archivos en `References/`: quien vea
 * `03-curso-v2-v4-c01-cuadro.png` y `[03-curso-v2-v4-c01]` sabe que son lo
 * mismo.
 */
function codigoDe(clase, version, comentario) {
    return `${workspace.slug(clase.nombre)}-${workspace.slug(etiquetaDe(version))}-${comentario.id}`;
}

/** El comentario tal como se pidió: cuándo y qué. */
function huellaDe(comentario) {
    const pedido = JSON.stringify([comentario.t, comentario.tHasta || null, comentario.texto]);
    return crypto.createHash('sha1').update(pedido).digest('hex');
}

/** Lo que un pedido guarda en el índice. La ruta, relativa al curso: la carpeta se muda. */
function pedidoDe(raiz, version, comentario) {
    return { ruta: path.relative(raiz, version.ruta), id: comentario.id, huella: huellaDe(comentario) };
}

/** Las casillas marcadas de un documento. */
function marcadasEn(texto) {
    const salida = [];
    for (const linea of String(texto || '').split('\n')) {
        const m = RE_MARCADA.exec(linea);
        if (m) salida.push({ codigo: m[1], nota: m[2].trim() });
    }
    return salida;
}

/**
 * Lee lo que Claude marcó como hecho y resuelve esos comentarios.
 *
 * Mira solo los documentos que hizo el export —los del índice—: un `.md` que
 * alguien dejó en la carpeta puede tener casillas con cualquier código.
 *
 * Nunca lanza: un documento ilegible o un comentario que ya no está se saltean.
 *
 * @param {Function} contextoDe ruta → contexto, para reescribir su `feedback.md`
 * @returns {{resueltos: Array<{ruta:string, id:string, nota:string}>}}
 */
function aplicarHechos(raiz, contextoDe) {
    const carpeta = carpetaDe(raiz);
    const resueltos = [];
    if (!fs.existsSync(rutaDelIndice(carpeta))) return { resueltos };

    const indice = leerIndice(carpeta);
    const aplicados = new Set(indice.aplicados);

    for (const [doc, { pedidos }] of Object.entries(indice.documentos)) {
        let texto;
        try {
            texto = fs.readFileSync(path.join(carpeta, doc), 'utf8');
        } catch (e) {
            continue;
        }
        for (const { codigo, nota } of marcadasEn(texto)) {
            const pedido = pedidos[codigo];
            if (!pedido) continue;
            const marca = `${codigo}@${pedido.huella}`;
            if (aplicados.has(marca)) continue;

            const ruta = path.resolve(raiz, pedido.ruta);
            if (!fs.existsSync(ruta)) continue;
            const ctx = contextoDe(ruta);
            const actual = comentariosLib.leer(ruta, ctx.media).comentarios.find(c => c.id === pedido.id);
            // Cambiado desde que se pidió: esa marca habla de otro pedido. No se
            // anota como usada, por si el editor lo deja como estaba.
            if (!actual || huellaDe(actual) !== pedido.huella) continue;

            aplicados.add(marca);
            if (actual.estado !== 'abierto') continue;
            comentariosLib.editar(ruta, pedido.id, {
                estado: 'resuelto',
                hecho: { por: 'claude', nota: nota || null, cuando: new Date().toISOString() }
            }, ctx);
            resueltos.push({ ruta, id: pedido.id, nota });
        }
    }

    if (aplicados.size !== indice.aplicados.length) {
        escribirIndice(carpeta, { ...indice, aplicados: [...aplicados].sort() });
    }
    return { resueltos };
}

module.exports = {
    RECURSOS_DIR,
    INDICE,
    VARIABLE,
    carpetaDe,
    lineaDeBase,
    rutaEn,
    corregirBase,
    leerIndice,
    escribirIndice,
    codigoDe,
    huellaDe,
    pedidoDe,
    marcadasEn,
    aplicarHechos
};
