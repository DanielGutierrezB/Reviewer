'use strict';
/**
 * motor.js — El preview se hace pasar por un `<video>`.
 *
 * El reproductor de la app —cuadro a cuadro, J/K/L, marcas de entrada y
 * salida, arrastrar el cabezal, el dibujo encima— está escrito contra un
 * `<video>`: lee `currentTime`, escribe `currentTime`, toca `playbackRate`,
 * escucha `timeupdate` y `seeked`. Todo eso ya funciona y está probado.
 *
 * Así que el preview no trae un reproductor nuevo: trae un objeto que contesta
 * las mismas preguntas. Adentro hay un `<audio>` llevando el compás, ocho
 * videos ocultos y un canvas; afuera se ve un `<video>` más. Eso es lo que
 * permite que doscientas líneas de atajos y de gestos no se escriban dos veces
 * —y, sobre todo, que no se despeguen una de la otra con el tiempo.
 *
 * **El reloj es `mix.m4a` y no un cronómetro propio.** El audio ya viene
 * mezclado y normalizado en tiempo de línea de tiempo, y es lo único que no se
 * puede reconstruir cuadro a cuadro: si la imagen se atrasa, se la alcanza; si
 * el audio se corta, se escucha. Un reloj de software tendría que pelearse con
 * el audio igual, y perdería.
 */

import * as modelo from './modelo.js';
import * as fuentesLib from './fuentes.js';
import { Compositor } from './compositor.js';

/** Cada cuánto se avisa del tiempo hacia afuera. Un `<video>` real ronda esto. */
const AVISO_TIEMPO = 100;

/**
 * Cuánto se puede sostener la imagen anterior esperando a una fuente.
 *
 * En MILISEGUNDOS de reloj, no en vueltas del lazo. Contarlo en vueltas era el
 * error: arrastrando el cabezal hay dos dibujos por cada movimiento del
 * puntero, así que diez vueltas se gastaban en cinco movimientos —menos de una
 * décima de segundo— y de ahí en adelante se dibujaba el cuadro a medias.
 * Medido en un arrastre de cuarenta pasos, veinticuatro salían negros.
 *
 * Y el plazo se reinicia cada vez que cambia el cuadro pedido, así que lo que
 * mide es «cuánto hace que espero ESTE cuadro». Arrastrando, el cuadro pedido
 * cambia a cada paso y el plazo no se agota nunca: se ve el último cuadro
 * bueno siguiendo al dedo, que es lo que se quiere. Quieto, si en un segundo
 * la fuente no llegó es que no va a llegar, y esconderlo detrás de una imagen
 * congelada sería peor que mostrar que falta.
 */
const SOSTEN_MAXIMO = 1000;

export class Motor extends EventTarget {
    constructor(edicion, fuentes, urls, destino) {
        super();
        this.edicion = edicion;
        this.fuentes = fuentes;
        this.compositor = new Compositor(edicion, fuentes.imagenes, destino);
        this.canvas = this.compositor.canvas;

        this.audio = new Audio();
        this.audio.crossOrigin = 'anonymous';
        this.audio.preload = 'auto';
        this.audio.src = urls[edicion.medios.mix.ruta];

        this.ritmo = 1;
        this.lazo = null;
        this.ultimoAviso = 0;
        /** Hay que volver a dibujar aunque el reloj no se haya movido. */
        this.sucio = true;
        this.cerrado = false;

        /**
         * Lo que pasó mientras se reproducía, para medir en vez de opinar.
         *
         * `sinImagen` es el número que importa: cuántos cuadros no se pudieron
         * componer al primer intento porque una fuente que el layout pedía no
         * tenía cuadro que dar. Reproduciendo, cada uno es un cuadro repetido
         * —el que el pre-seek existe para evitar— y tiene que quedar en cero.
         */
        this.diagnostico = { cuadros: 0, sinImagen: 0, saltosEnCorte: 0, cortes: 0, huecos: [] };

        /**
         * Desde cuándo se espera al cuadro `f`, o `null` si no falta nada.
         * Lleva el cuadro adentro para que cambiar de cuadro reinicie el plazo.
         */
        this.esperando = null;

        /**
         * Si lo que hay en el lienzo es un cuadro completo.
         *
         * Sostener solo tiene sentido si lo que se sostiene vale: una vez que
         * se dibujó uno a medias, volver a sostenerlo deja el error pegado en
         * pantalla para siempre. Así un hueco de cuarenta milisegundos se
         * convertía en una imagen negra hasta que el editor tocara algo.
         */
        this.entero = false;

        // Cualquier fuente que llegue a su cuadro despierta al lazo. En pausa
        // el lazo está dormido y este es el único aviso que hay.
        fuentes.alLlegar = () => { this.sucio = true; };

        this.audio.addEventListener('play', () => this.dispatchEvent(new Event('play')));
        this.audio.addEventListener('pause', () => this.dispatchEvent(new Event('pause')));
        this.audio.addEventListener('ended', () => this.dispatchEvent(new Event('ended')));
        this.audio.addEventListener('seeked', () => {
            this.sucio = true;
            this.dispatchEvent(new Event('seeked'));
        });
    }

