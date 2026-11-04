'use strict';
/**
 * encargo.js — El resumen ordenado de los comentarios de una versión, y cuándo
 * todavía vale.
 *
 * El encargo lo escribe el modelo local al exportar: lee los comentarios
 * abiertos de una versión y los devuelve como una lista de trabajo ordenada,
 * que va arriba de esa clase en el `FEEDBACK.md`. Los comentarios siguen yendo
 * debajo, tal cual: el encargo agrega orden, no reemplaza nada.
 *
 * El problema que resuelve este archivo es uno solo: **un encargo viejo miente
 * sin que se note.** Si después de armarlo se agregó un comentario, se editó
 * otro o cambió el texto general del curso, el encargo sigue pareciendo un
 * resumen completo y ya no lo es. Por eso cada encargo guarda una huella de lo
 * que leyó el modelo, y se usa —en el export, en el `feedback.md` y en el
 * panel— solo si esa huella coincide con la de ahora. Si no coincide, para
 * todos lados es como si no hubiera encargo, y el próximo export lo rehace.
 *
 * Está aparte de `prompts.js` porque lo usa también `feedback.js`, que escribe
 * el markdown en cada guardado y no tiene por qué cargar el cliente del modelo.
 */

const crypto = require('crypto');

const adjuntos = require('./adjuntos');
const tiempo = require('./tiempo');

/**
 * Los comentarios abiertos tal como se los pasa al modelo.
 *
 * Cada uno con su id y su momento ya formateado: el modelo no convierte tiempos
 * —ahí es donde se equivoca— sino que copia el que se le da.
 *
 * Es también la base de la huella, y no por comodidad: el encargo sigue
 * valiendo exactamente mientras el modelo leería lo mismo. Un cambio que no
 * pasa por acá —resolver un comentario ya resuelto, mover un archivo de
 * carpeta— no lo invalida, y no tiene por qué.
 */
function comentariosComoTexto(datos) {
    return datos.comentarios
        .filter(c => c.estado === 'abierto')
        .map(c => {
            const cuando = c.tHasta
                ? `${tiempo.timecode(c.t, datos.fps)} → ${tiempo.timecode(c.tHasta, datos.fps)}`
                : tiempo.timecode(c.t, datos.fps);
            const conDibujo = c.dibujo ? ' [tiene un dibujo del editor sobre el cuadro]' : '';
            // Los adjuntos entran al resumen diciendo para qué son, no solo que
            // existen. El encargo es lo primero que se lee, y un «viene con un
            // archivo» ahí arriba, sin decir si es para mirar o para usar, hace
            // exactamente el daño que la función evita: el modelo decide solo
            // antes de llegar a la lista de abajo.
            const conArchivos = (c.adjuntos || [])
                .map(a => ` [${adjuntos.uso(a.uso).titulo}: «${a.nombre}»]`)
                .join('');
            return `(${c.id}) ${cuando}${conDibujo}${conArchivos}\n${c.texto.trim()}`;
        })
        .join('\n\n');
}

/**
 * De qué está hecho un encargo: los comentarios que leyó y el texto general.
 *
 * El texto general entra porque el modelo también lo lee, y un encargo armado
 * con «los títulos en mayúscula» no sirve el día que el general dice lo
 * contrario.
 */
function huellaDe(datos, general) {
    const leido = `${String(general || '').trim()}\n---\n${comentariosComoTexto(datos)}`;
    return crypto.createHash('sha1').update(leido).digest('hex');
}

/** Si el encargo guardado todavía resume lo que hay. */
function vigente(datos, general) {
    const inst = datos && datos.instruccion;
    return Boolean(inst && inst.texto && inst.huella && inst.huella === huellaDe(datos, general));
}

module.exports = { comentariosComoTexto, huellaDe, vigente };
