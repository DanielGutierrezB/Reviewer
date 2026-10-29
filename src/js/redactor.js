'use strict';
/**
 * redactor.js — Escribir un comentario nuevo, en el panel y no sobre el video.
 *
 * Empezó siendo una caja que se abría centrada encima del reproductor y se fue
 * por lo que pasa a los diez segundos de usarla: uno abre la caja para describir
 * algo, se da cuenta de que señalarlo es más rápido que contarlo, y el video
 * está tapado por la caja. Describir y señalar son el mismo gesto partido en
 * dos, y la interfaz tiene que dejar hacer los dos a la vez.
 *
 * Acá adentro el redactor es una tarjeta más de la columna —el mismo ancho, el
 * mismo recuadro— que aparece arriba de las que ya están. El video queda entero
 * y se puede dibujar encima mientras se escribe: cada trazo se anota solo en
 * «con el dibujo encima».
 *
 * **Con el panel de la derecha plegado (⌘E) la caja se muda a una franja encima
 * de la línea de tiempo**, y sigue siendo esta misma: el nodo se mueve de padre
 * y lo acuesta el CSS (ver `paneles.js` y la sección compacta de
 * `comentarios.css`). No hay un segundo redactor, y no puede haberlo: dos cajas
 * capaces de tener texto distinto para el mismo comentario es el peor resultado
 * posible, porque la que pierde se guarda sin que nadie haya escrito eso. Por lo
 * mismo, todo lo de acá abajo —`sesion`, el cursor recordado, los adjuntos del
 * borrador— no sabe en qué lado de la pantalla está dibujado, y no tiene que
 * saberlo.
 *
 * **El cuadro se captura explícitamente.** Hay una casilla con la miniatura de
 * lo que se va a guardar y el timecode debajo, en vez de que el cuadro aparezca
 * después sin que nadie lo haya pedido. Es la diferencia entre adjuntar algo y
 * descubrir que la app adjuntó algo.
 */

import { $ } from './chrome.js';
import { estado, fps } from './estado.js';
import * as fmt from './formato.js';
import * as reproductor from './reproductor.js';
import * as dibujo from './dibujo.js';
import * as dictado from './dictado.js';
import * as adjuntos from './adjuntos.js';
import * as campoMenciones from './menciones-campo.js';
import * as menu from './menu-arroba.js';
import * as paneles from './paneles.js';

/** Quien escucha. Lo pone `app.js`. */
export const al = { guardar: () => {} };

const sesion = {
    abierto: false,
    t: 0,
    tHasta: null
};

/**
 * Dónde quedó el cursor la última vez que el campo lo tuvo.
 *
 * `null` quiere decir «nunca se tocó», y entonces una mención va al FINAL del
 * texto y no al principio: el caso típico es dictar la frase entera y después
 * tocar la miniatura, y meter la referencia antes de la primera palabra parte
 * lo que ya estaba escrito.
 */
let cursorRecordado = null;

export function abierto() {
    return sesion.abierto;
}

export function cuando() {
    return { t: sesion.t, tHasta: sesion.tHasta };
}

/**
 * Lo que el menú del `@` ofrece mientras se redacta: la tira del borrador.
 *
 * **DEUDA: estas tres líneas son una copia de `estadoDelBorrador()`**, la
 * privada de `src/js/adjuntos.js` que lee del DOM lo mismo —los mismos tres
 * ids, incluido el `&& !$('#adjunto-dibujo').hidden`, que no es obvio—. Hoy
 * los dos números coinciden de casualidad; el día que la condición cambie de
 * un lado, el menú del `@` va a ofrecer «3» para lo que el badge de la tarjeta
 * dice «2», que es exactamente el modo de falla que toda la numeración vino a
 * matar, y que ni `engine/adjuntos.tira` ni `adjuntos.tiraBorrador` pueden
 * detectar porque las dos reciben el descriptor ya armado.
 *
 * El movimiento es chico: exportar `estadoDelBorrador` desde
 * `src/js/adjuntos.js` y llamarla desde acá. La única diferencia real entre
 * los dos usos es `cuadroUrl`, que el menú no necesita, y eso se resuelve
 * ignorándolo. No se hizo en esta pasada porque `src/js/adjuntos.js` lo estaba
 * reescribiendo otro cambio a la vez.
 */
