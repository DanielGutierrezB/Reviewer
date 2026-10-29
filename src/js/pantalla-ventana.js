'use strict';
/**
 * pantalla-ventana.js — Lo que corre DENTRO de la segunda pantalla.
 *
 * Esta ventana no decide nada. No tiene mandos, no lee el disco y no sabe qué
 * comentarios hay: recibe «cargá esto», «andá a tal segundo» y «estos son los
 * trazos», y muestra. Todo lo que se parezca a una decisión vive en la ventana
 * principal, que es donde está el editor.
 *
 * **El video de acá es un esclavo, no una copia sincronizada.** Dos `<video>`
 * sobre el mismo archivo nunca van a ir al mismo cuadro exacto —decodifican por
 * su cuenta, con su propio buffer—, así que no se intenta. Lo que se hace es
 * mirar la deriva y corregirla sola cuando pasa de un umbral: mientras está
 * pausado se busca el cuadro exacto, que es cuando el cuadro exacto importa, y
 * mientras anda se deja correr y se reengancha si se fue. Un reenganche
 * constante se ve peor que medio cuadro de atraso.
 *
 * **Va en silencio.** El audio sale de la Mac, que es donde está el editor; dos
 * fuentes separadas por unos milisegundos suenan como un eco.
 *
 * **Las paletas son la excepción a todo lo anterior, y crecieron.** Empezaron
 * siendo las formas del lápiz y hoy son dieciséis teclas: formas, colores,
 * deshacer, cuadro a cuadro, play, comentar, dictar y cerrar el último
 * comentario. El criterio de qué entra no es «lo que quepa» sino uno solo: lo
 * que, faltando acá, obligaba a soltar el Pencil y cruzar el brazo hasta el
 * teclado. Eso anula la función entera, que existe para tener el render en la
 * mano. Lo que sigue viviendo solo en la Mac es lo que se decide LEYENDO —el
 * panel de comentarios, los ajustes, qué carpeta se abre—, porque para eso hay
 * que estar mirando la Mac de todos modos.
 *
 * **Pero ninguna de esas decisiones se guarda acá.** El toque viaja a la Mac,
 * que cambia el estado de verdad y devuelve cuál quedó; y del otro lado se
 * llaman los MISMOS ganchos que usan las teclas del teclado, así que mover un
 * cuadro desde el iPad y apretar la flecha derecha terminan en la misma
 * función. Si esta ventana recordara su propio estado, las dos barras podrían
 * decir cosas distintas y ninguna de las dos estaría mintiendo.
 */

import { pintarEn, LAPICES, COLORES } from './dibujo.js';
import { svg as dibujar, LINEA, RELLENO } from './iconos.js';
import { puntoEn, rechazoDePalma, estirar, sirve } from './trazo.js';

/** Cuánta deriva se aguanta andando antes de volver a buscar, en segundos. */
const DERIVA = 0.25;

/**
 * Cuánto tiene que sobrar en la franja negra, además de la paleta, para que la
 * paleta se meta ahí en vez de irse encima del video.
 *
 * Es chico a propósito —diez píxeles— y no «un margen cómodo». La cuenta está
 * medida en el iPad de verdad: la ventana queda de 1194 × 804, un render 16:9
 * deja 66 px de franja y la paleta mide 52. Pedir un margen generoso la
 * empujaría sobre la imagen justo en el caso más común de todos, que es el que
 * tiene que salir bien.
 */
const HOLGURA = 10;

/** Y cuánto se despega del borde de la imagen cuando no hay más remedio que ir encima. */
const ENCIMA = 18;

/** Separación entre las dos paletas cuando las dos caen en la franja izquierda. */
const CARRIL = 10;

const video = document.getElementById('video');
const pizarra = document.getElementById('pizarra');
const espera = document.getElementById('espera');
const paleta = document.getElementById('paleta');
const formas = document.getElementById('paleta-formas');
const colores = document.getElementById('paleta-colores');
const btnDeshacer = document.getElementById('btn-deshacer');
const btnRehacer = document.getElementById('btn-rehacer');
const mandos = document.getElementById('mandos');
const btnAtras = document.getElementById('btn-atras');
const btnPlay = document.getElementById('btn-play');
const btnAdelante = document.getElementById('btn-adelante');
const btnComentar = document.getElementById('btn-comentar');
const btnDictar = document.getElementById('btn-dictar');
const btnCerrarUltimo = document.getElementById('btn-cerrar-ultimo');
const dice = document.getElementById('mandos-dice');

