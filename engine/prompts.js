'use strict';
/**
 * prompts.js — Qué se le pide al modelo local, y qué se acepta de vuelta.
 *
 * Son dos trabajos distintos y por eso hay dos manuales:
 *
 * - **Refinar** un comentario: lo que se dictó o se tecleó a las apuradas,
 *   convertido en una nota de edición que se entienda. Uno a la vez.
 * - **Preparar para Claude**: todos los comentarios abiertos leídos juntos y
 *   escritos como un encargo ordenado, que va al tope del `feedback.md`.
 *
 * El manual de refinar es el de HyperPremiere con los ejemplos cambiados, y las
 * reglas están en orden de importancia porque un modelo chico, cuando tiene que
 * elegir, obedece a la primera. La primera es no inventar: lo que el modelo
 * agregue lo va a terminar viendo el editor en el video.
 *
 * Y nada de lo que vuelve toca un campo sin pasar por `verificar`. Los tres
 * modos de falla medidos —el modelo contesta en vez de reescribir, se come la
 * mitad de lo que se pidió, o pierde una mención a un archivo— se ven idénticos
 * desde afuera: un texto razonable en el campo. Por eso se miran acá.
 */

const llm = require('./llm');
const menciones = require('./menciones');
const tiempo = require('./tiempo');

const SISTEMA_REFINAR = [
    'Sos un editor de texto. Recibís lo que un editor de video dijo o tecleó mientras revisaba un',
    'render, para pedirle un cambio a quien lo editó. Si vino del micrófono está transcrito por',
    'Whisper: sin puntuación confiable, con muletillas y con correcciones dichas en voz alta.',
    'Devolvés ese mismo pedido convertido en UNA nota de edición clara.',
    '',
    'REGLAS, en orden de importancia:',
    '1. NO INVENTES NADA. Si no lo dijo, no está. Ni duraciones, ni colores, ni tipografías, ni',
    '   textos en pantalla, ni efectos, ni "de forma más dinámica". Es una nota de trabajo, no una',
    '   propuesta: lo que agregues lo va a terminar viendo en el video.',
    '2. NO PIERDAS NADA de lo que pidió. Podés reordenar, agrupar y estructurar; descartar no.',
    '3. Los términos técnicos que se dicen en inglés SE QUEDAN EN INGLÉS: keyframe, fade, cut,',
    '   jump cut, b-roll, lower third, overlay, easing, loop, timeline, motion blur, j-cut.',
    '   Nadie quiere leer "fotograma clave".',
    '4. Sacá muletillas ("eh", "o sea", "este", "digamos"), repeticiones y arranques abandonados.',
    '   Si se corrigió en voz alta ("que dure dos segundos… no, tres"), vale lo último que dijo.',
    '5. Español. No agregues un encabezado, ni "Comentario:", ni comillas alrededor.',
    '6. NO escribas tiempos ni timecodes salvo que el editor los haya dicho. El momento del video',
    '   ya está anotado aparte: repetirlo mal es peor que no repetirlo.',
    '7. Lo que venga entre @[ y ] es una REFERENCIA A UN ARCHIVO y va TAL CUAL, carácter por',
    '   carácter: @[curso/manual-de-marca.pdf] se copia igual, sin traducir, sin reordenarle las',
    '   palabras y sin sacarle los corchetes. Podés moverla de lugar en la frase; tocarla por',
    '   dentro la rompe.',
    '',
    'Devolvés SOLO la nota. Sin preámbulo, sin comillas, sin listas de qué cambiaste, sin preguntas.'
].join('\n');

const SISTEMA_INSTRUCCION = [
    'Sos el asistente de un editor de video. Te paso los comentarios que dejó revisando un render',
    'y devolvés UN encargo ordenado para quien va a hacer los cambios, que es un agente de código',
    'que edita el video programáticamente.',
    '',
    'REGLAS, en orden de importancia:',
    '1. NO INVENTES NADA y NO PIERDAS NADA. Cada pedido del editor tiene que estar. No agregues',
    '   sugerencias propias, ni "además convendría", ni criterios que nadie escribió.',
    '2. CITÁ EL ID de cada comentario entre paréntesis al final de la frase que lo recoge: (c01),',
    '   (c03, c04) si dos comentarios piden lo mismo. Es cómo el que lee vuelve al momento exacto',
    '   del video y a su imagen.',
    '3. Los tiempos van COMO TE LOS PASO, copiados carácter por carácter. No los conviertas, no',
    '   los redondees y no los inventes para los comentarios que no traen.',
    '4. Agrupá lo que es el mismo cambio aunque esté en dos comentarios, y ordená por el momento',
    '   del video. Si hay algo que conviene hacer antes que otra cosa, decilo.',
    '5. Los comentarios marcados como ya resueltos NO van: no hay que hacerlos de nuevo.',
    '6. Español, en viñetas, sin encabezado y sin cierre. Nada de "¡Espero que te sirva!".',
    '7. Lo que venga entre @[ y ] va TAL CUAL, carácter por carácter.'
].join('\n');

