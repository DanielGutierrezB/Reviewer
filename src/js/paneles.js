'use strict';
/**
 * paneles.js — Plegar las dos columnas de los costados para que quede el video
 * y nada más.
 *
 * Revisar un render tiene dos momentos distintos y la pantalla de tres columnas
 * solo sirve para uno. Mientras se escribe el feedback hace falta todo: la lista
 * de clases para saltar de una a otra y la columna de comentarios para ver los
 * que ya están. Pero la primera pasada —mirar si el corte entra bien, si el
 * título se lee— es mirar, y ahí las dos columnas se llevan 608 px de ancho para
 * mostrar cosas que en ese momento no se usan.
 *
 * `⌘S` esconde las clases y `⌘E` los comentarios, cada una por su lado, y la
 * misma tecla las trae de vuelta.
 *
 * **Las teclas son con ⌘ y no letras sueltas** porque las letras sueltas ya
 * están todas tomadas por el reproductor (`I`, `O`, `M`, `C`, `J`, `K`, `L`) y
 * porque esto tiene que poder hacerse mientras se escribe un comentario, que es
 * justo cuando las letras sueltas no pueden entrar.
 *
 * **`⌘S` no choca con nada, y conviene saber por qué antes de agregar un menú.**
 * En casi toda app ⌘S es «guardar»; acá no hay guardar —el `feedback.md` se
 * reescribe en cada cambio y no hay nada que confirmar— así que la tecla estaba
 * libre y es la que la mano busca cuando quiere «dejar la pantalla limpia». Hoy
 * la app no define ningún menú (`main.js` no llama a `Menu.setApplicationMenu`),
 * de modo que no hay ningún acelerador del sistema con el que competir. El día
 * que se agregue un menú con un ítem en ⌘S, el que lo agregue se va a enterar
 * acá: los dos atajos se registran en un solo lugar y este comentario es el
 * aviso.
 *
 * **Lo que NO puede pasar es quedar encerrado.** Con las dos columnas plegadas y
 * sin ninguna pista en pantalla, volver sería adivinar un atajo; por eso cada
 * columna plegada deja una franja de 16 px que es un botón —se ve, se toca y su
 * `title` dice la tecla—, y los dos galones de la cabecera del visor están
 * siempre a la vista para plegar con el mouse sin saber ninguna tecla.
 */

import { $ } from './chrome.js';
import { estado } from './estado.js';

/**
 * Quién escucha. Lo pone `app.js`.
 *
 * `redactorAbierto` lo contesta `redactor.js`, que es el que lleva la cuenta.
 * Se pregunta en vez de importarlo para no armar un ciclo: `redactor.js` ya
 * importa a este módulo, porque abrir un comentario es lo que decide dónde
 * tiene que estar la caja de texto.
 */
export const al = { redactorAbierto: () => false };

/** Si cada columna está a la vista. Arranca de `ajustes.json`. */
const sesion = {
    clases: true,
    comentarios: true
};

/**
 * Dónde se dibuja el redactor: adentro del panel o sobre la línea de tiempo.
 *
 * **Es el MISMO nodo en los dos lados.** No hay un segundo redactor compacto:
 * se mueve el `#redactor` de siempre de un padre al otro, así que lo escrito,
 * las dos casillas, los archivos pegados, la miniatura del cuadro y los
 * escuchadores de soltar archivos viajan con él porque son él. Dos redactores
 * en paralelo serían dos textos distintos para el mismo comentario, y el que
 * perdiera la carrera se guardaría sin que nadie lo haya escrito.
 *
 * Lo único que NO viaja con el nodo es el foco: el navegador lo suelta en
 * cuanto el campo deja de estar en la página, y mover un nodo que ya estaba
 * puesto es sacarlo y volverlo a poner. De devolverlo se encarga `aplicar`.
 */