/**
 * Las dos paletas y en qué franja negra va cada una.
 *
 * La de dibujar abajo porque se usa durante el trazo, con la mano ya apoyada
 * del lado de abajo. La de mando arriba porque se usa entre trazo y trazo, y
 * lejos de donde descansa la palma: una palma que roza «play» a mitad de un
 * dibujo arranca el video.
 */
const PALETAS = [
    { nodo: paleta, franja: 'abajo' },
    { nodo: mandos, franja: 'arriba' }
];

let trazos = [];
let enCurso = null;
/** El portero de esta pizarra: el rechazo de palma vive en `trazo.js`. */
const puedeDibujar = rechazoDePalma();

/**
 * Con qué se dibuja acá. Las tres cosas vienen en el mensaje `trazos`, que la
 * Mac manda completo cada vez que algo cambia de aquel lado.
 *
 * Es un espejo y no la verdad: la verdad es `dibujo.js` en la Mac. Acá se
 * guarda nada más que para poder encender el botón en el momento en que se lo
 * toca, sin esperar el ida y vuelta por el proceso principal.
 */
let lapizElegido = 'libre';
let colorElegido = COLORES[0];
let sePuedeRehacer = false;
/** Si el micrófono de la Mac está abierto, y lo último que dijo de sí mismo. */
let dictando = false;
let diceDictado = { texto: '', tono: null };

// ─── Mostrar ──────────────────────────────────────────────────

/**
 * El canvas, encima del video y exactamente de su tamaño.
 *
 * Acá el video usa `object-fit` dentro de una caja más grande, así que la
 * imagen no ocupa toda la ventana: hay que medir dónde quedó para que un trazo
 * hecho sobre una nariz caiga sobre esa nariz y no diez centímetros al lado.
 */
function ajustar() {
    if (!video.videoWidth) return;
    const caja = video.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    pizarra.style.left = `${caja.left}px`;
    pizarra.style.top = `${caja.top}px`;
    pizarra.style.width = `${caja.width}px`;
    pizarra.style.height = `${caja.height}px`;
    pizarra.width = Math.max(1, Math.round(caja.width * dpr));
    pizarra.height = Math.max(1, Math.round(caja.height * dpr));
    // Las paletas aparecen recién acá, cuando ya se sabe de qué tamaño quedó el
    // video. Mostrarlas al recibir la URL las pegaba a la esquina de la ventana
    // y las hacía saltar al lugar bueno medio segundo después.
    paleta.hidden = false;
    mandos.hidden = false;
    ubicarPaletas();
    repintar();
}

function repintar() {
    const ctx = pizarra.getContext('2d');
    ctx.clearRect(0, 0, pizarra.width, pizarra.height);
    pintarEn(ctx, enCurso ? [...trazos, enCurso] : trazos, pizarra.width, pizarra.height);
}

function seguir(t, andando, ritmo) {
    if (!video.src || !Number.isFinite(t)) return;
    const deriva = Math.abs(video.currentTime - t);
    if (Number.isFinite(ritmo) && ritmo > 0) video.playbackRate = ritmo;

    if (!andando) {
        if (!video.paused) video.pause();
        if (deriva > 0.002) video.currentTime = t;
        return;
    }
    if (deriva > DERIVA) video.currentTime = t;
    if (video.paused) video.play().catch(() => {});
}

// ─── La paleta ────────────────────────────────────────────────

/**
 * A cuántos píxeles se pintan las teclas de acá.
 *
 * 22 y no los 15 de la barra de la Mac porque estas se tocan con el dedo o con
 * el Pencil a un brazo de distancia. Lo único que cambia es el tamaño: el
 * dibujo, la caja y el grosor del trazo salen de `iconos.js`, que es el único
 * módulo que los decide (acá había un `svg()` propio con un grosor distinto,
 * que es cómo los mismos dibujos de deshacer y rehacer terminaron pesando
 * distinto en las dos pantallas).
 */
const svg = dentro => dibujar(dentro, 22);

