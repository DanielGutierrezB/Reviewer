'use strict';
/**
 * pantalla.js — Mandar el video al otro monitor, o al iPad por Sidecar.
 *
 * Del lado de la ventana principal. La otra ventana es tonta a propósito (ver
 * `pantalla-ventana.js`): acá se decide qué mostrar y dónde está el cabezal, y
 * allá solo se muestra.
 *
 * **No se manda un cuadro por cuadro.** Mandar imagen sería copiar un 4K por el
 * puente sesenta veces por segundo; lo que viaja es la URL del render y un
 * número con el segundo donde va el cabezal. La otra ventana abre el MISMO
 * archivo por el mismo protocolo y se pone ahí. Barato y, además, la imagen
 * llega a resolución completa en vez de recomprimida.
 *
 * **El control solo aparece si hay otra pantalla.** Con Sidecar apagado, un
 * desplegable que no puede hacer nada es una promesa rota; con Sidecar prendido
 * aparece solo, porque el iPad entra al sistema como un monitor más.
 *
 * **Y es un desplegable y no un botón porque «la otra pantalla» no existe.**
 * Con un monitor vertical y el iPad por Sidecar enchufados a la vez hay dos
 * candidatas, y el botón de antes elegía la primera que encontraba: acertaba la
 * mitad de las veces y la otra mitad mandaba el render al monitor de parado.
 */

import { $, anotar, avisar } from './chrome.js';
import { estado } from './estado.js';
import * as dibujo from './dibujo.js';
import * as reproductor from './reproductor.js';
import * as redactor from './redactor.js';
import * as dictado from './dictado.js';

const sesion = {
    abierta: false,
    url: null,
    /** Las pantallas que hay AHORA, tal como las contó el proceso principal. */
    pantallas: [],
    /** El id de la que tiene el render, o null. */
    enId: null
};

export function abierta() {
    return sesion.abierta;
}

/** El `label` de la pantalla a la que se mandó el render la última vez. */
function recordada() {
    const p = estado.ajustes && estado.ajustes.pantalla;
    return (p && p.destino) || '';
}

async function recordar(etiqueta) {
    if (!estado.ajustes) return;
    estado.ajustes = await window.rv.ajustesParchear({ pantalla: { destino: etiqueta || '' } });
}

/**
 * Las que se pueden ofrecer: todas menos la que tiene la ventana de trabajo.
 *
 * Mandarle el render a la pantalla donde está Reviewer es un callejón sin
 * salida: la ventana secundaria va sin marco y por encima de todo, así que
 * taparía justo el desplegable que la apaga. La salida más barata es no
 * ofrecerla; así no hay que advertir nada ni poner un diálogo de confirmación
 * para algo que nadie quiere hacer a propósito.
 */
function ofrecibles() {
    const lista = sesion.pantallas.filter(p => !p.esDeLaApp);
    // La que ya tiene el render se ofrece igual, aunque la ventana de trabajo se
    // haya mudado encima mientras tanto: si no, el desplegable diría «Apagada»
    // con el render puesto en otra pantalla, que es justo el estado mentiroso
    // que este control vino a sacar.
    if (sesion.abierta && sesion.enId != null && !lista.some(p => p.id === sesion.enId)) {
        const esa = sesion.pantallas.find(p => p.id === sesion.enId);
        if (esa) lista.push(esa);
    }
    return lista;
}

/**
 * A dónde iría el render si hubiera que mandarlo sin que nadie elija.
 *
 * La recordada de la sesión pasada si sigue enchufada, y si no la primera que
 * haya. Es para lo que sirve guardar la elección: con tres pantallas, «la
 * primera que no sea la mía» es una moneda al aire.
 */
function destinoPorDefecto() {
    const lista = ofrecibles();
    const etiqueta = recordada();
    return lista.find(p => p.etiqueta === etiqueta) || lista[0] || null;
}

/** Vuelve a preguntarle al sistema qué pantallas hay y repinta el control. */
export async function revisar() {
    const r = await window.rv.pantallas();
    sesion.pantallas = r.pantallas || [];
    sesion.abierta = Boolean(r.abierta);
    sesion.enId = r.enId != null ? r.enId : null;
    pintar();
    return r;
}