export function ubicarRedactor() {
    const nodo = $('#redactor');
    const host = $('#redactor-compacto');
    if (!nodo || !host) return;

    const compacto = !sesion.comentarios;
    const destino = compacto ? host : $('.bloque-video .bloque-cuerpo');
    // En el panel va ANTES de la lista de comentarios, que es su sitio de
    // siempre: el borrador arriba de las tarjetas que ya están.
    const antes = compacto ? null : $('#comentarios');
    if (nodo.parentElement !== destino) destino.insertBefore(nodo, antes);

    // La franja de abajo solo existe cuando hay algo que redactar: vacía sería
    // una barra que le come alto al video para no decir nada.
    host.hidden = !(compacto && al.redactorAbierto());
}

/**
 * Pone en la pantalla lo que dice `sesion`, sin perder lo que se está
 * escribiendo.
 *
 * **Quién tiene el cursor se anota ANTES de tocar las clases**, y no es
 * prolijidad: `sin-panel` esconde por CSS todo lo que haya adentro de la
 * columna, y el redactor todavía está adentro cuando eso pasa. Un campo que
 * deja de estar a la vista pierde el foco en el acto, y mudarlo de padre lo
 * pierde otra vez, así que preguntarlo después de cualquiera de las dos cosas
 * contesta siempre «nadie». Pasó, y así se ve: ⌘E a mitad de una frase dejaba
 * la caja puesta, con el texto adentro y el cursor en ninguna parte, y la letra
 * siguiente se perdía.
 *
 * Para volver alcanza con `focus()`: la selección se la guarda el campo y
 * sobrevive al blur, así que el cursor reaparece entre las mismas dos letras.
 */
function aplicar() {
    const campo = $('#redactor-texto');
    const escribiendo = document.activeElement === campo;

    const vista = $('#vista-revision');
    vista.classList.toggle('sin-clases', !sesion.clases);
    vista.classList.toggle('sin-panel', !sesion.comentarios);

    // El `title` cambia con el estado porque es la única parte de la interfaz
    // que puede enseñar el atajo, y «Ocultar» cuando ya está oculto lo enseña
    // mal.
    $('#plegar-clases').title = sesion.clases
        ? 'Ocultar las clases (⌘S)'
        : 'Mostrar las clases (⌘S)';
    $('#plegar-panel').title = sesion.comentarios
        ? 'Ocultar los comentarios (⌘E)'
        : 'Mostrar los comentarios (⌘E)';

    ubicarRedactor();
    if (escribiendo) campo.focus();
}

async function recordar() {
    if (!estado.ajustes) return;
    estado.ajustes = await window.rv.ajustesParchear({
        paneles: { clases: sesion.clases, comentarios: sesion.comentarios }
    });
}

export function alternar(cual) {
    if (!(cual in sesion)) return;
    sesion[cual] = !sesion[cual];
    aplicar();
    recordar();
}

/**
 * `⌘S` y `⌘E`.
 *
 * **No respetan `enCampoDeTexto`, y es a propósito.** La guarda existe para que
 * escribir la palabra «idea» adentro de un comentario no abra otro comentario,
 * y eso solo pasa con letras sueltas: un ⌘S no deja ninguna letra en el campo,
 * así que no hay nada que proteger. Al revés, el caso que el editor pidió es
 * justamente ese —estar escribiendo y querer ver la imagen más grande—, y una
 * guarda acá convertiría el atajo en uno que funciona a veces, que es peor que
 * no tenerlo.
 *
 * **Solo ⌘, nunca Ctrl**, aunque el resto de la app acepte los dos. En macOS
 * `⌃E` es «al final del renglón» y `⌃A` «al principio» dentro de cualquier
 * campo de texto, y como esto corre también mientras se escribe, atajar `⌃E`
 * rompería el movimiento del cursor en la caja de comentarios para ganar un
 * atajo duplicado. Esta app es de macOS —se empaqueta en `.pkg` arm64 y guarda
 * en `Library/Application Support`—, así que no hay Windows donde ⌘ no exista.
 *
 * Con Shift tampoco: `⇧⌘S` es «guardar como» en todas partes y no hay por qué
 * quedarse con una combinación que nadie quiso para esto.
 */