/**
 * El dibujo de cada tecla.
 *
 * Dibujados y no escritos con glifos («▭», «↶») por lo mismo que los mandos de
 * la ventana principal: cada glifo cae donde su tipografía quiere y al alto que
 * quiere, y seis teclas en fila con los dibujos corridos de a poco se ven
 * torcidas sin que se entienda por qué. En un `viewBox` propio cada pieza queda
 * donde se la puso.
 */
const DIBUJOS = {
    libre: svg(`<path ${LINEA} d="M3 17 C6 7 9 21 12.5 12 C15 5.5 18 13 21 8"/>`),
    flecha: svg(`<path ${LINEA} d="M5 19 L16 8"/><path ${RELLENO} d="M20 4 L18.6 11.2 L12.8 5.4 Z"/>`),
    caja: svg(`<rect ${LINEA} x="4" y="6.5" width="16" height="11" rx="1.5"/>`),
    elipse: svg(`<ellipse ${LINEA} cx="12" cy="12" rx="8.5" ry="6.5"/>`),
    deshacer: svg(`<path ${LINEA} d="M4.5 9.5 H14 A5 5 0 0 1 14 19.5 H8.5"/><path ${LINEA} d="M8.5 5 L4 9.5 L8.5 14"/>`),
    rehacer: svg(`<path ${LINEA} d="M19.5 9.5 H10 A5 5 0 0 0 10 19.5 H15.5"/><path ${LINEA} d="M15.5 5 L20 9.5 L15.5 14"/>`),

    // Los del mando. `iconos.js` ya tiene play, pausa y los dos de cuadro para
    // la barra de la Mac, y estos son los mismos dibujos redibujados más
    // anchos: a 22 px y con el dedo encima, los de allá quedan finitos y
    // separados. Son los únicos cuatro que se repiten a propósito; el helper y
    // el grosor sí salen de allá, que es lo que hace que la diferencia sea
    // solo el trazado y no un accidente.
    play: svg(`<path ${RELLENO} d="M7 5 L19 12 L7 19 Z"/>`),
    pausa: svg(
        `<rect ${RELLENO} x="6.5" y="5" width="4" height="14" rx="1"/>` +
        `<rect ${RELLENO} x="13.5" y="5" width="4" height="14" rx="1"/>`
    ),
    atras: svg(
        `<path ${RELLENO} d="M15.5 5 L15.5 19 L5.5 12 Z"/>` +
        `<rect ${RELLENO} x="17" y="5" width="3" height="14" rx="1"/>`
    ),
    adelante: svg(
        `<rect ${RELLENO} x="4" y="5" width="3" height="14" rx="1"/>` +
        `<path ${RELLENO} d="M8.5 5 L8.5 19 L18.5 12 Z"/>`
    ),
    comentar: svg(`<path ${LINEA} d="M20 14.5 A2.5 2.5 0 0 1 17.5 17 H11 L6.5 20.5 V17 H6 A2.5 2.5 0 0 1 3.5 14.5 V6.5 A2.5 2.5 0 0 1 6 4 H17.5 A2.5 2.5 0 0 1 20 6.5 Z"/>`),
    micro: svg(
        `<rect ${LINEA} x="9" y="3" width="6" height="11" rx="3"/>` +
        `<path ${LINEA} d="M5.5 12.5 A6.5 6.5 0 0 0 18.5 12.5"/>` +
        `<path ${LINEA} d="M12 19 V21.5"/>`
    ),
    // Grabando: un círculo macizo, que es como se dibuja «rec» desde que hay
    // grabadores. Cambia el dibujo y no solo el color porque un daltónico ve
    // el mismo micrófono de antes.
    grabando: svg(`<circle ${RELLENO} cx="12" cy="12" r="7"/>`),
    // La salida: el triángulo entra y choca con la barra. Es el `]` de un NLE
    // puesto en el mismo lenguaje que los dos de cuadro.
    cerrar: svg(
        `<path ${RELLENO} d="M5 6 L13 12 L5 18 Z"/>` +
        `<rect ${RELLENO} x="15.5" y="4.5" width="3" height="15" rx="1"/>`
    )
};