function pintar() {
    const barra = $('#pantalla-barra');
    const select = $('#pantalla-elegida');
    const lista = ofrecibles();

    barra.hidden = lista.length === 0;
    if (barra.hidden) return;

    select.textContent = '';
    // «Apagada» primero y no último: es el estado de arranque y el que más se
    // busca —traer el render de vuelta a la Mac—, y en un menú nativo la
    // primera fila es la que se alcanza sin leer.
    const apagada = document.createElement('option');
    apagada.value = '';
    apagada.textContent = 'Apagada';
    select.appendChild(apagada);

    for (const p of lista) {
        const op = document.createElement('option');
        op.value = String(p.id);
        op.textContent = p.nombre;
        select.appendChild(op);
    }
    select.value = sesion.abierta && sesion.enId != null ? String(sesion.enId) : '';

    barra.classList.toggle('is-activa', sesion.abierta);
    const destino = destinoPorDefecto();
    select.title = sesion.abierta
        ? 'Dónde se está viendo el render. «Apagada» lo trae de vuelta a la Mac.'
        : (destino
            ? `Mandar el render a otra pantalla (la última fue ${destino.nombre})`
            : 'Mandar el render a otra pantalla');
}

/** Le dice a la otra ventana qué render abrir. */
export async function mostrar(url, media) {
    sesion.url = url || null;
    await revisar();
    if (!sesion.abierta) return;
    await contarleTodo();
}

/**
 * Le cuenta a la otra ventana todo lo que necesita saber, de cero.
 *
 * Se llama al abrirla, al cambiar de render y cada vez que ella saluda. Es
 * siempre el estado completo y nunca un parche: una ventana que se recargó no
 * tiene de dónde deducir lo que se perdió.
 */
async function contarleTodo() {
    await window.rv.pantallaDecir({
        tipo: 'cargar',
        url: sesion.url,
        media: estado.version ? estado.version.media : null
    });
    seguir(reproductor.tiempo());
    mandarTrazos();
    mandarDictado();
}

/**
 * Le pasa el cabezal.
 *
 * Se llama desde el `timeupdate` del reproductor, que es cuatro veces por
 * segundo mientras anda: suficiente para que la otra pantalla no se vaya, y
 * poco como para no saturar el puente. Entre dos avisos la otra ventana sigue
 * sola, que es lo que tiene que hacer un video.
 */
export function seguir(t) {
    if (!sesion.abierta) return;
    window.rv.pantallaDecir({
        tipo: 'ir',
        t,
        andando: reproductor.andando(),
        // La velocidad viaja junto con el tiempo: si la otra pantalla corriera
        // a 1× mientras esta va a 1.75×, se quedaría atrás un cuarto de
        // segundo por cada segundo y estaría reenganchando todo el tiempo.
        ritmo: reproductor.velocidad()
    });
}

/**
 * Le pasa la pizarra de acá: los trazos y con qué se está dibujando.
 *
 * Va siempre todo junto y siempre completo. La alternativa era un mensaje por
 * cosa —uno para los trazos, otro para el color, otro para la herramienta— y
 * se rompe de la peor manera: el día que alguien agregue un camino que cambia
 * el color sin acordarse de avisar, el iPad sigue dibujando del color viejo y
 * no hay nada en ninguna de las dos pantallas que lo explique.
 */
export function mandarTrazos() {
    if (!sesion.abierta) return;
    window.rv.pantallaDecir({
        tipo: 'trazos',
        trazos: dibujo.trazos(),
        color: dibujo.color(),
        lapiz: dibujo.lapiz(),
        // Para que la tecla de rehacer del iPad se vea apagada cuando no hay
        // nada que rehacer. Allá no hay cursor ni tooltip: una tecla que parece
        // viva y no hace nada es indistinguible de una rota.
        puedeRehacer: dibujo.hayQueRehacer()
    });
}

