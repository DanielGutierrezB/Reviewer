'use strict';
/**
 * fuentes.js — Los videos ocultos de los que el compositor saca cada cuadro.
 *
 * El problema que resuelve este archivo es uno solo y es el más difícil de
 * todo el preview: **en esta clase casi ningún corte es contiguo**. De 156
 * cortes, 151 saltan hacia adelante en la fuente —el montaje saca los silencios
 * y los tropiezos—, en promedio medio segundo. Así que cada 3.5 segundos hay
 * que mostrar un pedazo de la cámara que está más adelante que el que se estaba
 * mostrando.
 *
 * Buscar en el momento del corte no sirve: un `currentTime = x` tarda entre 20
 * y 60 ms, y mientras tanto el elemento no tiene cuadro que dar. Eso es el
 * fotograma negro —o congelado— que hay que evitar, y pasaría 157 veces.
 *
 * La salida es tener DOS elementos por fuente. Mientras el A muestra el shot
 * actual, el B ya se fue posicionando donde entra el siguiente; en el corte se
 * intercambian y el que queda libre se va a preparar el que viene. Como el
 * intercambio es de un elemento ya posicionado y ya corriendo, el corte no
 * cuesta nada.
 *
 * El suplente no se deja quieto en el cuadro exacto del corte: se lo manda 0.4 s
 * ANTES y se lo pone a correr, para que cuando llegue el corte ya esté a
 * velocidad de crucero. Un elemento pausado al que se le da `play()` tarda uno
 * o dos cuadros en arrancar, y eso en un corte se ve como un hipo.
 *
 * No todas las fuentes necesitan este baile:
 *
 * - **cámara y pantalla** saltan en cada corte: van con par A/B.
 * - **el fondo** corre en tiempo de línea de tiempo y no se entera de los
 *   cortes, así que es un solo elemento en loop.
 * - **las escenas** también corren en tiempo de línea de tiempo: una escena dura
 *   varios shots seguidos y adentro no hay salto. Lo que cambia es el ARCHIVO,
 *   así que el par A/B acá es «la escena de ahora» y «la que viene».
 */

import { cuadroDe } from '../formato.js';

/** Cuánto antes del corte se pone a correr el suplente. En segundos. */
const ANTICIPO = 0.4;

/**
 * Cuadros por segundo de los proxies. Los dos van a 30, como la línea de
 * tiempo, y es lo que permite hablar de «el cuadro N» y no de «el segundo t».
 */
const FPS = 30;

/** Más de esto de deriva no se arregla corrigiendo: se busca de nuevo. */
const DERIVA_MAXIMA = 0.25;

/**
 * Deriva a partir de la cual se empieza a corregir, estando en marcha.
 *
 * Un cuadro y medio. Por debajo no se toca nada: corregir una deriva de medio
 * cuadro es pelear contra el redondeo del propio reloj y el resultado es un
 * `playbackRate` que oscila y una imagen que tiembla.
 */
const DERIVA_MINIMA = 0.05;


/** Cuánto se acelera o se frena para alcanzar. 1.08 = 8% más rápido. */
const CORRECCION_MAXIMA = 0.08;

const pinza = (v, min, max) => Math.max(min, Math.min(max, v));

/**
 * Dónde viven los elementos.
 *
 * Pegados al documento y no sueltos: Chromium le baja la prioridad —y a veces
 * directamente le corta la decodificación— a un `<video>` que no está en el
 * árbol, y lo que se ve es que una fuente se queda clavada a los pocos
 * segundos. Ocultos con `visibility` y tamaño 1px en vez de `display:none`,
 * que es la otra forma de que deje de decodificar.
 */
function corral() {
    let caja = document.getElementById('preview-fuentes');
    if (!caja) {
        caja = document.createElement('div');
        caja.id = 'preview-fuentes';
        document.body.appendChild(caja);
    }
    return caja;
}