function tecla(boton, dibujo, nombre) {
    // El nombre va escrito además del dibujo. Una forma se reconoce por el
    // dibujo, pero a un brazo de distancia y de reojo la palabra es lo que
    // confirma que se tocó la que se quería. Y si algún día aparece una
    // herramienta nueva en `dibujo.js` sin dibujo acá, la tecla queda con el
    // nombre solo y sigue sirviendo en vez de quedar vacía y muda.
    boton.innerHTML = `${dibujo || ''}<span class="tecla-nombre">${nombre}</span>`;
}

function armarPaleta() {
    for (const l of LAPICES) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'tecla';
        b.dataset.lapiz = l.id;
        b.setAttribute('aria-label', `Dibujar con ${l.nombre}`);
        tecla(b, DIBUJOS[l.id], l.nombre);
        b.addEventListener('click', () => elegirLapiz(l.id));
        formas.appendChild(b);
    }
    // Las pastillas de color salen de `COLORES`, la misma lista que pinta la
    // barra de la Mac. Escribir los cuatro a mano acá significaría que el día
    // que alguien agregue el violeta, el iPad siga ofreciendo cuatro.
    for (const c of COLORES) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'color';
        b.dataset.color = c;
        // Por variable de CSS y no pintando el fondo del botón: el botón es la
        // caja oscura de siempre y el color es la pastilla de adentro, que la
        // hoja dibuja con `--c`.
        b.style.setProperty('--c', c);
        b.setAttribute('aria-label', 'Dibujar en este color');
        b.addEventListener('click', () => elegirColor(c));
        colores.appendChild(b);
    }

    tecla(btnDeshacer, DIBUJOS.deshacer, 'Deshacer');
    tecla(btnRehacer, DIBUJOS.rehacer, 'Rehacer');

    // Deshacer manda a la Mac, que es donde está la pila. No se saca el trazo
    // de acá y después se avisa: la pila de deshechos vive allá —es la misma
    // que usa ⌘Z— y dos pilas separadas se desordenarían en cuanto se dibujara
    // un trazo en cada pantalla.
    btnDeshacer.addEventListener('click', () => window.rv.pantallaMando({ tipo: 'deshacer' }));
    btnRehacer.addEventListener('click', () => window.rv.pantallaMando({ tipo: 'rehacer' }));

    // ── El mando ──
    // Todos van por el mismo canal y ninguno decide nada acá: del otro lado se
    // llaman los MISMOS ganchos que usan las teclas del teclado de la Mac, así
    // que mover un cuadro desde el iPad y apretar la flecha derecha terminan en
    // la misma función. Ver `pantalla.js`.
    tecla(btnAtras, DIBUJOS.atras, 'Cuadro');
    tecla(btnPlay, DIBUJOS.play, 'Andar');
    tecla(btnAdelante, DIBUJOS.adelante, 'Cuadro');
    tecla(btnComentar, DIBUJOS.comentar, 'Comentar');
    tecla(btnDictar, DIBUJOS.micro, 'Dictar');
    tecla(btnCerrarUltimo, DIBUJOS.cerrar, 'Cerrar');

    btnAtras.addEventListener('click', () => window.rv.pantallaMando({ tipo: 'cuadro', cuadros: -1 }));
    btnAdelante.addEventListener('click', () => window.rv.pantallaMando({ tipo: 'cuadro', cuadros: 1 }));
    // El play no espera la respuesta de la Mac para cambiar de dibujo: el video
    // de acá va a arrancar o frenar por su cuenta en cuanto llegue el aviso, y
    // el dibujo se pinta de eso (`video.paused`), que es lo que el editor está
    // mirando. Adivinarlo antes mostraría «pausa» sobre una imagen que sigue
    // andando.
    btnPlay.addEventListener('click', () => window.rv.pantallaMando({ tipo: 'play' }));
    btnComentar.addEventListener('click', () => window.rv.pantallaMando({ tipo: 'comentar' }));
    btnDictar.addEventListener('click', () => window.rv.pantallaMando({ tipo: 'dictar' }));
    btnCerrarUltimo.addEventListener('click', () => window.rv.pantallaMando({ tipo: 'cerrar-ultimo' }));

    // El dibujo del play tiene que seguir al video de acá y no al mensaje de la
    // Mac: entre dos avisos este video anda solo, y es el que se está viendo.
    video.addEventListener('play', pintarPaleta);
    video.addEventListener('pause', pintarPaleta);

    pintarPaleta();
}

