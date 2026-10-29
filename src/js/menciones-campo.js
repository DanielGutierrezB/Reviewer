'use strict';
/**
 * menciones-campo.js — Nombrar un archivo adentro del texto de un comentario,
 * desde el lado de la ventana.
 *
 * Acá vive solo lo que no toca el DOM, y está partido así a propósito: las
 * reglas difíciles de esto no son dibujar un chip sino los veinte casos raros
 * —dónde cae el token si el campo perdió el foco, cuándo un `@` NO tiene que
 * abrir el menú, qué pasa con un nombre con tildes—, y esos se fijan con tests
 * baratos si son funciones de string a string. El pegamento con el DOM queda
 * en `comentarios.js` y `redactor.js`, y es corto.
 *
 * **El número nunca se guarda.** Lo que viaja al disco es `@[adjunto/x.png]`;
 * `@2` es lo que se ve. La cuenta la hace `engine/adjuntos.tira` y llega hecha,
 * porque una segunda cuenta de este lado es cómo se consigue que la tarjeta
 * diga «2» y el `feedback.md` resuelva a otra cosa.
 *
 * **DEUDA: para el BORRADOR esa cuenta se hace dos veces.** Mientras se
 * redacta no hay nada en el disco, así que el motor no puede ver lo que va a
 * llevar el comentario y `src/js/adjuntos.tiraBorrador()` vuelve a numerar por
 * su cuenta —más simple, porque en el borrador nada puede faltar—. Hoy las dos
 * coinciden y las dos están comentadas, y el modo de falla solo aparece si
 * alguien cambia el ORDEN en una: ahí el número que el editor teclea con `@`
 * sale de una implementación y el que resuelve el `feedback.md` sale de la
 * otra. El movimiento, cuando toque: sacar de `engine/adjuntos.tira` una
 * función pura `numerar(items)` que reciba los descriptores ya armados y
 * devuelva número + token + etiqueta, y que las dos la llamen. Necesita un
 * lugar que puedan importar los dos lados, y `engine/` no sirve porque la
 * ventana no tiene `require`: es el único pendiente que pide una decisión de
 * estructura nueva, y por eso no entró con el resto.
 */

/** El mismo de `engine/menciones.js`. Si uno cambia, cambian los dos. */
export const RE_MENCION = /@\[([^[\]\n]{1,200})\]/g;

/** Cuántos caracteres hacia atrás se busca el `@` que abrió el menú. */
const ALCANCE_ARROBA = 60;

/**
 * El texto partido en pedazos de texto plano y menciones.
 *
 * Es la mitad de ida del viaje que arreglaba el bug: `partir` arma los chips y
 * `unir` los vuelve a convertir en el string que se guarda. Que las dos estén
 * acá al lado y tengan un test de ida y vuelta es lo que impide que alguien
 * cambie cómo se dibuja un chip y se lleve puesto el guardado sin enterarse.
 */
export function partir(texto) {
    const partes = [];
    const re = new RegExp(RE_MENCION.source, 'g');
    let ultimo = 0;
    let m;
    while ((m = re.exec(String(texto == null ? '' : texto))) !== null) {
        if (m.index > ultimo) partes.push({ texto: texto.slice(ultimo, m.index) });
        partes.push({ token: m[0], crudo: m[1] });
        ultimo = m.index + m[0].length;
    }
    const cola = String(texto == null ? '' : texto).slice(ultimo);
    if (cola) partes.push({ texto: cola });
    return partes;
}

/** La vuelta: los pedazos otra vez como el string que se guarda. */
export function unir(partes) {
    return (partes || []).map(p => (p.token != null ? p.token : (p.texto || ''))).join('');
}

/**
 * Cómo se ve una mención en el campo.
 *
 * Con la tira del comentario delante, un adjunto se ve como su número (`@2`),
 * que es lo que pidió el editor y lo que deja el campo legible con tres
 * referencias en una frase. Lo que NO está en la tira se muestra con el nombre
 * entero: una referencia del curso porque no tiene número en esta tarjeta, y
 * una colgada porque lo que hay que hacer con ella es volver a adjuntar ese
 * archivo, y un «@?» no diría cuál.
 */
export function etiquetaDe(crudo, tira) {
    const item = (tira || []).find(i => i.token === `@[${crudo}]`);
    if (item) return item.etiqueta;
    return `@${crudo.includes('/') ? crudo.slice(crudo.indexOf('/') + 1) : crudo}`;
}

/** Si una mención apunta a algo que está. Decide el color del chip. */
export function estaColgada(crudo, tira, referencias) {
    if ((tira || []).some(i => i.token === `@[${crudo}]` && !i.falta)) return false;
    const nombre = crudo.includes('/') ? crudo.slice(crudo.indexOf('/') + 1) : crudo;
    return !(referencias || []).some(r => !r.falta && (r.nombre === nombre || r.nombre === crudo));
}

