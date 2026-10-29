'use strict';
/**
 * feedback.js — El JSON de una versión, escrito como lo va a leer Claude.
 *
 * Este archivo es el producto de la herramienta. Todo lo demás —el reproductor,
 * el canvas, el dictado— existe para que esto salga bien escrito.
 *
 * Cuatro decisiones, las cuatro aprendidas en HyperPremiere:
 *
 * 1. **Rutas absolutas, siempre.** El agente no indexa la carpeta donde está
 *    parado: una ruta relativa es una ruta que no va a abrir. Y se le dice con
 *    todas las letras que los PNG no vienen adjuntos y que los abra ANTES de
 *    editar, porque si no, compone sin mirarlos y el comentario sobre un
 *    encuadre se contesta a ciegas.
 * 2. **Los tiempos, de las tres maneras** (`tiempo.js`). No se sabe si del otro
 *    lado hay código con cuadros o una timeline con timecode.
 * 3. **El comentario general va adentro**, no referenciado. Es un párrafo; que
 *    Claude tenga que abrir un segundo archivo para enterarse de la marca es
 *    una oportunidad más de no enterarse. Cuando ese texto cambia se reescriben
 *    los `feedback.md` que lo copiaron (`general.js`), así que nunca queda uno
 *    diciendo lo de antes.
 * 4. **La precedencia se dice, no se resuelve.** Lo general es la base y lo de
 *    este video manda donde se contradigan. Dejar que el modelo lo adivine es
 *    lo que hacía que una nota de color del curso le ganara a una instrucción
 *    puntual de la clase.
 */

const path = require('path');

const menciones = require('./menciones');
const tiempo = require('./tiempo');
const workspace = require('./workspace');

/** `492.3` → `00:08:12`, para la ficha del video. */
function duracionLarga(segundos) {
    const t = Math.max(0, Math.round(Number(segundos) || 0));
    const p = n => String(n).padStart(2, '0');
    return `${p(Math.floor(t / 3600))}:${p(Math.floor(t / 60) % 60)}:${p(t % 60)}`;
}

/** La ficha técnica del render, en un renglón. */
function fichaDelVideo(datos) {
    const partes = [];
    if (datos.ancho && datos.alto) partes.push(`${datos.ancho}×${datos.alto}`);
    if (datos.ancho && datos.alto) partes.push(datos.alto > datos.ancho ? 'vertical (9:16)' : 'horizontal (16:9)');
    partes.push(`${tiempo.fpsTexto(datos.fps)} fps`);
    if (datos.duracion) partes.push(`${duracionLarga(datos.duracion)} (${Math.round(datos.duracion * datos.fps)} cuadros)`);
    return partes.join(' · ');
}

/**
 * Los archivos que acompañan a un comentario, con su ruta absoluta.
 *
 * El dibujo va siempre con el cuadro limpio al lado, y en ese orden. Un trazo
 * rojo encima de un plano tapa parte del plano: con los dos, el que lee puede
 * ver qué se señaló y también qué había debajo.
 */
function archivosDe(comentario, carpeta) {
    const salida = [];
    if (comentario.frame) {
        salida.push({
            titulo: 'El cuadro',
            corto: 'cuadro',
            ruta: path.join(carpeta, comentario.frame)
        });
    }
    if (comentario.dibujo) {
        salida.push({
            titulo: 'Lo que se dibujó sobre ese cuadro',
            corto: 'con el dibujo',
            ruta: path.join(carpeta, comentario.dibujo)
        });
    }
    return salida;
}

/** El encabezado de un comentario: su id, cuándo es y cómo está. */
function cabeceraDe(comentario, fps) {
    const cuando = comentario.tHasta
        ? tiempo.completoRango(comentario.t, comentario.tHasta, fps)
        : tiempo.completo(comentario.t, fps);
    const estado = comentario.estado === 'resuelto' ? ' — YA RESUELTO, no hay que hacer nada' : '';
    return `### ${comentario.id} · ${cuando}${estado}`;
}

/**
 * El markdown entero.
 *
 * @param {object} datos lo que guarda `comentarios.js`
 * @param {object} contexto { rutaVideo, clase, numeroVersion, general, referencias }
 */