export function candidatosDelBorrador() {
    return adjuntos.tiraBorrador({
        conCuadro: $('#redactor-cuadro').checked,
        conDibujo: $('#redactor-dibujo').checked && !$('#adjunto-dibujo').hidden,
        cuadroUrl: null
    }).map(i => ({ ...i, detalle: i.uso ? (adjuntos.usos()[i.uso] || {}).corto : 'de este comentario' }));
}

/** Mete el token elegido en el menú, reemplazando lo que se tecleó (`@2`). */
export function elegirDelMenu(item, donde) {
    const campo = $('#redactor-texto');
    const sinConsulta = campo.value.slice(0, donde.desde) + campo.value.slice(donde.hasta);
    const r = campoMenciones.insertar(sinConsulta, donde.desde, item.token);
    campo.value = r.texto;
    campo.focus();
    campo.setSelectionRange(r.cursor, r.cursor);
    cursorRecordado = r.cursor;
}

/**
 * La miniatura de lo que se va a adjuntar, sacada del `<video>`.
 *
 * Es solo para mirar: el PNG que se guarda lo arma ffmpeg desde el archivo
 * original, a resolución completa y sin pasar por el proxy. Acá lo único que
 * importa es que el editor vea cuál es el cuadro antes de mandarlo.
 *
 * Puede salir en blanco —`drawImage` sobre un `<video>` devuelve transparente
 * cuando la ventana no está componiendo, sin tirar ningún error—, así que se
 * mira una esquina del resultado y, si no hay nada, se devuelve `null` y la
 * casilla se queda con el timecode solo. Una miniatura negra miente más que
 * ninguna miniatura.
 */
function miniatura() {
    const video = $('#video');
    if (!video.videoWidth) return null;
    try {
        const c = document.createElement('canvas');
        c.width = 192;
        c.height = Math.max(1, Math.round(192 * video.videoHeight / video.videoWidth));
        const ctx = c.getContext('2d');
        ctx.drawImage(video, 0, 0, c.width, c.height);
        if (!ctx.getImageData(0, 0, 1, 1).data[3]) return null;
        return c.toDataURL('image/jpeg', 0.7);
    } catch (e) {
        return null;
    }
}

/** Repinta las dos casillas de adjuntos con lo que hay ahora mismo. */
export function pintarAdjuntos() {
    if (!sesion.abierto) return;

    const mini = $('#redactor-cuadro-mini');
    const url = miniatura();
    mini.hidden = !url;
    if (url) mini.src = url;
    $('#redactor-cuadro-pie').textContent = fmt.timecode(sesion.t, fps());

    const hay = dibujo.hayTrazos();
    $('#adjunto-dibujo').hidden = !hay;
    if (hay) {
        const n = dibujo.cuantos();
        $('#redactor-dibujo-pie').textContent = n === 1 ? '1 trazo' : `${n} trazos`;
    } else {
        // Si se limpió el dibujo, la casilla vuelve tildada para la próxima: el
        // estado apagado era de un dibujo que ya no existe.
        $('#redactor-dibujo').checked = true;
    }

    // La tira numerada cuenta el cuadro y el dibujo, así que destildar una
    // casilla corre los números de los adjuntos que siguen. Tiene que
    // repintarse acá o el badge diría «3» para lo que ya es «2».
    adjuntos.pintarBorrador();
}

/**
 * Abre el redactor en un momento del video.
 *
 * **Si ya estaba abierto, no se vacía: se mueve.** Antes esto limpiaba el
 * campo siempre, así que apretar dos veces la tecla de comentar borraba lo que
 * uno llevaba escrito. Con `m` y `c` pasaba desapercibido; con la `i` —que es
 * mucho más fácil de repetir sin querer— se nota, y desde que el redactor
 * también lleva archivos pegados adentro, lo que se pierde ya no es una frase
 * sino una frase más tres adjuntos que hay que volver a buscar.
 *
 * Se eligió **conservar** y no «no hacer nada» porque las dos teclas tienen un
 * segundo trabajo además de abrir: `abrir({t, tHasta})` es también como la `O`
 * le pone la salida a un comentario que se está escribiendo. Si una segunda
 * llamada no hiciera nada, cerrar un tramo sobre el redactor abierto dejaría de
 * funcionar. Mover el momento y dejar el texto hace las dos cosas bien.
 *
 * Lo que sí se respeta es que un redactor NUEVO empieza limpio: lo que no se
 * hereda de un comentario al siguiente son los adjuntos, y por eso `cerrar`
 * vacía el borrador y esto no.
 */