function elegirLapiz(id) {
    // Se enciende acá en el acto y además se avisa. Esperar a que la Mac
    // conteste para ver qué tecla quedó apretada se siente como una pantalla
    // que no registró el toque, y un toque que no se registra se repite.
    lapizElegido = id;
    pintarPaleta();
    window.rv.pantallaMando({ tipo: 'lapiz', lapiz: id });
}

function elegirColor(c) {
    colorElegido = c;
    pintarPaleta();
    window.rv.pantallaMando({ tipo: 'color', color: c });
}

/**
 * Qué teclas se ven elegidas, de qué color, y qué está pasando.
 *
 * **El dibujo de la forma elegida se pinta con el color elegido**, y eso es
 * todo lo que hace falta mirar para saber cómo va a salir el próximo trazo: una
 * flecha roja en la tecla quiere decir que el próximo trazo es una flecha roja.
 * Antes el color teñía el borde porque era la única pista que había —el color se
 * elegía solo en la Mac—; ahora que las pastillas están acá, el borde teñido
 * repetía lo que ya decía la pastilla marcada de al lado.
 */
function pintarPaleta() {
    paleta.style.setProperty('--tinta', colorElegido);
    for (const b of formas.children) {
        b.classList.toggle('is-activo', b.dataset.lapiz === lapizElegido);
    }
    for (const b of colores.children) {
        b.classList.toggle('is-activo', b.dataset.color === colorElegido);
    }
    // Apagados cuando no hay nada que deshacer o rehacer. En una pantalla sin
    // cursor y sin tooltip, una tecla que parece viva y no hace nada es
    // indistinguible de una rota.
    btnDeshacer.disabled = trazos.length === 0;
    btnRehacer.disabled = !sePuedeRehacer;

    // El play dice lo que va a hacer, no en qué estado está: andando muestra la
    // pausa. Es como está en la Mac y es lo que hace cualquier reproductor.
    tecla(btnPlay, video.paused ? DIBUJOS.play : DIBUJOS.pausa, video.paused ? 'Andar' : 'Pausar');

    // Grabando: dibujo de «rec», rojo, y los segundos de rótulo. El número es
    // la prueba de que el micrófono está entrando audio y no colgado —que es la
    // pregunta que uno se hace a los diez segundos de estar hablando solo—.
    const segundos = (diceDictado.texto.match(/(\d+)\s*s/) || [])[1];
    btnDictar.classList.toggle('is-grabando', dictando);
    tecla(
        btnDictar,
        dictando ? DIBUJOS.grabando : DIBUJOS.micro,
        dictando ? (segundos ? `${segundos} s` : 'Parar') : 'Dictar'
    );
    document.body.classList.toggle('is-dictando', dictando);

    // El aviso se ve mientras graba y TAMBIÉN cuando está en rojo sin grabar,
    // que es el caso que importa de verdad: «No se pudo abrir el micrófono.
    // Revisá los permisos del sistema». Mostrarlo solo mientras graba dejaba
    // justo el fallo invisible —se aprieta Dictar, no pasa nada, y la pantalla
    // no dice por qué—, que es la forma más cara de equivocarse acá.
    const mal = diceDictado.tono === 'mal';
    dice.textContent = (dictando || mal) ? diceDictado.texto : '';
    dice.className = `dice${mal ? ' is-mal' : ''}`;
}

/** Atenúa las dos paletas mientras se traza: ver `.is-trazando` en la hoja. */
function atenuar(si) {
    for (const p of PALETAS) p.nodo.classList.toggle('is-trazando', si);
}