function escribir(datos, contexto) {
    const ctx = contexto || {};
    const carpeta = workspace.carpetaDeVersion(ctx.rutaVideo);
    const fps = datos.fps;
    const abiertos = datos.comentarios.filter(c => c.estado === 'abierto');
    const resueltos = datos.comentarios.filter(c => c.estado === 'resuelto');
    const referencias = ctx.referencias || [];

    const L = [];

    const titulo = ctx.clase
        ? `${ctx.clase} · v${ctx.numeroVersion || 1}`
        : path.basename(ctx.rutaVideo || datos.video);
    L.push(`# Feedback de edición · ${titulo}`);
    L.push('');
    L.push('Lo escribió el editor revisando el render, con Reviewer. Cada comentario dice en qué');
    L.push('momento exacto del video pasa lo que se pide y, cuando hace falta, trae el cuadro.');
    L.push('');
    L.push(`- **Video:** ${path.resolve(ctx.rutaVideo || datos.video)}`);
    L.push(`- **El render:** ${fichaDelVideo(datos)}`);
    L.push(`- **Esta carpeta:** ${carpeta}`);
    L.push('');

    if (datos.instruccion && datos.instruccion.texto) {
        L.push('## Qué hay que hacer');
        L.push('');
        L.push('Es el resumen de todos los comentarios de abajo, ordenado. Los comentarios siguen');
        L.push('siendo la fuente: si acá falta un detalle, está en el comentario que lo dice.');
        L.push('');
        L.push(datos.instruccion.texto.trim());
        L.push('');
    }

    if (ctx.general && ctx.general.texto && ctx.general.texto.trim()) {
        L.push('## Lo que vale para todas las clases del curso');
        L.push('');
        L.push('Es la base: marca, tipografía, tono, reglas que no cambian de una clase a la otra.');
        L.push('Donde un comentario de ESTE video diga algo distinto, **manda el comentario**; en');
        L.push('todo lo demás, sigue mandando esto. No es una invitación a promediar.');
        if (ctx.general.ruta) {
            L.push('');
            L.push(`El original está en ${ctx.general.ruta} y es el que vale si este archivo quedó viejo.`);
        }
        L.push('');
        L.push(ctx.general.texto.trim());
        L.push('');
    }

    L.push(`## Comentarios de este video (${abiertos.length} por hacer · ${resueltos.length} ya resueltos)`);
    L.push('');

    if (!datos.comentarios.length) {
        L.push('_Todavía no hay comentarios._');
        L.push('');
    }

    for (const comentario of datos.comentarios) {
        L.push(cabeceraDe(comentario, fps));
        L.push('');
        const { texto } = menciones.resolver(comentario.texto, referencias);
        L.push(texto.trim() || '_(sin texto)_');
        const archivos = archivosDe(comentario, carpeta);
        if (archivos.length) {
            L.push('');
            for (const a of archivos) L.push(`- ${a.titulo}: ${a.ruta}`);
        }
        L.push('');
    }

    // ─── Dónde está cada archivo ──────────────────────────────────────
    //
    // Repetido a propósito. Arriba cada ruta está donde hace falta entenderla,
    // junto a su comentario; acá están todas juntas, que es lo que un agente
    // necesita para abrirlas de una antes de empezar. Medido en HyperPremiere:
    // sin un bloque así, el modelo nombra las imágenes sin haberlas leído.
    const todos = [];
    for (const comentario of datos.comentarios) {
        for (const a of archivosDe(comentario, carpeta)) {
            todos.push({ etiqueta: `${comentario.id} (${a.corto})`, ruta: a.ruta });
        }
    }
    for (const ref of referencias) {
        todos.push({
            etiqueta: ref.tipo === 'imagen' ? `imagen ${ref.numero} («${ref.nombre}»)` : `documento «${ref.nombre}»`,
            ruta: ref.ruta
        });
    }

    if (todos.length) {
        L.push('## Dónde están las imágenes');
        L.push('');
        L.push(todos.length === 1
            ? 'No va adjunta a este texto: es un archivo en el disco de esta Mac.'
            : `No van adjuntas a este texto: son ${todos.length} archivos en el disco de esta Mac.`);
        L.push('Abrilos con tu herramienta de lectura **antes** de tocar la edición: un comentario');
        L.push('sobre un encuadre no se puede contestar sin mirar el cuadro del que habla.');
        L.push('');
        for (const a of todos) L.push(`- ${a.etiqueta} → ${a.ruta}`);
        L.push('');
    }

    L.push('---');
    L.push('');
    L.push('Lo escribió Reviewer. Este archivo se rehace solo cada vez que el editor toca un');
    L.push('comentario, así que no conviene editarlo a mano: lo que se escriba acá se pierde en');
    L.push('el próximo guardado.');
    L.push('');

    return L.join('\n');
}

module.exports = { escribir, fichaDelVideo, duracionLarga, archivosDe, cabeceraDe };