function crearVideo(url, { loop = false, avisar = null } = {}) {
    const el = document.createElement('video');
    // `crossorigin` para que el canvas no quede «tainted»: sin esto, leer un
    // píxel de lo compuesto tira SecurityError, porque `reviewer:` es otro
    // origen que el `file:` de la ventana.
    el.crossOrigin = 'anonymous';
    el.muted = true;
    el.defaultMuted = true;
    el.playsInline = true;
    el.preload = 'auto';
    el.loop = loop;

    // Todo video nace avisando cuando ya tiene cuadro que dar, sea porque
    // terminó de buscar o porque terminó de abrir.
    //
    // El aviso se engancha ACÁ, en el único sitio por donde nacen todos, y no
    // en una lista de elementos hecha al abrir. Esa lista era lo que había, y
    // dejaba afuera a las escenas: se crean sobre la marcha, así que ninguna
    // avisaba nunca. En pausa eso es definitivo —no hay otro despertador— y
    // la escena se quedaba sin dibujar hasta que el editor tocara algo.
    if (avisar) {
        el.addEventListener('seeked', avisar);
        el.addEventListener('loadeddata', avisar);
    }

    el.src = url;
    el.load();
    corral().appendChild(el);
    return el;
}

/**
 * El instante que hay que PEDIR para que salga el cuadro que se quiere.
 *
 * Medio cuadro adentro, nunca el borde. Pedir el comienzo exacto de un cuadro
 * deja la decisión en manos del redondeo: `18.866633…` es el límite entre el
 * cuadro 565 y el 566, y según de qué lado caiga la coma flotante el navegador
 * devuelve uno u otro. Medido contra el render, pedir el borde daba un cuadro
 * de menos y hundía el parecido de 0.96 a 0.92 — nada roto, solo la cara del
 * profesor en otra posición.
 *
 * El medio cuadro es la respuesta correcta y no un parche: lo que se quiere es
 * «el cuadro que contiene a este instante», y el centro es el único punto que
 * no está en el borde de ninguno.
 */
function adentroDelCuadro(segundos, fps = FPS) {
    return Math.max(0, segundos) + 0.5 / fps;
}

/**
 * El cuadro que de verdad se va a ver al pedir `segundos`.
 *
 * No es `cuadroDe(segundos)`, y confundirlos fue el peor error del preview.
 *
 * Los tiempos de fuente salen de `src + k/30 - offset`, con `src` escrito en
 * el JSON con cuatro decimales. Hacé esa cuenta y el resultado cae un pelo por
 * DEBAJO del borde del cuadro: `12.733299999999872` en vez de `12.7333…`. Son
 * 5916 de los 16311 cuadros de la clase, el 36%. En esos, `cuadroDe(objetivo)`
 * contesta 381 y el cuadro que se ve tras buscar es el 382, porque a buscar se
 * manda el punto medio y el punto medio cae en el siguiente.
 *
 * Comparar «dónde está» contra `cuadroDe(objetivo)` nunca daba igual, así que
 * en pausa se mandaba a buscar otra vez en cada vuelta del lazo, para siempre.
 * Con el elemento buscando sin parar no hay cuadro que dar, y la imagen se iba
 * a negro y se quedaba. Era exactamente «al pausar se pone negro».
 *
 * La regla correcta es una sola y es la que usa todo el archivo: **el cuadro
 * que se quiere es el que contiene al punto medio que se pide**. Preguntarlo
 * así además aguanta las dos cosas que puede hacer Chromium al terminar de
 * buscar —dejar `currentTime` en lo pedido, o encajarlo al principio del
 * cuadro—, porque el punto medio y el principio del cuadro son el mismo cuadro.
 */
function cuadroPedido(segundos, fps = FPS) {
    return cuadroDe(adentroDelCuadro(segundos, fps), fps);
}