    // ─── La cara de `<video>` ─────────────────────────────────────────

    get src() {
        return this.cerrado ? '' : this.edicion.archivo;
    }

    get duration() {
        return this.edicion.duracion;
    }

    get currentTime() {
        return this.audio.currentTime || 0;
    }

    set currentTime(valor) {
        const t = Math.max(0, Math.min(this.duration - 1e-3, Number(valor) || 0));
        this.audio.currentTime = t;
        // Dibujar ya, sin esperar al `seeked` del audio: arrastrando el cabezal
        // eso es la diferencia entre ver la imagen seguir al dedo y verla
        // llegar tarde. Lo que falte lo repinta el aviso de cada fuente.
        this.pintar(t);
    }

    get paused() {
        return this.audio.paused;
    }

    get playbackRate() {
        return this.ritmo;
    }

    set playbackRate(valor) {
        this.ritmo = Math.max(0.1, Number(valor) || 1);
        this.audio.playbackRate = this.ritmo;
    }

    get videoWidth() {
        return this.edicion.ancho;
    }

    get videoHeight() {
        return this.edicion.alto;
    }

    play() {
        return this.audio.play().catch(() => {});
    }

    pause() {
        this.audio.pause();
        for (const p of [this.fuentes.cam, this.fuentes.screen, this.fuentes.bg, this.fuentes.escenas]) {
            if (p) p.parar();
        }
        for (const o of this.fuentes.overlays) o.parar();
        this.sucio = true;
    }

    // ─── El lazo ──────────────────────────────────────────────────────

    arrancar() {
        if (this.lazo) return;
        const paso = () => {
            this.lazo = requestAnimationFrame(paso);
            this.vuelta();
        };
        this.lazo = requestAnimationFrame(paso);
    }

    parar() {
        if (this.lazo) cancelAnimationFrame(this.lazo);
        this.lazo = null;
    }

    /**
     * Una vuelta del lazo.
     *
     * En pausa no se dibuja salvo que algo haya cambiado: con el preview
     * quieto, repintar 1920x1080 sesenta veces por segundo es calentar la
     * máquina para mostrar el mismo cuadro.
     *
     * Quién baja la bandera es `pintar` y no esta función. «Sucio» quiere
     * decir «lo que hay en pantalla todavía no es el cuadro definitivo», y el
     * único que sabe eso es el que acaba de intentar dibujarlo: bajarla acá,
     * antes de saber cómo salió, perdía los reintentos de un cuadro al que le
     * faltaba una fuente.
     */
    vuelta() {
        if (this.cerrado) return;
        const andando = !this.audio.paused;
        if (!andando && !this.sucio) return;

        const t = this.currentTime;
        this.pintar(t);

        if (andando) {
            const ahora = performance.now();
            if (ahora - this.ultimoAviso >= AVISO_TIEMPO) {
                this.ultimoAviso = ahora;
                this.dispatchEvent(new Event('timeupdate'));
            }
        }
    }