export function teclas(evento) {
    if (!evento.metaKey || evento.altKey || evento.shiftKey) return false;
    if ($('#vista-revision').hidden) return false;

    const cual = { s: 'clases', e: 'comentarios' }[String(evento.key).toLowerCase()];
    if (!cual) return false;
    alternar(cual);
    return true;
}

/**
 * El canvas de dibujo, vuelto a medir cada vez que la imagen cambia de tamaño.
 *
 * Es la parte delicada de todo esto. El `<canvas>` se estira al 100 % del
 * lienzo por CSS, pero sus píxeles —`canvas.width` y `canvas.height`— son un
 * número que hay que escribir a mano, y es contra ese número que se pintan los
 * trazos. Plegar una columna ensancha la del medio, y la imagen cambia de
 * tamaño **sin que la ventana cambie de tamaño**: `dibujo.js` ya se remide solo
 * en el `resize` de la ventana, pero ese `resize` nunca llega.
 *
 * Conviene ser exacto con qué se rompe, porque la respuesta no es la que uno
 * teme. El trazo **no se corre de la imagen**: se guarda de 0 a 1 y el lienzo
 * tiene la proporción del render, así que el bitmap viejo se estira sobre la
 * caja nueva sin deformarse y el círculo sigue rodeando el logo. Lo que se
 * pierde es la resolución: queda el dibujo de 800 px agrandado a 1140, blando y
 * pastoso sobre una imagen nítida. Y el PNG que recibe Claude sale igual de
 * bien, porque `dibujo.componer` lo pinta a la resolución del render y no desde
 * la pantalla. O sea que esto es nitidez, no exactitud; se verificó midiendo
 * dónde cae la tinta antes y después de plegar, y cae en el mismo punto de la
 * imagen hasta la cuarta decimal.
 *
 * Igual se remide, y no es cosmético: un dibujo borroso encima de un cuadro
 * nítido se lee como que el trazo quedó mal puesto, y ese es justo el error que
 * el editor no puede tener que descartar a ojo cada vez que pliega un panel.
 *
 * Se mira el lienzo con un `ResizeObserver` y se le avisa con el mismo `resize`
 * que ya escucha, en vez de llamar a la medición desde cada sitio que pliega
 * algo. Dos razones: hay un solo camino para «volver a medir» —dos se
 * desincronizan el día que alguien agregue una tercera cosa que mueva el
 * video— y así quedan cubiertas también las causas que no son de acá, como la
 * franja del redactor compacto apareciendo abajo o la barra de arriba creciendo
 * un renglón.
 *
 * No hay bucle posible: lo único que cambia la medición son los píxeles del
 * canvas, y el canvas está `position: absolute; inset: 0`, así que no puede
 * mover al lienzo que lo contiene. Y lo otro que escucha ese `resize` —el menú
 * del `@`— se cierra, que es lo correcto: está anclado a mano debajo de un
 * campo que acaba de cambiar de lugar.
 */
function vigilarElLienzo() {
    new ResizeObserver(() => window.dispatchEvent(new Event('resize'))).observe($('#lienzo'));
}

export function wire() {
    const guardados = (estado.ajustes && estado.ajustes.paneles) || {};
    sesion.clases = guardados.clases !== false;
    sesion.comentarios = guardados.comentarios !== false;

    // Los dos galones de la cabecera y las dos franjas hacen lo mismo: el galón
    // está a la vista con la columna abierta y la franja con la columna
    // plegada, así que entre los dos siempre hay un botón para cada sentido.
    $('#plegar-clases').addEventListener('click', () => alternar('clases'));
    $('#plegar-panel').addEventListener('click', () => alternar('comentarios'));
    $('#franja-clases').addEventListener('click', () => alternar('clases'));
    $('#franja-panel').addEventListener('click', () => alternar('comentarios'));

    vigilarElLienzo();
    aplicar();
}