/**
 * Pone o saca en marcha un elemento, sin resucitar a los que ya terminaron.
 *
 * Lo de `ended` es la parte que importa y no se ve venir: `play()` sobre un
 * video que llegó al final **lo rebobina a cero**. Así que insistir con el
 * play cuadro a cuadro hacía que una escena, al terminar, volviera a empezar
 * sola; y mientras rebobinaba no tenía cuadro que dar, que eran dos
 * fotogramas sin imagen justo en el final de cada escena.
 */
function arrancarSiHace(el, andando) {
    if (andando && el.paused && !el.ended) el.play().catch(() => {});
    if (!andando && !el.paused) el.pause();
}

/** Esperar a que un elemento tenga cuadro que dar. */
function listo(el) {
    if (el.readyState >= 2) return Promise.resolve(el);
    return new Promise(resolve => {
        const ok = () => { el.removeEventListener('loadeddata', ok); resolve(el); };
        el.addEventListener('loadeddata', ok);
    });
}

/** Buscar y avisar cuando el cuadro ya es el pedido. */
function buscar(el, segundos, fps = FPS) {
    const t = adentroDelCuadro(segundos, fps);
    return new Promise(resolve => {
        // Estando ya en el cuadro pedido no hay nada que buscar, y pedirlo no
        // dispararía `seeked`: la promesa quedaría colgada para siempre.
        if (el.readyState >= 2 && cuadroDe(el.currentTime, fps) === cuadroPedido(segundos, fps)) return resolve(el);
        const ok = () => { el.removeEventListener('seeked', ok); resolve(el); };
        el.addEventListener('seeked', ok);
        el.currentTime = t;
    });
}

/**
 * Acercar un elemento a donde tendría que estar.
 *
 * Tres regímenes y la diferencia importa:
 *
 * - Quieto: se compara POR CUADRO, no por tiempo, y se busca si no es el que
 *   va. En pausa el editor mira un cuadro fijo —lo compara, dibuja encima, le
 *   saca un PNG para un comentario— y el cuadro tiene que ser el exacto. Una
 *   tolerancia en segundos no sabe contestar eso: la que deja pasar el error
 *   de redondeo del borde también deja pasar un cuadro entero.
 * - En marcha y lejos: se busca igual. Es un tirón, pero ya se estaba viendo
 *   algo equivocado.
 * - En marcha y cerca: se cambia la velocidad un poco. El ojo no ve un 8% de
 *   diferencia durante medio segundo; sí ve un salto. Acá sí se mide en
 *   segundos: la deriva que hay que corregir es más fina que un cuadro.
 * - En marcha y casi en punto: no se toca nada.
 */
function corregir(el, objetivo, { andando, ritmo = 1, fps = FPS, ciclo = 0 }) {
    let d = objetivo - el.currentTime;

    // El fondo es un loop y su tiempo es circular: al dar la vuelta pasa de
    // 15.29 a 0, y medir eso en línea recta da una deriva de quince segundos
    // donde en realidad no hay ninguna. Sin esta cuenta, el fondo se mandaba a
    // buscar una vez por vuelta y dejaba un hueco de imagen cada quince
    // segundos exactos.
    if (ciclo > 0) {
        d = ((d % ciclo) + ciclo) % ciclo;
        if (d > ciclo / 2) d -= ciclo;
    }

    if (!andando) {
        if (cuadroDe(el.currentTime, fps) !== cuadroPedido(objetivo, fps)) {
            el.currentTime = adentroDelCuadro(objetivo, fps);
            return 'salto';
        }
        return 'quieto';
    }

    if (Math.abs(d) > DERIVA_MAXIMA) {
        el.currentTime = adentroDelCuadro(objetivo, fps);
        return 'salto';
    }

    if (Math.abs(d) < DERIVA_MINIMA) {
        if (el.playbackRate !== ritmo) el.playbackRate = ritmo;
        return 'bien';
    }

    const ajuste = pinza(d * 2, -CORRECCION_MAXIMA, CORRECCION_MAXIMA);
    el.playbackRate = Math.max(0.1, ritmo * (1 + ajuste));
    return 'corrige';
}

