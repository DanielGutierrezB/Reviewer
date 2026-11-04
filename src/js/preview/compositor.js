'use strict';
/**
 * compositor.js — Armar un cuadro de 1920x1080 a partir de los videos ocultos.
 *
 * Esto es lo que reemplaza al render. Cada cuadro se dibuja en el orden exacto
 * en que lo hace el exportador de Claude, porque el orden ES la imagen: el
 * subrayado va DENTRO de la capa de pantalla y por eso se acerca con el zoom,
 * mientras que la escena va ENCIMA y por eso no. Cambiar dos pasos de lugar da
 * un cuadro que se parece y no es el mismo.
 *
 * Dos sistemas de coordenadas conviven acá y mezclarlos es el error caro:
 *
 * - Todo lo que dice el `edit.json` —recortes, cajas, blur, subrayados, zoom—
 *   está en píxeles de la FUENTE de 1920x1080.
 * - El proxy de cámara mide 1280x720, así que leer de él pide multiplicar por
 *   2/3. El de pantalla mide 1920x1080 y va uno a uno.
 *
 * La conversión pasa en un solo lugar —`recorteDe`— y lo más tarde posible.
 * Todo lo demás razona en coordenadas de fuente.
 */

const ANCHO = 1920;
const ALTO = 1080;

function lienzo(ancho, alto) {
    const c = document.createElement('canvas');
    c.width = ancho;
    c.height = alto;
    return c;
}

/** El mejor filtro de escalado que ofrezca el navegador. */
function afinar(ctx) {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    return ctx;
}

/**
 * El recorte a pedirle a un video, traducido a los píxeles que de verdad tiene.
 *
 * @param {object} medio  `edicion.medios.cam`, con `source_size` y `proxy_size`
 * @param {number[]} rect `[x,y,w,h]` en píxeles de la fuente
 */
function recorteDe(medio, rect) {
    const fuente = (medio && medio.source_size) || [ANCHO, ALTO];
    const proxy = (medio && medio.proxy_size) || fuente;
    const kx = proxy[0] / fuente[0];
    const ky = proxy[1] / fuente[1];
    return [rect[0] * kx, rect[1] * ky, rect[2] * kx, rect[3] * ky];
}

export class Compositor {
    /**
     * @param {object} edicion
     * @param {Map<string, HTMLImageElement>} imagenes máscaras, aros, logo y
     *   subrayados, por ruta absoluta. Las cargó `fuentes.abrir`.
     * @param {HTMLCanvasElement} [destino] el canvas de la pantalla. Sin él se
     *   compone en uno suelto, que es lo que hace falta para medir sin ventana.
     */
    constructor(edicion, imagenes, destino) {
        this.edicion = edicion;
        this.imagenes = imagenes;
        /** Si el canvas es nuestro o prestado. Decide qué se puede destruir. */
        this.propio = !destino;
        this.canvas = destino || lienzo(ANCHO, ALTO);
        this.canvas.width = ANCHO;
        this.canvas.height = ALTO;
        this.ctx = this.canvas.getContext('2d', { alpha: false });
        // Casi todo lo que se dibuja acá se agranda: la cámara viene de un
        // proxy de 720p y las escenas también, y los recortes de `CAM_MED`
        // llegan a estirar 896x504 hasta 1920x1080. Con el filtro por defecto
        // esas ampliaciones quedan más blandas que las del render y la
        // diferencia se ve en el borde de cada letra. Es una línea y es lo que
        // acerca el preview al render donde más se notaba.
        afinar(this.ctx);

        // La capa de pantalla se arma aparte porque el zoom la amplía entera,
        // con el blur y los subrayados ya puestos adentro.
        this.pantalla = lienzo(ANCHO, ALTO);
        this.ctxPantalla = afinar(this.pantalla.getContext('2d'));

        // Para las piezas con máscara: la caja del profesor, el PiP, el lateral.
        // Se redimensiona al vuelo porque cada una mide distinto.
        this.mascara = lienzo(ANCHO, ALTO);
        this.ctxMascara = afinar(this.mascara.getContext('2d'));

        // Para el desenfoque: solo la región y su margen, no el cuadro entero.
        this.borroso = lienzo(256, 256);
        this.ctxBorroso = afinar(this.borroso.getContext('2d'));

        /** El plan del último cuadro dibujado. */
        this.ultimo = null;
    }

    imagen(ruta) {
        return ruta ? this.imagenes.get(ruta) : null;
    }