    /**
     * Pone cada fuente donde tiene que estar y dibuja el cuadro de `t`.
     *
     * Si alguna fuente que el layout pide no tiene cuadro que dar, **no se
     * dibuja nada**: se deja en pantalla el cuadro anterior. Sostener la
     * imagen una centésima de segundo no se ve; dibujar el cuadro sin una de
     * sus capas sí —es el fondo sin la escena, o la pantalla sin la cámara—, y
     * encima es el error que parece un bug del montaje y no de la app.
     *
     * El sostén tiene tope. Si una fuente se rompió de verdad —un archivo que
     * se fue del disco a mitad de una revisión— congelar la imagen para
     * siempre sería esconder el problema; pasado el tope se dibuja lo que hay
     * y se ve que falta algo.
     */
    pintar(t) {
        const plan = modelo.planDe(this.edicion, t);
        this.acomodar(plan);

        const falta = this.queFalta(plan);
        if (!falta) {
            this.esperando = null;
            this.sucio = false;
            this.compositor.dibujar(this.fuentes, plan);
            this.entero = true;
            this.diagnostico.cuadros++;
            return;
        }

        // El plazo cuenta desde que se pidió ESTE cuadro. Un cuadro distinto
        // es una espera distinta y empieza de cero.
        const ahora = performance.now();
        if (!this.esperando || this.esperando.f !== plan.f) {
            this.esperando = { f: plan.f, desde: ahora };
            this.anotarHueco(plan, falta);
        }

        if (this.entero && ahora - this.esperando.desde < SOSTEN_MAXIMO) {
            // Volver a mirar en la próxima vuelta. La fuente está en camino, y
            // en pausa el lazo se duerme en cuanto se baje esta bandera: un
            // reintento barato —`queFalta` son cuatro `readyState`— es más de
            // fiar que depender de que llegue el aviso de la fuente.
            this.sucio = true;
            return;
        }

        this.sucio = false;
        this.compositor.dibujar(this.fuentes, plan);
        this.entero = false;
        this.diagnostico.cuadros++;
    }

    /**
     * Deja cada fuente en el instante que le toca y prepara el próximo corte.
     *
     * El orden importa poco salvo en una cosa: el relevo del par A/B se decide
     * ANTES de dibujar, para que el cuadro que se dibuja sea el del elemento
     * que ya está en posición y no el del que acaba de quedar libre.
     */
    acomodar(plan) {
        const ed = this.edicion;
        const { t, shot, usa } = plan;
        const andando = !this.audio.paused;
        const ritmo = this.ritmo;
        const estado = { andando, ritmo, fps: ed.fps };

        for (const nombre of ['cam', 'screen']) {
            const par = this.fuentes[nombre];
            if (!par) continue;
            const medio = ed.medios[nombre];
            const objetivo = plan.proxy[nombre];

            if (usa.has(nombre)) {
                if (par.shotVivo !== shot.i) {
                    const antes = par.tirones;
                    par.cambiar(shot, objetivo, andando, ritmo);
                    this.diagnostico.cortes++;
                    if (par.tirones > antes) this.diagnostico.saltosEnCorte++;
                } else {
                    fuentesLib.corregir(par.vivo, objetivo, estado);
                    if (andando && par.vivo.paused) par.vivo.play().catch(() => {});
                    if (!andando && !par.vivo.paused) par.vivo.pause();
                }
            } else if (!par.vivo.paused) {
                // Decodificar una fuente que el layout no dibuja es gastar un
                // decodificador en una imagen que nadie va a ver.
                par.vivo.pause();
            }

            // El relevo se prepara aunque la fuente no se esté usando ahora:
            // justamente el caso difícil es volver a la cámara después de tres
            // shots de pantalla.
            const proximo = modelo.proximoUso(ed, shot.i, nombre);
            if (proximo) {
                const faltan = modelo.salidaDe(ed, proximo) - t;
                if (faltan >= 0 && faltan <= fuentesLib.ANTICIPO) {
                    par.armar(proximo, modelo.enProxy(medio, proximo.src), faltan, andando);
                }
            }
        }

        // El fondo corre SIEMPRE, lo dibuje o no el layout de ahora.
        //
        // Es la excepción a «pausá lo que no se usa», y la razón está medida:
        // pausarlo lo deja clavado donde estaba, y al volver —después de
        // cuatro shots de cámara— hay que mandarlo veinte segundos adelante,
        // que es una búsqueda de varios cuadros. Eso era el único hueco de
        // imagen que quedaba en el minuto de prueba.
        //
        // Dejarlo correr cuesta un decodificador 1080p de más. Es barato al
        // lado de las dos fuentes grandes, que son las que sí se pausan: el
        // fondo es un loop de quince segundos y las otras son archivos de
        // cientos de megas.
        if (this.fuentes.bg) this.fuentes.bg.seguir(plan.fondo, estado);

        // La escena corre mientras dure su ventana, la dibuje este shot o no
        // (ver `modelo.escenaEnCurso`). Afuera de toda ventana se para: dejarla
        // correr es un VP9 con alfa decodificándose por software para nadie.
        const esc = plan.escenaQueCorre;
        if (esc) {
            this.fuentes.escenas.usar(esc.nombre);
            this.fuentes.escenas.seguir(esc.t, estado);
        } else {
            this.fuentes.escenas.parar();
        }

        // La que viene se prepara SIEMPRE, haya una escena en pantalla o no.
        //
        // Que esto estuviera adentro del `if` de arriba era el error: entre la
        // escena del título y la siguiente hay veinte segundos de cámara sin
        // ninguna escena, así que justo cuando había tiempo de sobra para ir
        // abriendo la que venía, no se abría. Abrir un VP9 con alfa y sacarle
        // el primer cuadro no es instantáneo, y una escena que llega tarde se
        // ve como un parpadeo del fondo en el corte.
        const siguiente = this.proximaEscena(t);
        if (siguiente && (!esc || siguiente !== esc.nombre)) this.fuentes.escenas.preparar(siguiente);

        this.fuentes.overlays.forEach((o, i) => {
            const activo = plan.overlays.find(x => x.i === i);
            if (activo) o.seguir(activo.t, estado);
            else o.parar();
        });
    }