/**
 * Un par A/B sobre el mismo archivo: cámara o pantalla.
 *
 * `vivo` es el que se dibuja. `suplente` es el que se está preparando para el
 * corte que viene. `armado` dice para qué shot está preparado el suplente, para
 * no volver a mandarlo a buscar cada cuadro.
 */
class Par {
    constructor(url, avisar) {
        this.a = crearVideo(url, { avisar });
        this.b = crearVideo(url, { avisar });
        this.vivo = this.a;
        this.suplente = this.b;
        /** Para qué shot está posicionado el que se está mostrando. */
        this.shotVivo = null;
        /** Para qué shot está preparado el suplente. */
        this.armado = null;
        /** Cuántas veces hubo que buscar en el corte en vez de usar al suplente. */
        this.tirones = 0;
    }

    lista() {
        return Promise.all([listo(this.a), listo(this.b)]);
    }

    /**
     * Prepara al suplente para un corte que todavía no llegó.
     *
     * Lo manda al punto de entrada menos el anticipo y lo pone a correr, así
     * llega al corte ya a velocidad. Si falta menos que el anticipo —hay un
     * shot de 0.27 s en esta clase— lo manda directo al punto de entrada y lo
     * deja quieto: peor es no prepararlo.
     */
    armar(shot, objetivoProxy, faltan, andando) {
        if (this.armado === shot.i) return;
        this.armado = shot.i;

        const anticipo = Math.min(ANTICIPO, Math.max(0, faltan));
        const desde = Math.max(0, objetivoProxy - anticipo);
        const el = this.suplente;
        el.playbackRate = 1;
        el.currentTime = adentroDelCuadro(desde);
        if (andando && anticipo > 0.05) {
            el.play().catch(() => { /* lo alcanza la corrección */ });
        } else if (!el.paused) {
            el.pause();
        }
    }

    /**
     * Llegó el corte: el suplente pasa a ser el que se ve.
     *
     * Solo si de verdad está donde tiene que estar. Un suplente que todavía
     * está buscando daría el mismo cuadro congelado que se quería evitar, y en
     * ese caso es mejor buscar con el que ya está vivo, que al menos tiene
     * imagen mientras tanto.
     */
    cambiar(shot, objetivoProxy, andando, ritmo) {
        const puede = this.armado === shot.i
            && this.suplente.readyState >= 2
            && Math.abs(this.suplente.currentTime - objetivoProxy) <= DERIVA_MAXIMA;

        if (puede) {
            const viejo = this.vivo;
            this.vivo = this.suplente;
            this.suplente = viejo;
            if (!viejo.paused) viejo.pause();
        } else {
            this.tirones++;
            this.vivo.currentTime = adentroDelCuadro(objetivoProxy);
        }

        this.armado = null;
        this.shotVivo = shot.i;
        this.vivo.playbackRate = ritmo;
        arrancarSiHace(this.vivo, andando);
    }

    /** Lo que el compositor dibuja. */
    cuadro() {
        return this.vivo.readyState >= 2 ? this.vivo : null;
    }

    parar() {
        for (const el of [this.a, this.b]) if (!el.paused) el.pause();
    }

    soltar() {
        for (const el of [this.a, this.b]) {
            el.pause();
            el.removeAttribute('src');
            el.load();
            el.remove();
        }
    }
}

/**
 * Una pista sola: el fondo en loop, o un overlay.
 *
 * No necesita par porque no la cortan: el fondo corre en tiempo de línea de
 * tiempo de principio a fin, y un overlay se enciende una vez y se apaga.
 */
class Pista {
    constructor(url, { loop = false, ciclo = 0, avisar = null } = {}) {
        this.el = crearVideo(url, { loop, avisar });
        /** Cuánto dura la vuelta, si es un loop. Cero si no lo es. */
        this.ciclo = ciclo;
    }

    lista() {
        return listo(this.el);
    }

    seguir(objetivo, estado) {
        corregir(this.el, objetivo, { ...estado, ciclo: this.ciclo });
        arrancarSiHace(this.el, estado.andando);
    }