    /**
     * Una región de cualquier fuente, llevada a `dst` y recortada por una máscara.
     *
     * La máscara se aplica en un canvas aparte con `destination-in`: se dibuja
     * el pedazo, después la máscara encima, y lo que queda es la imagen donde
     * la máscara tenía alfa. Hacerlo sobre el canvas principal borraría todo lo
     * que ya estaba pintado debajo.
     *
     * La fuente puede ser un video —la caja del profesor, el PiP, el lateral—
     * o la capa de pantalla ya ampliada, que es lo que recorta el SPLIT.
     */
    recortado(fuente, src, rutaMascara, dst) {
        const [dx, dy, dw, dh] = dst;
        if (dw <= 0 || dh <= 0) return;

        const m = this.ctxMascara;
        if (this.mascara.width !== dw || this.mascara.height !== dh) {
            this.mascara.width = dw;
            this.mascara.height = dh;
            // Cambiar el tamaño de un canvas reinicia su contexto, y con él el
            // filtro de escalado. Volver a ponerlo acá es lo que evita que la
            // caja del profesor se dibuje con otro filtro que el resto.
            afinar(m);
        }
        m.clearRect(0, 0, dw, dh);
        m.drawImage(fuente, src[0], src[1], src[2], src[3], 0, 0, dw, dh);

        const mascara = this.imagen(rutaMascara);
        if (mascara) {
            m.globalCompositeOperation = 'destination-in';
            m.drawImage(mascara, 0, 0, dw, dh);
            m.globalCompositeOperation = 'source-over';
        }

        this.ctx.drawImage(this.mascara, dx, dy);
    }

    /**
     * El aro de una pieza.
     *
     * Va por fuera del recorte y por eso lleva posición propia: `ring_offset`
     * relativo para la caja, `ring_pos` absoluto para el PiP, el lateral y el
     * split. Son dos convenciones y las dos están en el JSON tal cual.
     */
    aro(geo, dst) {
        const aro = this.imagen(geo.rutaAro);
        if (!aro) return;
        const corrido = geo.ring_offset || [0, 0];
        const pos = geo.ring_pos || [dst[0] + corrido[0], dst[1] + corrido[1]];
        this.ctx.drawImage(aro, pos[0], pos[1]);
    }

    /** Un pedazo de la cámara, enmascarado y con su aro. */
    pieza(cam, geo, dst) {
        if (!cam) return;
        this.recortado(cam, recorteDe(this.edicion.medios.cam, geo.src), geo.rutaMascara, dst);
        this.aro(geo, dst);
    }

    /**
     * Desenfoca una región de la capa de pantalla, en su sitio.
     *
     * Tapa correos y claves de API: si falla, se filtra algo que no tenía que
     * salir. Por eso no se dibuja «el recorte borroso encima» sino que se
     * reconstruye la región con margen, y recién eso se vuelve a pegar
     * recortado al rectángulo. El margen es lo que evita el halo oscuro: sin
     * él, la gaussiana de los bordes chupa transparencia de afuera del recorte
     * y la región queda con un marco negro que en el render no está.
     */
    desenfocar(b) {
        const [x, y, w, h] = b.rect;
        const sigma = b.sigma || 0;
        if (!sigma || w <= 0 || h <= 0) return;

        // Tres sigmas es donde la gaussiana ya no aporta nada visible.
        const margen = Math.ceil(sigma * 3);
        const mx = Math.max(0, x - margen);
        const my = Math.max(0, y - margen);
        const mw = Math.min(ANCHO, x + w + margen) - mx;
        const mh = Math.min(ALTO, y + h + margen) - my;
        if (mw <= 0 || mh <= 0) return;

        if (this.borroso.width !== mw || this.borroso.height !== mh) {
            this.borroso.width = mw;
            this.borroso.height = mh;
            afinar(this.ctxBorroso);
        }
        this.ctxBorroso.clearRect(0, 0, mw, mh);
        this.ctxBorroso.drawImage(this.pantalla, mx, my, mw, mh, 0, 0, mw, mh);

        const c = this.ctxPantalla;
        c.save();
        c.beginPath();
        // Las esquinas redondeadas salen de `radius`, que es lo único que ese
        // campo puede querer decir en un rectángulo de 42 px de alto con
        // radio 19. La comparación contra el render de referencia en el
        // segundo 368.70 es la que lo confirma.
        if (b.radius > 0 && c.roundRect) c.roundRect(x, y, w, h, b.radius);
        else c.rect(x, y, w, h);
        c.clip();
        c.filter = `blur(${sigma}px)`;
        c.drawImage(this.borroso, mx, my);
        c.filter = 'none';
        c.restore();
    }

    /**
     * La capa de pantalla completa: el cuadro, el blur y los subrayados.
     *
     * Se arma siempre a 1920x1080 y sin zoom. El zoom es el paso siguiente y
     * amplía esta capa entera, que es lo que hace que un subrayado se agrande
     * junto con el texto que subraya en vez de quedar flotando del tamaño
     * original.
     */
    capaDePantalla(video, { blurs, subrayados }) {
        const c = this.ctxPantalla;
        c.clearRect(0, 0, ANCHO, ALTO);
        if (video) c.drawImage(video, 0, 0, ANCHO, ALTO);

        for (const b of blurs) this.desenfocar(b);

        for (const { hl, alfa } of subrayados) {
            const img = this.imagen(hl.ruta);
            if (!img) continue;
            c.globalAlpha = alfa;
            c.drawImage(img, hl.pos[0], hl.pos[1]);
            c.globalAlpha = 1;
        }
    }