    /** La próxima escena distinta que entra en el próximo segundo y medio. */
    proximaEscena(t) {
        let elegida = null;
        let cuando = Infinity;
        for (const [nombre, e] of Object.entries(this.edicion.escenas)) {
            const falta = e.out - t;
            if (falta > 0 && falta < 1.5 && falta < cuando) {
                cuando = falta;
                elegida = nombre;
            }
        }
        return elegida;
    }

    /**
     * Qué fuente de las que el layout pide no tiene cuadro que dar.
     *
     * Se compara lo que el layout PEDÍA contra lo que las fuentes dieron.
     * Contar píxeles negros no serviría: hay cuadros de la clase que son casi
     * negros de verdad.
     */
    queFalta({ shot, usa, escena, overlays }) {
        const fu = this.fuentes;
        if (usa.has('cam') && !(fu.cam && fu.cam.cuadro())) return 'cam';
        if (usa.has('screen') && !(fu.screen && fu.screen.cuadro())) return 'screen';
        if (usa.has('bg_loop') && !(fu.bg && fu.bg.cuadro())) return 'bg_loop';
        if (escena && !fu.escenas.cuadroDe(escena.nombre)) return `escena ${shot.scene}`;

        // Los overlays no están en `fuentesDe` porque no dependen del layout:
        // van encima de cualquiera. Pero dibujar el cuadro sin la pausa es el
        // mismo error que dibujarlo sin la escena, y se ve igual de raro.
        for (const { i, overlay } of overlays) {
            if (!fu.overlays[i].cuadro()) return `overlay ${overlay.file}`;
        }
        return null;
    }

    /**
     * Deja constancia de un cuadro que no se pudo componer entero.
     *
     * Con qué faltó y cuándo, no solo cuántos: la diferencia entre «la cámara
     * llega tarde a un corte» y «una escena tarda en abrir» son dos arreglos
     * distintos, y el número solo no los distingue.
     */
    anotarHueco({ t, shot }, falta) {
        this.diagnostico.sinImagen++;
        if (this.diagnostico.huecos.length < 20) {
            this.diagnostico.huecos.push({ t: Math.round(t * 100) / 100, shot: shot.i, falta });
        }
    }