/**
 * Lo que vuelve del modelo, sin lo que no se pidió.
 *
 * Los modelos con razonamiento escriben su `<think>` adentro de la respuesta
 * cuando el servidor no lo separa, y casi todos abren con una línea de cortesía.
 * Las comillas que envuelven todo son el caso más molesto: se guardarían en el
 * comentario y aparecerían en el markdown.
 */
function limpiar(texto) {
    let t = String(texto || '');
    t = t.replace(/<think>[\s\S]*?<\/think>/gi, '');
    t = t.replace(/<\/?[a-z_]*think[a-z_]*>/gi, '');
    t = t.trim();
    t = t.replace(/^(?:aquí|acá) (?:tenés|tienes|va)[^\n:]*:\s*/i, '');
    t = t.replace(/^(?:nota|comentario|instrucci[óo]n|resultado)\s*:\s*/i, '');
    t = t.trim();
    // Solo si envuelven TODO: unas comillas en el medio son del editor.
    const envuelto = /^(["“'«])([\s\S]*)(["”'»])$/.exec(t);
    if (envuelto && !envuelto[2].includes('\n\n')) t = envuelto[2].trim();
    return t.trim();
}

function palabras(texto) {
    return String(texto || '').trim().split(/\s+/).filter(Boolean).length;
}

/**
 * ¿Se puede poner esto en el campo del editor?
 *
 * El orden importa. La negativa se mira ANTES que el tamaño: "No puedo ayudarte
 * con eso" son cinco palabras contra cuarenta, así que la medida de tamaño lo
 * agarra igual, pero le diría al editor que el refinado se comió su pedido
 * cuando el problema es que el modelo se negó. El motivo correcto vale más que
 * el rechazo.
 */
function verificar(refinado, original) {
    const r = palabras(refinado);
    const c = palabras(original);
    if (!r) return { ok: false, motivo: 'el modelo devolvió un texto vacío' };

    if (/^(no puedo|lo siento|como (?:modelo|asistente|ia)\b|i (?:can(?:'|no)t|am unable))/i.test(String(refinado).trim())) {
        return { ok: false, motivo: 'el modelo contestó en vez de reescribir' };
    }

    // Las menciones tienen que volver TODAS y con el nombre intacto. Es el modo
    // de falla más caro porque no se ve: una mención comida deja la nota
    // hablando de "el logo" sin decir cuál, y una reescrita a medias
    // (`@[curso/logo]` sin la extensión) llega como texto suelto y el cambio
    // sale sin la marca.
    const faltan = menciones.perdidas(refinado, original);
    if (faltan.length) {
        return {
            ok: false,
            motivo: `se perdió la referencia ${faltan.join(' y ')}: queda el texto original, que sí la tiene`
        };
    }

    // Un comentario corto se puede reescribir en menos palabras sin perder nada
    // ("que esto dure más" → "alargar esto"), así que el piso solo se aplica de
    // ocho palabras para arriba.
    if (c >= 8 && r < Math.ceil(c * 0.35)) {
        return { ok: false, motivo: `el modelo resumió de ${c} palabras a ${r} y eso pierde cosas` };
    }
    if (c >= 8 && r > c * 3 + 20) {
        return { ok: false, motivo: `el modelo escribió de más (${c} palabras a ${r}): eso es inventar` };
    }
    return { ok: true, motivo: null };
}

/**
 * El pedido de refinar, tal como lo ve el modelo.
 *
 * Lo dictado y lo que ya estaba escrito viajan marcados y separados, no
 * pegados: el modelo tiene que poder distinguirlos para fundirlos en una idea
 * sola en vez de tratar al segundo como una corrección del primero.
 */
function pedidoRefinar({ texto, dictado, origen }) {
    if (origen === 'dictado' && texto) {
        return [
            'YA ESTABA ESCRITO EN EL CAMPO:',
            texto,
            '',
            'Y ACABA DE DICTAR:',
            dictado,
            '',
            'Las dos cosas son el mismo pedido. Fundilas en UNA nota.'
        ].join('\n');
    }
    if (origen === 'dictado') return `DICTADO:\n${dictado}`;
    return `ESCRITO A MANO (no viene de un micrófono, así que la puntuación es la que quiso):\n${texto}`;
}

/**
 * Refina un comentario. Nunca lanza.
 *
 * Qué pasa cuando falla depende de de dónde venía el texto, y es la misma
 * distinción que hace HyperPremiere: un dictado se puede pisar con el crudo,
 * porque el crudo es lo que acababa de entrar; un párrafo que alguien escribió
 * con las manos no se pisa con nada. Por eso acá siempre se devuelve el
 * original en `texto` cuando no pasó la verificación, y quien llama decide.
 */
async function refinar(config, entrada) {
    const original = entrada.origen === 'dictado'
        ? [entrada.texto, entrada.dictado].filter(Boolean).join('\n')
        : entrada.texto;

    if (!String(original || '').trim()) {
        return { ok: false, texto: entrada.texto || '', motivo: 'no hay nada escrito' };
    }

    let respuesta;
    try {
        respuesta = await llm.preguntar(config, {
            sistema: SISTEMA_REFINAR,
            usuario: pedidoRefinar(entrada)
        });
    } catch (e) {
        return { ok: false, texto: original, motivo: e.message };
    }

    const limpio = limpiar(respuesta.texto);
    const control = verificar(limpio, original);
    if (!control.ok) {
        return { ok: false, texto: original, motivo: control.motivo, modelo: respuesta.modelo, ms: respuesta.ms };
    }
    return { ok: true, texto: limpio, crudo: original, modelo: respuesta.modelo, ms: respuesta.ms };
}

/**
 * Los comentarios escritos como se los pasa al modelo para consolidarlos.
 *
 * Cada uno con su id y su momento ya formateado: el modelo no convierte tiempos
 * —ahí es donde se equivoca— sino que copia el que se le da.
 */
function comentariosComoTexto(datos) {
    return datos.comentarios
        .filter(c => c.estado === 'abierto')
        .map(c => {
            const cuando = c.tHasta
                ? `${tiempo.timecode(c.t, datos.fps)} → ${tiempo.timecode(c.tHasta, datos.fps)}`
                : tiempo.timecode(c.t, datos.fps);
            const conDibujo = c.dibujo ? ' [tiene un dibujo del editor sobre el cuadro]' : '';
            return `(${c.id}) ${cuando}${conDibujo}\n${c.texto.trim()}`;
        })
        .join('\n\n');
}

/**
 * «Preparar para Claude»: todos los comentarios, como un encargo.
 *
 * Es un agregado y no un requisito: el `feedback.md` siempre lleva la lista de
 * comentarios tal cual, así que sirve igual si este botón no se aprieta nunca.
 * Lo que agrega es el orden —qué conviene hacer antes— y juntar lo que son dos
 * comentarios del mismo cambio.
 */
async function prepararInstruccion(config, datos, contexto) {
    const abiertos = datos.comentarios.filter(c => c.estado === 'abierto');
    if (!abiertos.length) {
        return { ok: false, motivo: 'no hay comentarios por hacer' };
    }

    const ctx = contexto || {};
    const partes = [];
    partes.push(`VIDEO: ${ctx.clase || datos.video} (versión ${ctx.numeroVersion || 1})`);
    if (ctx.general && ctx.general.trim()) {
        partes.push('', 'LO QUE VALE PARA TODAS LAS CLASES DEL CURSO (es la base; un comentario que');
        partes.push('diga algo distinto le gana en ESO y nada más):', ctx.general.trim());
    }
    partes.push('', `COMENTARIOS DEL EDITOR SOBRE ESTE VIDEO (${abiertos.length}):`, '', comentariosComoTexto(datos));

    let respuesta;
    try {
        respuesta = await llm.preguntar(config, {
            sistema: SISTEMA_INSTRUCCION,
            usuario: partes.join('\n')
        }, { maxTokens: 1600 });
    } catch (e) {
        return { ok: false, motivo: e.message };
    }

    const limpio = limpiar(respuesta.texto);
    if (!limpio) return { ok: false, motivo: 'el modelo devolvió un texto vacío', modelo: respuesta.modelo };

    // Los ids tienen que estar: sin ellos el encargo no se puede volver a atar a
    // los momentos del video, que es la mitad de para qué sirve.
    const citados = new Set((limpio.match(/\bc\d{2}\b/g) || []));
    const sinCitar = abiertos.filter(c => !citados.has(c.id)).map(c => c.id);
    if (sinCitar.length > Math.ceil(abiertos.length / 2)) {
        return {
            ok: false,
            motivo: `el modelo se olvidó de ${sinCitar.length} de ${abiertos.length} comentarios`,
            modelo: respuesta.modelo
        };
    }

    return {
        ok: true,
        texto: limpio,
        modelo: respuesta.modelo,
        ms: respuesta.ms,
        // Se dice aunque haya pasado: que falte uno de ocho es aceptable y el
        // editor tiene que poder verlo antes de mandárselo a Claude.
        sinCitar
    };
}

module.exports = {
    SISTEMA_REFINAR,
    SISTEMA_INSTRUCCION,
    limpiar,
    palabras,
    verificar,
    pedidoRefinar,
    refinar,
    comentariosComoTexto,
    prepararInstruccion
};