export function abrir(donde) {
    if (!estado.version) return;
    reproductor.pausar();

    const seguia = sesion.abierto;
    const rango = donde || (reproductor.rangoHecho()
        ? { t: estado.rango.desde, tHasta: estado.rango.hasta }
        : { t: reproductor.tiempo(), tHasta: null });

    sesion.abierto = true;
    sesion.t = rango.t;
    sesion.tHasta = rango.tHasta;

    $('#redactor-cuando').textContent = sesion.tHasta
        ? `${fmt.timecode(sesion.t, fps())} → ${fmt.timecode(sesion.tHasta, fps())}`
        : fmt.timecode(sesion.t, fps());

    if (!seguia) {
        $('#redactor-texto').value = '';
        $('#redactor-cuadro').checked = true;
        $('#redactor-dibujo').checked = true;
        // Los archivos del comentario anterior no se heredan: adjuntar el logo
        // a un comentario y encontrárselo colgado del siguiente es peor que
        // tener que volver a soltarlo, porque se guardaría sin que nadie lo mire.
        adjuntos.vaciarBorrador();
        dictado.decir('redactor', '');
        $('[data-volver="redactor"]').hidden = true;
        cursorRecordado = null;
    }
    adjuntos.pintarBorrador();
    // En qué lado de la pantalla se dibuja lo decide `paneles.js`, y se decide
    // ANTES de mostrarlo: al revés se vería aparecer en el panel y saltar a la
    // franja de abajo en el mismo gesto.
    paneles.ubicarRedactor();
    $('#redactor').hidden = false;
    pintarAdjuntos();

    // Al panel y no a la tarjeta: con el redactor abierto arriba de la lista,
    // en una versión con quince comentarios podría quedar fuera de la vista.
    $('#redactor').scrollIntoView({ block: 'nearest' });
    $('#redactor-texto').focus();
}

export async function cerrar() {
    if (!sesion.abierto) return;
    if (dictado.oyendo()) await dictado.parar();
    sesion.abierto = false;
    adjuntos.vaciarBorrador();
    $('#redactor').hidden = true;
    // Y la franja de la línea de tiempo se va con él: una franja vacía le
    // seguiría robando alto a la imagen para no mostrar nada.
    paneles.ubicarRedactor();
}

/** Suma archivos al comentario que se está escribiendo, y lo dice. */
export function recibir(entradas) {
    const cuantos = adjuntos.sumarAlBorrador(entradas);
    if (!cuantos) return 0;
    dictado.decir('redactor', cuantos === 1
        ? 'Un archivo más. Decí abajo si es para mirar o para usar.'
        : `${cuantos} archivos más. Decí abajo cuál es para mirar y cuál para usar.`);
    return cuantos;
}

/**
 * Lo que hay que guardar, o `null` si falta el texto.
 *
 * El PNG del dibujo se compone ACÁ y no después de cerrar: los trazos salen de
 * la pizarra, y si el editor sigue dibujando mientras se escribe el archivo, el
 * dibujo guardado no sería el que estaba cuando apretó Comentar.
 */
export async function recoger() {
    const texto = $('#redactor-texto').value.trim();
    if (!texto) {
        dictado.decir('redactor', 'Escribí o dictá qué cambiar.', 'mal');
        $('#redactor-texto').focus();
        return null;
    }

    const conDibujo = dibujo.hayTrazos() && $('#redactor-dibujo').checked;
    return {
        t: sesion.t,
        tHasta: sesion.tHasta,
        texto,
        trazos: conDibujo ? dibujo.trazos() : null,
        adjuntos: adjuntos.recogerBorrador(),
        conCuadro: $('#redactor-cuadro').checked,
        png: conDibujo ? await dibujo.componer(estado.version.media.ancho, estado.version.media.alto) : null
    };
}