    /**
     * Dibuja un cuadro tal como lo describe su plan.
     *
     * Acá no se decide nada sobre el tiempo: el plan ya dice qué shot, qué
     * escena, qué zoom y qué subrayados van. Esto solo pinta, en el orden del
     * exportador.
     *
     * @param {object} fuentes  lo que devolvió `fuentes.abrir`
     * @param {object} plan     lo que devolvió `modelo.planDe`
     * @returns {object} el plan, que queda como lo último dibujado
     */
    dibujar(fuentes, plan) {
        const ed = this.edicion;
        const { shot } = plan;
        const g = ed.geometria;

        const ctx = this.ctx;
        ctx.filter = 'none';
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, ANCHO, ALTO);

        const cam = fuentes.cam && fuentes.cam.cuadro();
        const screen = fuentes.screen && fuentes.screen.cuadro();
        const fondo = fuentes.bg && fuentes.bg.cuadro();
        // Por nombre y no «la que esté puesta»: una escena dura varios shots y
        // sigue cargada cuando terminan, así que preguntar por el elemento sin
        // decir cuál dejaba el título de la escena anterior pintado encima de
        // los shots de pantalla que venían después.
        const escena = plan.escena ? fuentes.escenas.cuadroDe(plan.escena.nombre) : null;

        switch (shot.layout) {
            case 'CAM_WIDE':
            case 'CAM_MED': {
                const rect = g.cam_crops && g.cam_crops[shot.layout];
                if (cam && rect) {
                    const [sx, sy, sw, sh] = recorteDe(ed.medios.cam, rect);
                    ctx.drawImage(cam, sx, sy, sw, sh, 0, 0, ANCHO, ALTO);
                }
                break;
            }

            case 'SCENE':
            case 'SCENE_L':
            case 'SCENE_FULL': {
                if (fondo) ctx.drawImage(fondo, 0, 0, ANCHO, ALTO);
                // En SCENE_L la escena se corre 700 px a la derecha y lo que
                // sobra lo recorta el borde del lienzo. Se dibuja igual de
                // ancha: no se reescala, se desplaza.
                const dx = shot.layout === 'SCENE_L' ? (g.scene_l_dx || 0) : 0;
                if (escena) ctx.drawImage(escena, dx, 0, ANCHO, ALTO);

                if (plan.camara === 'caja' && g.box && g.box.dst && g.box.dst[shot.layout]) {
                    this.pieza(cam, g.box, g.box.dst[shot.layout]);
                } else if (plan.camara === 'pip' && g.pip) {
                    this.pieza(cam, g.pip, g.pip.dst);
                }
                break;
            }

            case 'SCREEN': {
                const { vista } = plan.pantalla;
                this.capaDePantalla(screen, plan.pantalla);
                ctx.drawImage(this.pantalla, vista.x, vista.y, vista.w, vista.h, 0, 0, ANCHO, ALTO);
                if (escena) ctx.drawImage(escena, 0, 0, ANCHO, ALTO);
                if (plan.camara === 'pip' && g.pip) this.pieza(cam, g.pip, g.pip.dst);
                break;
            }

            case 'SPLIT': {
                if (fondo) ctx.drawImage(fondo, 0, 0, ANCHO, ALTO);
                if (g.side) this.pieza(cam, g.side, g.side.dst);
                if (g.split_screen) {
                    // La máscara del split recorta la pantalla YA ampliada, así
                    // que la fuente del recorte es la capa armada y no el video.
                    const { vista } = plan.pantalla;
                    this.capaDePantalla(screen, plan.pantalla);
                    this.recortado(this.pantalla, [vista.x, vista.y, vista.w, vista.h],
                        g.split_screen.rutaMascara, g.split_screen.dst);
                    this.aro(g.split_screen, g.split_screen.dst);
                }
                break;
            }

            default:
                // Un layout que no conocemos deja el fondo negro en vez de
                // tirar: una clase nueva con un layout nuevo tiene que poder
                // abrirse para que se vea CUÁL es el que falta.
                break;
        }

        const logo = ed.medios.logo && this.imagen(ed.medios.logo.ruta);
        if (logo) {
            const pos = ed.medios.logo.pos || [0, 0];
            ctx.drawImage(logo, pos[0], pos[1]);
        }

        for (const { i } of plan.overlays) {
            const v = fuentes.overlays[i].cuadro();
            if (v) ctx.drawImage(v, 0, 0, ANCHO, ALTO);
        }

        this.ultimo = plan;
        return plan;
    }

    /**
     * Suelta la memoria de los canvas intermedios.
     *
     * El de la pantalla NO se achica si es prestado: es el `<canvas>` del
     * lienzo, vive en el HTML y puede estar ya en manos de otro compositor.
     * Dejarlo en cero ancho fue justamente lo que hizo que abrir dos veces la
     * misma edición dejara la imagen vacía: el primero en cerrarse apagaba el
     * lienzo del que acababa de quedarse con él.
     */
    soltar() {
        if (this.propio) this.canvas.width = 0;
        this.pantalla.width = 0;
        this.mascara.width = 0;
        this.borroso.width = 0;
    }
}

export { ANCHO, ALTO, recorteDe };