/**
 * Dónde caben las paletas sin tapar la imagen.
 *
 * El video va centrado y `contain`, así que casi siempre sobra negro, y sobra
 * de distinto lado según el render: en un 16:9 sobra arriba y abajo, y en un
 * 9:16 sobra a los costados, muchísimo. Ahí van, que es el único lugar donde no
 * tapan nada — una barra flotando sobre la imagen, en la pantalla que existe
 * para mirar el render en grande, es exactamente lo que no se quiere.
 *
 * Son tres intentos, en este orden:
 *
 * 1. **Cada una en su franja**, de pie horizontal. Es lo que pasa con un render
 *    16:9: dos franjas de 66 px, una paleta en cada una.
 * 2. **Las dos en la franja de la izquierda**, de pie vertical y una al lado de
 *    la otra. Es lo que pasa con un render 9:16, donde no sobra nada arriba ni
 *    abajo y sobran 371 px al costado. Es la «magic bar» en columna: a la
 *    izquierda y no a la derecha porque la mano que dibuja viene de la derecha
 *    y taparía las teclas justo cuando se las va a mirar.
 * 3. **Encima del video**, traslúcidas y cada una pegada al borde de su franja.
 *    Pasa cuando el render calza exacto con la pantalla —un 16:9 en un monitor
 *    16:9— y no hay negro en ninguna parte. Último recurso, no primero.
 *
 * Lo que NO se hace es encoger el video para dejarle un carril fijo a la
 * izquierda, que sería la forma de tener la columna siempre. Un render 16:9 en
 * el iPad pasaría de 1194 px de ancho a unos 1060: un 11 % menos de imagen,
 * para siempre, en la pantalla cuyo único trabajo es mostrar la imagen grande.
 */
function ubicarPaletas() {
    const caja = video.getBoundingClientRect();
    if (!caja.width || !caja.height) return;

    const sinSitio = [];
    for (const p of PALETAS) {
        if (p.nodo.hidden) continue;
        if (!enLaFranja(p.nodo, p.franja, caja)) sinSitio.push(p);
    }
    if (!sinSitio.length) return;
    if (enLaIzquierda(sinSitio.map(p => p.nodo), caja)) return;
    for (const p of sinSitio) encimaDelVideo(p.nodo, p.franja, caja);
}

/**
 * Intento 1: en la franja negra de arriba o de abajo.
 *
 * Se MIDE la paleta en vez de saber de memoria cuánto mide: el alto sale del
 * CSS y de la tipografía del sistema, y un número copiado acá queda viejo la
 * primera vez que alguien le toque el relleno en `pantalla.css`.
 */
function enLaFranja(nodo, franja, caja) {
    nodo.classList.remove('is-columna', 'is-encima');
    const medida = nodo.getBoundingClientRect();
    const banda = franja === 'arriba' ? caja.top : window.innerHeight - caja.bottom;
    if (banda < medida.height + HOLGURA || caja.width < medida.width + HOLGURA) return false;
    nodo.style.left = `${caja.left + caja.width / 2}px`;
    nodo.style.top = franja === 'arriba'
        ? `${(banda - medida.height) / 2}px`
        : `${caja.bottom + (banda - medida.height) / 2}px`;
    return true;
}

/**
 * Intento 2: las que quedaron sin sitio, en columna sobre la franja izquierda.
 *
 * Van en carriles, una al lado de la otra y centradas como conjunto. Apiladas
 * una sobre otra no entrarían —las dos juntas pasan de los 800 px de alto del
 * iPad— y, aunque entraran, dos columnas pegadas se leen como una sola paleta
 * de dieciséis teclas, que es lo que partirlas vino a evitar.
 */
function enLaIzquierda(nodos, caja) {
    for (const n of nodos) n.classList.add('is-columna');
    const medidas = nodos.map(n => n.getBoundingClientRect());
    const ancho = medidas.reduce((s, m) => s + m.width, 0) + CARRIL * (nodos.length - 1);
    const alto = Math.max(...medidas.map(m => m.height));

    if (caja.left < ancho + HOLGURA || window.innerHeight < alto + HOLGURA) {
        for (const n of nodos) n.classList.remove('is-columna');
        return false;
    }

    let x = caja.left / 2 - ancho / 2;
    nodos.forEach((n, i) => {
        n.style.left = `${x + medidas[i].width / 2}px`;
        n.style.top = `${caja.top + caja.height / 2}px`;
        x += medidas[i].width + CARRIL;
    });
    return true;
}

/** Intento 3: encima del video, pegada al borde de su propia franja. */
function encimaDelVideo(nodo, franja, caja) {
    nodo.classList.remove('is-columna');
    nodo.classList.add('is-encima');
    const medida = nodo.getBoundingClientRect();
    nodo.style.left = `${caja.left + caja.width / 2}px`;
    nodo.style.top = franja === 'arriba'
        ? `${caja.top + ENCIMA}px`
        : `${caja.bottom - medida.height - ENCIMA}px`;
}