/**
 * Qué espacios hay que poner alrededor de un token, según lo que lo rodea.
 *
 * Los espacios se ponen a mano y no con un `trim`: hace falta uno a la
 * izquierda si lo de antes no terminaba en espacio —si no queda «el logo@[…]»—
 * y uno a la derecha solo si lo que sigue no es ya un espacio ni un signo de
 * puntuación, porque «@[…] ,» con el espacio metido a la fuerza es peor que
 * sin él.
 *
 * Está suelta y no adentro de `insertar` porque la misma decisión hace falta
 * en los dos campos y los dos trabajan distinto: el redactor tiene un
 * `<textarea>` y parte el string, y las tarjetas tienen un campo con chips
 * adentro y preguntan con dos `Range` —pero `rango.toString()` también
 * devuelve texto plano, así que la regla es la misma—. Estaba escrita dos
 * veces, con estos dos regex copiados a mano, y el modo de falla era agregarle
 * el `?` a la puntuación en un solo lado.
 */
export function espacios(antes, despues) {
    return {
        izq: antes && !/\s$/.test(antes) ? ' ' : '',
        der: despues && !/^[\s.,;:)\]]/.test(despues) ? ' ' : ''
    };
}

/** Mete un token en el texto, en una posición, y dice dónde queda el cursor. */
export function insertar(texto, posicion, token) {
    const base = String(texto == null ? '' : texto);
    const i = Math.max(0, Math.min(base.length, Number(posicion) || 0));
    const antes = base.slice(0, i);
    const despues = base.slice(i);
    const { izq, der } = espacios(antes, despues);
    return {
        texto: `${antes}${izq}${token}${der}${despues}`,
        cursor: (antes + izq + token + der).length
    };
}

/**
 * Dónde cae un token cuando el editor tocó una miniatura.
 *
 * Para tocar la miniatura hay que sacarle el foco al campo, así que para
 * cuando llega el clic `selectionStart` ya no dice nada útil: se usa el cursor
 * que quedó anotado en el último `blur`. Y si el campo nunca se tocó, el token
 * va **al final**, nunca al principio: el caso más común es leer una tarjeta
 * vieja y tocarle la miniatura, y meter la referencia antes de la primera
 * palabra parte la frase que ya estaba escrita.
 */
export function dondeCae(largo, recordado) {
    return Number.isFinite(recordado) && recordado >= 0 ? Math.min(recordado, largo) : largo;
}

// ─── El menú del `@` ──────────────────────────────────────────────────

/** Un texto sin tildes ni mayúsculas, para buscar por «otono» una «Otoño». */
export function plegar(texto) {
    return String(texto == null ? '' : texto)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
}

/**
 * Si el cursor está escribiendo una consulta después de un `@`.
 *
 * Dos reglas, las dos con su motivo:
 *
 * - **El `@` tiene que estar al principio o después de un espacio.** Sin esto,
 *   cada `dani@nova.com` que alguien escriba abre un menú de referencias.
 * - **Lo tecleado después no puede tener espacios ni corchetes.** Sin esto, el
 *   menú se reabre adentro de un `@[adjunto/…]` que ya estaba escrito, y
 *   elegir ahí dejaría un token adentro de otro.
 *
 * Se busca hasta 60 caracteres hacia atrás y no más: un `@` de diez palabras
 * antes no tiene nada que ver con lo que se está escribiendo ahora.
 */
export function disparo(texto, cursor) {
    const base = String(texto == null ? '' : texto);
    const i = Math.max(0, Math.min(base.length, Number(cursor) || 0));
    const desde = Math.max(0, i - ALCANCE_ARROBA);
    const arroba = base.lastIndexOf('@', i - 1);
    if (arroba < desde) return null;

    const anterior = arroba > 0 ? base[arroba - 1] : '';
    if (anterior && !/\s/.test(anterior)) return null;

    const consulta = base.slice(arroba + 1, i);
    if (/[\s[\]]/.test(consulta)) return null;

    return { desde: arroba, hasta: i, consulta };
}

/**
 * Qué referencias ofrece el menú para una consulta.
 *
 * **Una consulta de solo dígitos empareja por número.** Es lo que hace que
 * `@2` + Enter sea el camino rápido sin que `@2` sea una sintaxis: lo tecleado
 * se reemplaza entero por el token con el nombre, así que el editor escribe lo
 * que piensa («la 2») y lo que queda guardado sobrevive a que la lista se
 * mueva. Si en cambio guardáramos el `@2`, borrar el adjunto de arriba haría
 * que el comentario pasara a hablar de otro archivo, y nada fallaría.
 */
export function candidatos(items, consulta) {
    const q = plegar(consulta).trim();
    if (!q) return items.slice();
    if (/^\d+$/.test(q)) return items.filter(i => String(i.numero) === q);
    return items.filter(i => plegar(i.nombre).includes(q));
}