/**
 * Le pasa el estado del micrófono.
 *
 * Es la pieza sin la que «dictar desde el iPad» no se puede entregar. El aviso
 * del dictado —«Cargando el modelo de voz…», «Escuchando… 12 s», «No se oye
 * nada todavía…»— vive al lado del campo de texto, en el panel de comentarios,
 * y desde el iPad ese panel no se ve. Sin esto el editor aprieta «Dictar», se
 * pone a hablar y no tiene cómo saber si el micrófono se abrió: descubrir al
 * volver a la Mac que se habló un minuto al vacío es el peor final posible.
 *
 * Va por mensaje aparte de los trazos porque cambia por su cuenta: el dictado
 * arranca con el video pausado y sin que nadie dibuje nada.
 */
export function mandarDictado() {
    if (!sesion.abierta) return;
    const aviso = dictado.avisoActual();
    window.rv.pantallaDecir({
        tipo: 'dictado',
        oyendo: dictado.oyendo(),
        dice: aviso.texto,
        tono: aviso.tono
    });
}

/**
 * Dictar desde el iPad: abre el comentario si hace falta y prende el micrófono.
 *
 * Las dos cosas en una tecla porque son un solo gesto, y es el gesto que pidió
 * quien lo usa: señalar algo con el lápiz mientras lo explica en voz alta.
 * Pedirle «comentar» y después «dictar» son dos viajes a la paleta para empezar
 * una frase.
 *
 * El comentario se abre por el MISMO camino que la tecla M —el gancho
 * `reproductor.al.comentar`, no `redactor.abrir` a mano— porque el redactor se
 * abre en dos lugares distintos según si el panel derecho está colapsado, y
 * quién sabe en cuál es `app.js`. Llamar al gancho deja esa decisión donde está
 * en vez de copiarla acá, donde se desincronizaría.
 */
async function dictar() {
    if (dictado.oyendo()) {
        await dictado.parar();
        return;
    }
    // Se pregunta si ya está abierto porque abrirlo de nuevo le mueve el
    // momento al cuadro de ahora: un segundo toque de «Dictar» reanclaría un
    // comentario a medio dictar a otro cuadro, sin decir nada.
    if (!redactor.abierto()) reproductor.al.comentar();
    // El botón del redactor va igual, aunque el toque haya venido del iPad: es
    // el que `dictado.js` pinta de rojo, y la Mac tiene que mostrar que el
    // micrófono está abierto aunque nadie lo haya apretado de este lado.
    await dictado.empezar('redactor', $('[data-dictar="redactor"]'));
}

/**
 * Manda el render a una pantalla. Sin `id`, a la recordada.
 *
 * Si ya estaba abierta en otra, el proceso principal MUDA la ventana en vez de
 * cerrarla y volver a abrirla, y acá no hay que contarle nada de nuevo: los
 * trazos se guardan de 0 a 1 y del otro lado el `resize` recoloca la pizarra y
 * la paleta solos. Mandarle un «cargar» le reiniciaría el `<video>` —medio
 * segundo de negro— para algo que es mover una ventana.
 */
export async function abrir(id) {
    const destino = id != null
        ? sesion.pantallas.find(p => p.id === id)
        : destinoPorDefecto();
    if (!destino) {
        avisar('No hay otra pantalla donde mandar el render.', 'mal');
        await revisar();
        return;
    }
    const r = await window.rv.pantallaAbrir(destino.id);
    if (!r.ok) {
        avisar(r.error, 'mal');
        await revisar();
        return;
    }
    sesion.abierta = true;
    sesion.enId = r.id;
    await recordar(destino.etiqueta);
    await revisar();
    // No se le manda nada todavía si es nueva: su JavaScript aún no corrió y el
    // mensaje se perdería. Ella avisa cuando está (`alPedirPantalla`).
    anotar('pantalla.manda', { a: destino.etiqueta, mudada: Boolean(r.yaEstaba) });
}

export async function cerrar() {
    if (!sesion.abierta) return;
    await window.rv.pantallaCerrar();
    sesion.abierta = false;
    await revisar();
}