// ─── Dibujar con el Pencil ────────────────────────────────────

/** Contra qué se normaliza un punto: la pizarra tal como está en pantalla. */
const caja = () => pizarra.getBoundingClientRect();

function cablearPizarra() {
    pizarra.addEventListener('pointerdown', e => {
        if (!video.src || !puedeDibujar(e)) return;
        e.preventDefault();
        // La captura puede fallar —el puntero ya se soltó, o el sistema se lo
        // llevó— y eso no tiene por qué cancelar el trazo: sin captura el
        // dibujo anda igual mientras el lápiz no se salga del canvas.
        try { pizarra.setPointerCapture(e.pointerId); } catch (err) { /* se dibuja sin ella */ }
        // La forma y el color son los que diga la paleta. Un trazo de acá sale
        // idéntico a uno de allá —mismas claves, mismos puntos normalizados—,
        // que es lo que hace que la Mac no tenga que saber de dónde vino.
        enCurso = { lapiz: lapizElegido, color: colorElegido, puntos: [puntoEn(caja(), e)] };
        atenuar(true);
        repintar();
    });

    pizarra.addEventListener('pointermove', e => {
        if (!enCurso) return;
        estirar(enCurso, caja(), e);
        repintar();
    });

    const soltar = e => {
        if (!enCurso) return;
        try { pizarra.releasePointerCapture(e.pointerId); } catch (err) { /* ya se soltó */ }
        const trazo = enCurso;
        enCurso = null;
        atenuar(false);
        if (!sirve(trazo)) {
            repintar();
            return;
        }
        // Se pinta acá en el acto y además se manda: esperar el ida y vuelta
        // por el proceso principal para ver el propio trazo se siente como un
        // lápiz que escribe tarde.
        trazos.push(trazo);
        pintarPaleta();
        repintar();
        window.rv.pantallaTrazo(trazo);
    };
    pizarra.addEventListener('pointerup', soltar);
    pizarra.addEventListener('pointercancel', soltar);
}

// ─── Lo que llega de la Mac ───────────────────────────────────

window.rv.alDecirPantalla(carga => {
    if (!carga) return;
    switch (carga.tipo) {
        case 'cargar':
            espera.hidden = Boolean(carga.url);
            trazos = [];
            enCurso = null;
            paleta.hidden = true;
            mandos.hidden = true;
            if (carga.url) {
                video.src = carga.url;
                video.load();
            } else {
                video.removeAttribute('src');
                video.load();
            }
            return;
        case 'ir':
            seguir(carga.t, carga.andando, carga.ritmo);
            return;
        case 'trazos':
            // Llega completo y pisa lo de acá, también el trazo que esta misma
            // pantalla acaba de dibujar y ya pintó. Es a propósito: así un
            // «Deshacer» o un «Limpiar» apretado en la Mac se ve acá sin que
            // haya que mandar un mensaje distinto por cada cosa que pudo pasar.
            trazos = carga.trazos || [];
            if (carga.color) colorElegido = carga.color;
            if (carga.lapiz) lapizElegido = carga.lapiz;
            sePuedeRehacer = Boolean(carga.puedeRehacer);
            pintarPaleta();
            repintar();
            return;
        case 'dictado':
            dictando = Boolean(carga.oyendo);
            diceDictado = { texto: carga.dice || '', tono: carga.tono || null };
            pintarPaleta();
            return;
        default:
            // Una versión vieja de esta ventana contra una nueva de la Mac: se
            // ignora en vez de romperse. Es la única ventana que puede quedar
            // abierta mientras se recarga la otra.
            return;
    }
});

video.addEventListener('loadedmetadata', ajustar);
window.addEventListener('resize', ajustar);
cablearPizarra();
// Antes del saludo: `ubicarPaletas` MIDE las paletas para decidir dónde van, y
// medirlas sin teclas adentro daría el tamaño de una caja vacía.
armarPaleta();

// Lo último de todo: recién acá hay alguien escuchando, y este saludo es lo que
// hace que la Mac mande el video. Antes de ponerlo, la ventana principal
// hablaba contra una ventana que todavía no existía del todo y esta pantalla se
// quedaba en negro.
window.rv.pantallaLista();