    /**
     * Lleva el cabezal a un instante y espera a que TODAS las fuentes lleguen.
     *
     * Es la diferencia entre el scrub —donde se dibuja lo que haya y se repinta
     * cuando llega— y sacar un PNG para un comentario o comparar contra el
     * render, donde el cuadro tiene que ser el exacto.
     */
    async irExacto(t) {
        const ed = this.edicion;
        const fu = this.fuentes;
        this.pause();
        this.audio.currentTime = Math.max(0, Math.min(this.duration - 1e-3, t));

        const plan = modelo.planDe(ed, t);
        const { shot, usa } = plan;
        const esperas = [];

        for (const nombre of ['cam', 'screen']) {
            const par = fu[nombre];
            if (!par || !usa.has(nombre)) continue;
            par.shotVivo = shot.i;
            esperas.push(fuentesLib.buscar(par.vivo, plan.proxy[nombre], ed.fps));
        }
        if (usa.has('bg_loop') && fu.bg) esperas.push(fuentesLib.buscar(fu.bg.el, plan.fondo, ed.fps));
        if (plan.escena) {
            const puesto = fu.escenas.usar(plan.escena.nombre);
            if (puesto) {
                await fuentesLib.listo(puesto.el);
                esperas.push(fuentesLib.buscar(puesto.el, plan.escena.t, ed.fps));
            }
        }
        for (const { i, t: dentro } of plan.overlays) {
            esperas.push(fuentesLib.buscar(fu.overlays[i].el, dentro, ed.fps));
        }

        await Promise.all(esperas);
        this.compositor.dibujar(fu, plan);
        this.esperando = null;
        this.entero = true;
        this.sucio = false;
        return plan;
    }

    /**
     * El cuadro de `t` en PNG, compuesto entero.
     *
     * Es lo que se guarda como cuadro de un comentario. En una edición no hay
     * un archivo del que ffmpeg pueda sacarlo: la imagen solo existe compuesta,
     * acá. Deja el cabezal en `t`, que es donde ya está cuando se comenta.
     */
    async png(t) {
        await this.irExacto(t);
        const blob = await new Promise(resolve => this.canvas.toBlob(resolve, 'image/png'));
        return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
    }

    /**
     * El corte anterior o el siguiente, para las flechas arriba y abajo.
     *
     * Lo contesta el motor y no el reproductor para que el reproductor no
     * tenga que saber qué es un shot: desde afuera esto sigue siendo «un
     * `<video>` que además sabe dónde están sus cortes».
     *
     * @returns {number|null} el instante, o `null` si no hay a dónde ir
     */
    corteVecino(sentido) {
        return modelo.saltoDeCorte(this.edicion, this.currentTime, sentido);
    }

    cerrar() {
        this.cerrado = true;
        this.parar();
        this.audio.pause();
        this.audio.removeAttribute('src');
        this.audio.load();
        fuentesLib.cerrar(this.fuentes);
        this.compositor.soltar();
    }
}

/**
 * Abre una edición y deja el motor listo para reproducir.
 *
 * @param {object} edicion lo que devolvió `engine/edicion.js`
 * @param {object} urls    ruta absoluta → url del protocolo
 * @param {HTMLCanvasElement} [destino] dónde se dibuja
 */
export async function abrir(edicion, urls, destino) {
    const fuentes = await fuentesLib.abrir(edicion, urls);
    const motor = new Motor(edicion, fuentes, urls, destino);

    await new Promise(resolve => {
        if (motor.audio.readyState >= 1) return resolve();
        motor.audio.addEventListener('loadedmetadata', resolve, { once: true });
        // Un `mix.m4a` que no carga no puede dejar la app esperando para
        // siempre: se abre igual y se ve, aunque sin audio el cabezal no corra.
        motor.audio.addEventListener('error', resolve, { once: true });
    });

    await motor.irExacto(0);
    motor.arrancar();
    motor.dispatchEvent(new Event('loadedmetadata'));
    return motor;
}