    cuadro() {
        return this.el.readyState >= 2 ? this.el : null;
    }

    parar() {
        if (!this.el.paused) this.el.pause();
    }

    soltar() {
        this.el.pause();
        this.el.removeAttribute('src');
        this.el.load();
        this.el.remove();
    }
}

/**
 * Las escenas: diez archivos distintos, uno a la vez.
 *
 * El par acá no es sobre el mismo archivo sino sobre dos archivos: el de ahora
 * y el que viene. Adentro de una escena no hay salto —dura varios shots y
 * avanza con la línea de tiempo— así que una vez que arrancó se la deja correr.
 *
 * Diez elementos a la vez sería lo más simple y es lo que NO se hace: son diez
 * decodificadores VP9 con alfa abiertos todo el tiempo, y el alfa en VP9 se
 * decodifica por software.
 */
class Escenario {
    constructor(urls, avisar) {
        this.urls = urls;
        this.avisar = avisar;
        this.actual = null;
        this.siguiente = null;
    }

    /** Deja listo el elemento de una escena, creándolo si hace falta. */
    preparar(nombre) {
        if (!nombre || !this.urls[nombre]) return null;
        if (this.actual && this.actual.nombre === nombre) return this.actual;
        if (this.siguiente && this.siguiente.nombre === nombre) return this.siguiente;

        const puesto = { nombre, el: crearVideo(this.urls[nombre], { avisar: this.avisar }) };
        // El que estuviera esperando y no se usó se tira: la escena cambió de
        // plan —el editor saltó a otro lado— y mantenerlo abierto es un
        // decodificador que nadie va a mirar.
        if (this.siguiente) this.tirar(this.siguiente);
        this.siguiente = puesto;
        return puesto;
    }

    /** Pone en primer plano la escena pedida y jubila la anterior. */
    usar(nombre) {
        if (this.actual && this.actual.nombre === nombre) return this.actual;

        const puesto = this.preparar(nombre);
        if (this.actual) this.tirar(this.actual);
        this.actual = puesto;
        if (this.siguiente === puesto) this.siguiente = null;
        return puesto;
    }

    seguir(objetivo, estado) {
        if (!this.actual) return;
        corregir(this.actual.el, objetivo, estado);
        arrancarSiHace(this.actual.el, estado.andando);
    }

    cuadro() {
        return this.actual && this.actual.el.readyState >= 2 ? this.actual.el : null;
    }

    /**
     * El cuadro de UNA escena con nombre, o `null` si la puesta es otra.
     *
     * El nombre no es un detalle: el compositor tiene que dibujar la escena
     * que el shot pide y ninguna otra. Pedir «el cuadro que haya» dejaba la
     * escena anterior pintada encima de los shots de pantalla que vienen
     * después, que es un cartel de título flotando sobre el código.
     */
    cuadroDe(nombre) {
        if (!nombre || !this.actual || this.actual.nombre !== nombre) return null;
        return this.actual.el.readyState >= 2 ? this.actual.el : null;
    }

    tirar(puesto) {
        puesto.el.pause();
        puesto.el.removeAttribute('src');
        puesto.el.load();
        puesto.el.remove();
    }

    parar() {
        for (const p of [this.actual, this.siguiente]) if (p && !p.el.paused) p.el.pause();
    }

    soltar() {
        for (const p of [this.actual, this.siguiente]) if (p) this.tirar(p);
        this.actual = null;
        this.siguiente = null;
    }
}

/**
 * Las imágenes fijas: máscaras, aros, logo y subrayados.
 *
 * Se cargan todas antes de empezar y no por demanda. Son unos pocos cientos de
 * kilobytes en total, y una máscara que llega tarde es una caja de profesor sin
 * recortar durante medio segundo: un error que no se puede corregir después
 * porque ese cuadro ya pasó.
 */