export function wire() {
    // El desplegable es el interruptor: «Apagada» trae el render de vuelta y
    // cualquier otra fila lo manda —o lo muda— a esa pantalla. Un selector de
    // destino con un interruptor aparte dejaba un cuarto estado que no se puede
    // leer de un vistazo: elegida pero apagada.
    $('#pantalla-elegida').addEventListener('change', e => {
        const valor = e.target.value;
        if (valor) abrir(Number(valor));
        else cerrar();
    });
    $('#pantalla-buscar').addEventListener('click', revisar);

    // El gancho se pone acá y no en `app.js`, que es donde está el resto del
    // cableado, porque la segunda pantalla es el único interesado en que el
    // micrófono se abra o se cierre: `app.js` no tiene nada que repintar con
    // eso. El día que a alguien más le importe, se sube allá.
    dictado.al.cambio = mandarDictado;

    window.rv.alEstadoPantalla(({ abierta: sigue }) => {
        sesion.abierta = sigue;
        revisar();
    });

    // «Ya estoy»: la otra ventana terminó de cargar y pide todo.
    window.rv.alPedirPantalla(() => {
        sesion.abierta = true;
        contarleTodo();
    });

    // Un trazo hecho con el Pencil sobre el iPad entra a la pizarra de acá como
    // uno más: desde el comentario no hay diferencia entre haberlo dibujado con
    // el mouse o con la mano, y no tiene por qué haberla.
    window.rv.alTrazoDePantalla(trazo => {
        if (trazo) dibujo.agregarTrazo(trazo);
    });

    // Y lo que aprieta la paleta del iPad. No tiene estado propio: lo que llega
    // se aplica sobre el mismo `dibujo.js` que maneja la barra de esta ventana,
    // y la respuesta sale por el `mandarTrazos` de siempre. Es lo que hace que
    // la Mac y el iPad no puedan terminar diciendo cosas distintas.
    window.rv.alMandoDePantalla(mando => {
        if (!mando) return;
        switch (mando.tipo) {
            case 'lapiz':
                dibujo.elegirLapiz(mando.lapiz);
                return;
            case 'color':
                dibujo.elegirColor(mando.color);
                return;
            // El transporte y el comentario van a los MISMOS ganchos que las
            // teclas de la Mac —`al.comentar` es la M, `al.salida` es la O—
            // y no a una copia de lo que hacen. Es lo que hace que agregar un
            // paso a «comentar» del lado de `app.js` lo agregue también para el
            // iPad, sin que nadie se acuerde de venir hasta acá.
            case 'play':
                reproductor.alternar();
                return;
            case 'cuadro':
                reproductor.mover(mando.cuadros === -1 ? -1 : 1);
                return;
            case 'comentar':
                reproductor.al.comentar();
                return;
            case 'cerrar-ultimo':
                reproductor.al.salida(reproductor.tiempo());
                return;
            case 'dictar':
                dictar();
                return;
            case 'deshacer':
                // A propósito `dibujo.deshacer` y no el ⌘Z de `app.js`, que
                // cuando la pizarra está limpia sigue desandando comentarios ya
                // guardados. Desde el iPad el panel no se ve: un toque de más
                // no puede borrar un comentario que no está a la vista.
                dibujo.deshacer();
                return;
            case 'rehacer':
                dibujo.rehacer();
                return;
            default:
                // Una paleta más nueva que esta ventana —la segunda se puede
                // quedar abierta mientras esta se recarga—: se ignora en vez de
                // romperse, igual que del otro lado.
                return;
        }
    });

    // Pantallas que aparecen y desaparecen con la app corriendo. Llega solo,
    // sin que nadie apriete «volver a buscar», porque el momento que importa
    // —el iPad que acaba de entrar por Sidecar— es justo cuando el editor está
    // mirando el render y no esta barra.
    window.rv.alCambiarPantallas(async carga => {
        await revisar();
        // Se avisa porque el render desapareció de donde se estaba mirando y la
        // causa está afuera de la app: sin el cartel, desenchufar el iPad se
        // siente como que Reviewer se cerró solo.
        if (carga && carga.seFue) {
            avisar('Se desconectó la pantalla donde estaba el render. Volvió a la Mac.', 'mal');
        }
    });

    // Mover la ventana de Reviewer a otro monitor cambia cuál es «la pantalla
    // de la app», y con eso qué se puede ofrecer. `focus` no es el evento
    // exacto —no hay uno de «la ventana cambió de display»— pero mover una
    // ventana termina en un foco, y revisar de más no cuesta nada.
    window.addEventListener('focus', revisar);
}