export function wire() {
    $('#redactor-cerrar').addEventListener('click', cerrar);
    $('#redactor-cancelar').addEventListener('click', cerrar);
    $('#redactor-guardar').addEventListener('click', () => al.guardar());

    adjuntos.wire();

    // Tocar un cuadrito de la tira nombra ese archivo en el texto.
    //
    // Acá el campo es un `<textarea>`, así que la inserción es aritmética de
    // string y no de nodos: `selectionStart` existe y dice la verdad. La
    // diferencia con la tarjeta —que tiene chips adentro y necesita rangos—
    // es la que justifica que la parte difícil viva en `menciones-campo.js`
    // como función pura y no duplicada en los dos lados.
    $('#redactor-tira').addEventListener('click', evento => {
        const boton = evento.target.closest('[data-accion="nombrar"]');
        if (!boton) return;
        const campo = $('#redactor-texto');
        const donde = document.activeElement === campo
            ? campo.selectionStart
            : campoMenciones.dondeCae(campo.value.length, cursorRecordado);
        const r = campoMenciones.insertar(campo.value, donde, boton.dataset.token);
        campo.value = r.texto;
        campo.focus();
        campo.setSelectionRange(r.cursor, r.cursor);
        cursorRecordado = r.cursor;
    });

    // Dónde había quedado el cursor: para tocar un cuadrito hay que sacarle el
    // foco al campo, y para entonces `selectionStart` ya no dice nada útil.
    for (const cual of ['keyup', 'mouseup', 'blur']) {
        $('#redactor-texto').addEventListener(cual, () => {
            cursorRecordado = $('#redactor-texto').selectionStart;
        });
    }

    // Soltar sobre CUALQUIER punto del redactor, no solo sobre la caja de
    // archivos: uno suelta donde está mirando, y donde está mirando es el campo
    // de texto que estaba escribiendo.
    adjuntos.zonaDeSoltar($('#redactor'), entradas => recibir(entradas));

    /**
     * ⌘V adentro del campo de texto.
     *
     * Solo se corta el pegado si del portapapeles salió una imagen. Pegar texto
     * tiene que seguir funcionando como siempre —una ruta copiada del Finder,
     * un párrafo del guion— y un `preventDefault` incondicional convertiría el
     * ⌘V de todos los días en un botón que no hace nada.
     *
     * El `preventDefault` va antes del `await`: después, el navegador ya pegó.
     * Por eso se mira `items` sincrónicamente y recién ahí se lee el archivo.
     */
    $('#redactor-texto').addEventListener('paste', async e => {
        const hayImagen = [...(e.clipboardData.items || [])]
            .some(i => i.kind === 'file' && /^image\//.test(i.type || ''));
        if (!hayImagen) return;
        e.preventDefault();
        recibir(await adjuntos.delPortapapeles(e.clipboardData));
    });

    // Sin cuadro no hay dónde pegar el dibujo: las dos casillas se mueven
    // juntas en ese sentido y no en el otro.
    $('#redactor-cuadro').addEventListener('change', e => {
        if (!e.target.checked) $('#redactor-dibujo').checked = false;
        pintarAdjuntos();
    });
    $('#redactor-dibujo').addEventListener('change', e => {
        if (e.target.checked) $('#redactor-cuadro').checked = true;
        pintarAdjuntos();
    });

    // El menú del `@`. `keydown` primero para que las flechas y el Enter sean
    // del menú mientras está abierto, y `input` después para repintarlo con lo
    // que se va tecleando.
    $('#redactor-texto').addEventListener('keydown', e => {
        if (menu.teclas(e)) {
            e.preventDefault();
            e.stopPropagation();
            return;
        }
        // Cmd+Enter guarda desde adentro del campo: Enter solo es un renglón
        // nuevo, que en un comentario de tres líneas hace falta.
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            al.guardar();
        }
    });
    for (const cual of ['input', 'click', 'keyup']) {
        $('#redactor-texto').addEventListener(cual, () => menu.revisar($('#redactor-texto')));
    }
    $('#redactor-texto').addEventListener('blur', () => menu.cerrar());
}