async function cargarImagenes(urls) {
    const mapa = new Map();
    await Promise.all(Object.entries(urls).map(([ruta, url]) => new Promise(resolve => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        // Una imagen que no carga no frena la apertura: el compositor dibuja
        // sin ella. `edicion.js` ya avisó cuál falta.
        img.onload = () => { mapa.set(ruta, img); resolve(); };
        img.onerror = () => resolve();
        img.src = url;
    })));
    return mapa;
}

/**
 * Arma todas las fuentes de una edición y espera a que den cuadro.
 *
 * @param {object} edicion  lo que devolvió `engine/edicion.js`
 * @param {object} urls     ruta absoluta → url del protocolo
 */
export async function abrir(edicion, urls) {
    const dameUrl = ruta => (ruta ? urls[ruta] : null);

    const fuentes = {
        cam: null,
        screen: null,
        bg: null,
        escenas: null,
        overlays: [],
        imagenes: new Map(),
        /**
         * Qué hacer cuando una fuente llega a su cuadro. Lo pone el motor.
         *
         * Vive acá y no en cada clase porque los elementos se crean antes que
         * el motor; el rodeo es lo que permite que hasta el último video que
         * se cree —una escena a los cinco minutos de revisión— quede avisando
         * al motor que esté abierto en ese momento.
         */
        alLlegar: () => {}
    };
    const avisar = () => fuentes.alLlegar();

    if (edicion.medios.cam) fuentes.cam = new Par(dameUrl(edicion.medios.cam.ruta), avisar);
    if (edicion.medios.screen) fuentes.screen = new Par(dameUrl(edicion.medios.screen.ruta), avisar);
    if (edicion.medios.bg_loop) {
        fuentes.bg = new Pista(dameUrl(edicion.medios.bg_loop.ruta), {
            loop: true,
            ciclo: edicion.medios.bg_loop.loop_dur || 0,
            avisar
        });
    }

    const urlsEscenas = {};
    for (const [nombre, e] of Object.entries(edicion.escenas)) urlsEscenas[nombre] = dameUrl(e.ruta);
    fuentes.escenas = new Escenario(urlsEscenas, avisar);

    // En el mismo orden que `edicion.overlays`: el plan los nombra por índice.
    fuentes.overlays = edicion.overlays.map(ov => new Pista(dameUrl(ov.ruta), { avisar }));

    // Las imágenes que el compositor va a pedir por ruta absoluta. La lista
    // la hizo `edicion.leer`, que es el que sabe qué rutas son imágenes.
    const imagenes = {};
    for (const ruta of edicion.imagenes) imagenes[ruta] = urls[ruta];

    const [, , , mapa] = await Promise.all([
        fuentes.cam ? fuentes.cam.lista() : null,
        fuentes.screen ? fuentes.screen.lista() : null,
        fuentes.bg ? fuentes.bg.lista() : null,
        cargarImagenes(imagenes)
    ]);
    fuentes.imagenes = mapa;

    return fuentes;
}

/**
 * Cierra las fuentes de UN motor.
 *
 * Cada elemento se quita solo, y el corral se saca únicamente si quedó vacío:
 * el corral es compartido, y llevárselo entero mientras otro motor tiene sus
 * videos adentro los desconecta del documento y Chromium les corta la
 * decodificación.
 */
export function cerrar(fuentes) {
    if (!fuentes) return;
    // Primero se corta el aviso: un `seeked` que llegue tarde no tiene a quién
    // despertar, y el motor que lo escuchaba ya está cerrado.
    fuentes.alLlegar = () => {};
    for (const p of [fuentes.cam, fuentes.screen, fuentes.bg, fuentes.escenas]) if (p) p.soltar();
    for (const o of fuentes.overlays) o.soltar();
    const caja = document.getElementById('preview-fuentes');
    if (caja && !caja.children.length) caja.remove();
}

export { Par, Pista, Escenario, buscar, listo, corregir, adentroDelCuadro, cuadroPedido, ANTICIPO, DERIVA_MAXIMA };
