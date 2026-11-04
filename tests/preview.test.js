'use strict';
/**
 * El modelo de tiempo del preview.
 *
 * Es el único pedazo del preview que se puede probar sin abrir una ventana, y
 * da la casualidad de que es donde están los errores caros: los tres que
 * aparecieron al comparar contra el render de referencia eran todos de acá
 * —el borde del cuadro, el instante crudo en vez del cuadro, la escena que
 * seguía puesta— y ninguno rompía nada. Daban una imagen plausible y
 * equivocada, que es la peor clase de error en una herramienta cuyo trabajo es
 * mostrar la verdad.
 *
 * Los números de los casos de zoom y de subrayado no están inventados: son los
 * shots 21 y 103 del `edit.json` de la clase de prueba, que es lo que el
 * formato propone como banco de pruebas.
 */

/** Una edición de mentira, con lo que se le quiera cambiar. */
function edicionFalsa(cambios) {
    return {
        fps: 30,
        ancho: 1920,
        alto: 1080,
        cuadros: 150,
        duracion: 5,
        medios: { bg_loop: { loop_dur: 15.3 }, cam: { offset: 3364, source_size: [1920, 1080], proxy_size: [1280, 720] } },
        escenas: {
            titulo: { out: 0, dur: 2 },
            tools: { out: 2, dur: 3 }
        },
        overlays: [{ out: 3, dur: 1 }],
        geometria: {},
        shots: [
            { i: 0, f0: 0, nf: 30, src: 100, layout: 'SCENE', scene: 'titulo' },
            { i: 1, f0: 30, nf: 30, src: 200, layout: 'CAM_WIDE' },
            { i: 2, f0: 60, nf: 30, src: 300, layout: 'SCREEN', pip: true },
            { i: 3, f0: 90, nf: 30, src: 400, layout: 'SCENE_L', scene: 'tools' },
            { i: 4, f0: 120, nf: 30, src: 500, layout: 'CAM_MED' }
        ],
        ...(cambios || {})
    };
}

/** El shot 21 de la clase de prueba: el que el formato usa para el zoom. */
const SHOT_21 = {
    i: 21,
    f0: 1855,
    nf: 111,
    src: 3497.9333,
    layout: 'SCREEN',
    pip: true,
    screen: {
        base: [0, 0, 1920],
        focus: [
            { a: 3499.15, b: 3501.9500000000003, rect: [0, 273, 1120] },
            { a: 3502.15, b: 3515.25, rect: [77, 166, 1580] }
        ],
        blur: [],
        highlights: [
            { t0: 3499.5, t1: 3502.5, rect: [322, 568, 276, 40], color: 'g', pos: [316, 562] }
        ]
    }
};

/** El shot 103: el del desenfoque que tapa una clave. */
const SHOT_103 = {
    i: 103,
    f0: 10986,
    nf: 142,
    src: 4525.4,
    layout: 'SCREEN',
    pip: true,
    screen: {
        base: [0, 0, 1920],
        focus: [],
        blur: [{ t0: 4527.4, t1: 4530.6, rect: [642, 624, 514, 42], radius: 19, sigma: 21.85 }],
        highlights: []
    }
};

module.exports = async function (t) {
    const modelo = await import('../src/js/preview/modelo.js');

    t.grupo('Preview · qué shot va en cada cuadro');

    t.test('los bordes de cada shot son exactos', () => {
        // `f0 <= f < f0+nf`, sin un cuadro de margen para ningún lado. Un
        // corte que entra un cuadro tarde no se ve, y es exactamente la clase
        // de diferencia que después aparece comparando contra el render sin
        // que nadie sepa de dónde salió.
        const ed = edicionFalsa();
        for (const shot of ed.shots) {
            t.eq(modelo.shotDeCuadro(ed, shot.f0).i, shot.i, `el primer cuadro del shot ${shot.i}`);
            t.eq(modelo.shotDeCuadro(ed, shot.f0 + shot.nf - 1).i, shot.i, `el último del shot ${shot.i}`);
        }
        t.eq(modelo.shotDeCuadro(ed, 29).i, 0);
        t.eq(modelo.shotDeCuadro(ed, 30).i, 1, 'el cuadro 30 ya es del siguiente');
    });

    t.test('fuera de rango devuelve el primero o el último, nunca nada', () => {
        // Un cuadro más allá del final es lo que pasa AL llegar al final. Ahí
        // lo correcto es seguir mostrando la última imagen; devolver `null`
        // dejaría la pantalla en negro en el último cuadro de cada clase.
        const ed = edicionFalsa();
        t.eq(modelo.shotDeCuadro(ed, -5).i, 0);
        t.eq(modelo.shotDeCuadro(ed, 99999).i, 4);
    });

    t.test('el tiempo de fuente arranca en src y avanza de a un cuadro', () => {
        const ed = edicionFalsa();
        const shot = ed.shots[1];
        t.eq(modelo.fuenteDe(ed, shot, shot.f0), 200);
        t.cerca(modelo.fuenteDe(ed, shot, shot.f0 + 15), 200.5, 1e-9);
        t.cerca(modelo.fuenteDe(ed, shot, shot.f0 + 29), 200 + 29 / 30, 1e-9);
    });

    t.test('el proxy se lee descontando el offset del medio', () => {
        // Sin esta resta se busca el segundo 3382 de un archivo que dura 1839.
        const ed = edicionFalsa();
        t.cerca(modelo.enProxy(ed.medios.cam, 3382.8667), 18.8667, 1e-6);
    });

    t.grupo('Preview · lo que corre con la línea de tiempo');

    t.test('el fondo da la vuelta sin reiniciarse en los cortes', () => {
        const ed = edicionFalsa();
        t.cerca(modelo.tiempoDelFondo(ed, 0), 0, 1e-9);
        t.cerca(modelo.tiempoDelFondo(ed, 30), 1, 1e-9);
        // 15.3 s a 30 fps son 459 cuadros justos: ahí vuelve a cero.
        t.cerca(modelo.tiempoDelFondo(ed, 459), 0, 1e-9);
        t.cerca(modelo.tiempoDelFondo(ed, 460), 1 / 30, 1e-9);
        t.cerca(modelo.tiempoDelFondo(ed, 459 * 3 + 7), 7 / 30, 1e-9);
    });

    t.test('la escena se cuenta en cuadros enteros desde su entrada', () => {
        // Las entradas de las escenas no caen en segundos redondos —en la
        // clase de prueba son 27.9334, 44.9668, 85.2335— así que restarlas en
        // coma flotante deja un resto de milésimas que después decide mal de
        // qué lado del borde cae el cuadro. Con la cuenta en enteros no hay
        // dónde perderse.
        const ed = edicionFalsa({ escenas: { tools: { out: 27.9334, dur: 17.0334 } } });
        const shot = { i: 0, f0: 838, nf: 84, src: 100, layout: 'SCENE_L', scene: 'tools' };

        // El cuadro de entrada se REDONDEA, no se trunca. El JSON trae cuatro
        // decimales, así que 838/30 = 27.93333… puede quedar escrito 27.9333,
        // y truncar eso da 837: la escena entera corrida un cuadro.
        const corta = edicionFalsa({ escenas: { tools: { out: 27.9333, dur: 17 } } });
        t.cerca(modelo.escenaDe(corta, shot, 838).t, 0, 1e-12, 'escrito para abajo');
        t.cerca(modelo.escenaDe(corta, shot, 848).t, 1 / 3, 1e-12);

        // 27.9334 × 30 = 838.002: la escena entra en el cuadro 838.
        t.cerca(modelo.escenaDe(ed, shot, 838).t, 0, 1e-12);
        t.cerca(modelo.escenaDe(ed, shot, 839).t, 1 / 30, 1e-12);
        t.cerca(modelo.escenaDe(ed, shot, 879).t, 41 / 30, 1e-12);

        // Lo que importa de verdad: cada cuadro de la línea de tiempo cae en
        // un cuadro distinto y consecutivo de la escena, sin repetir ni saltar
        // ninguno a lo largo de toda su duración.
        for (let f = 838; f < 838 + 500; f++) {
            t.eq(Math.round(modelo.escenaDe(ed, shot, f).t * ed.fps), f - 838, `el cuadro ${f}`);
        }

        t.eq(modelo.escenaDe(ed, { layout: 'CAM_WIDE' }, 30), null, 'un shot sin escena no tiene ninguna');
        t.eq(modelo.escenaDe(ed, { layout: 'SCENE', scene: 'noexiste' }, 30), null, 'ni una que no está');
    });

    t.test('los overlays se encienden y se apagan en el cuadro justo', () => {
        const ed = edicionFalsa();
        t.eq(modelo.overlaysEn(ed, 89).length, 0);
        t.eq(modelo.overlaysEn(ed, 90).length, 1, 'el segundo 3 ya lo enciende');
        t.cerca(modelo.overlaysEn(ed, 95)[0].t, 5 / 30, 1e-9);
        t.eq(modelo.overlaysEn(ed, 119).length, 1);
        t.eq(modelo.overlaysEn(ed, 120).length, 0, 'un cuadro después del final ya no');
    });

    t.grupo('Preview · el zoom de pantalla (shot 21)');

    t.test('sin foco activo la vista es la base entera', () => {
        const v = modelo.vistaDe(SHOT_21, SHOT_21.src);
        t.deep(v, { x: 0, y: 0, w: 1920, h: 1080 });
    });

    t.test('en el medio del primer foco la vista llegó entera a su rectángulo', () => {
        // Entre 3499.75 y 3501.35 los dos extremos de la rampa están saturados
        // y `k` vale 1, así que la vista es exactamente el rect del foco.
        const v = modelo.vistaDe(SHOT_21, 3500.5);
        t.deep(v, { x: 0, y: 273, w: 1120, h: 630 });
    });

    t.test('la rampa entra suave: a la mitad no va por la mitad', () => {
        // `e = k²(3−2k)` con k = 0.5 da 0.5, pero con k = 0.25 da 0.156, no
        // 0.25. Que la interpolación sea suave es lo que hace que el zoom no
        // arranque de golpe, y comprobarlo con un punto cualquiera no sirve:
        // una rampa lineal también pasaría por el medio.
        const k = 0.25;
        const e = k * k * (3 - 2 * k);
        const T = 3499.15 + k * 0.6;
        const v = modelo.vistaDe(SHOT_21, T);
        t.eq(v.w, Math.round(1920 + e * (1120 - 1920)));
        t.ok(v.w > 1920 - 0.25 * 800, 'va más atrás que una rampa recta');
    });

    t.test('el alto sale del ancho en 16:9 y el recorte entra en el cuadro', () => {
        for (let T = 3498; T < 3516; T += 0.17) {
            const v = modelo.vistaDe(SHOT_21, T);
            t.eq(v.h, Math.round((v.w * 9) / 16), `16:9 en ${T.toFixed(2)}`);
            t.ok(v.w >= 320 && v.w <= 1920, `ancho posible en ${T.toFixed(2)}`);
            t.ok(v.x >= 0 && v.x + v.w <= 1920, `entra a lo ancho en ${T.toFixed(2)}`);
            t.ok(v.y >= 0 && v.y + v.h <= 1080, `entra a lo alto en ${T.toFixed(2)}`);
        }
    });

    t.test('dos focos que se pisan se suman sobre la base y no se encadenan', () => {
        // Los dos focos del shot 21 no llegan a solaparse —uno termina en
        // 3501.95 y el otro empieza en 3502.15— así que con ellos las dos
        // cuentas dan lo mismo y no probarían nada. Hace falta un caso
        // armado donde de verdad se pisen.
        //
        // Encadenarlos —interpolar el segundo contra la vista que dejó el
        // primero en vez de contra la base— da un zoom que se va de escala
        // justo donde se solapan, que es donde más se nota.
        const shot = {
            i: 0, f0: 0, nf: 900, src: 0, layout: 'SCREEN',
            screen: {
                base: [0, 0, 1920],
                focus: [
                    { a: 10, b: 20, rect: [100, 50, 1500] },
                    { a: 15, b: 25, rect: [200, 100, 1600] }
                ],
                blur: [], highlights: []
            }
        };

        // En 17.5 los dos pesan 1: están pasada la rampa de entrada y lejos de
        // la de salida. Sumando sobre la base: 1920 − 420 − 320 = 1180.
        // Encadenando daría 1600, que es el rect del segundo y nada más.
        const v = modelo.vistaDe(shot, 17.5);
        t.eq(v.w, 1180, 'el ancho suma los dos desplazamientos');
        t.eq(v.x, 300, 'y la posición también');
    });

    t.grupo('Preview · los subrayados (shot 21)');

    t.test('fuera de su tramo no se ve nada', () => {
        const hl = SHOT_21.screen.highlights[0];
        t.eq(modelo.opacidadDe(hl, 3499.49, SHOT_21), 0);
        t.eq(modelo.opacidadDe(hl, 3502.5, SHOT_21), 0, 'el final es abierto');
    });

    t.test('entra en un cuarto de segundo y se va en otro', () => {
        const hl = SHOT_21.screen.highlights[0];
        t.cerca(modelo.opacidadDe(hl, 3499.625, SHOT_21), 0.5, 1e-6);
        t.cerca(modelo.opacidadDe(hl, 3499.75, SHOT_21), 1, 1e-6);
        t.cerca(modelo.opacidadDe(hl, 3502.375, SHOT_21), 0.5, 1e-6);
    });

    t.test('un subrayado que venía de antes del corte ya está puesto', () => {
        // Si no, al entrar el corte el subrayado volvería a aparecer y sería
        // un parpadeo que en el render no está.
        //
        // El caso que lo distingue es el ajustado: un subrayado que empezó una
        // décima ANTES del corte. Sin la guarda, su fundido de entrada estaría
        // al 40% justo cuando el shot entra. Con un subrayado que empezó hace
        // ocho segundos las dos cuentas dan 1 y el test no probaría nada.
        const hl = { t0: SHOT_21.src - 0.1, t1: SHOT_21.src + 5, rect: [0, 0, 10, 10], pos: [0, 0] };
        t.eq(modelo.opacidadDe(hl, SHOT_21.src, SHOT_21), 1, 'en el corte, entero');
        t.eq(modelo.opacidadDe(hl, SHOT_21.src + 0.05, SHOT_21), 1, 'y sigue entero');

        // Y el contrario: uno que empieza DESPUÉS del corte sí tiene que
        // aparecer con su fundido.
        const nuevo = { t0: SHOT_21.src + 1, t1: SHOT_21.src + 5, rect: [0, 0, 10, 10], pos: [0, 0] };
        t.cerca(modelo.opacidadDe(nuevo, SHOT_21.src + 1.1, SHOT_21), 0.4, 1e-6);
    });

    t.grupo('Preview · el desenfoque (shot 103)');

    t.test('el blur tapa desde su primer cuadro hasta el último', () => {
        // Esto esconde correos y claves de API. Un cuadro sin tapar es una
        // clave publicada, así que el borde no puede fallar para ningún lado.
        t.eq(modelo.blursEn(SHOT_103, 4527.39).length, 0);
        t.eq(modelo.blursEn(SHOT_103, 4527.4).length, 1, 'el primer instante ya tapa');
        t.eq(modelo.blursEn(SHOT_103, 4530.59).length, 1, 'el último también');
        t.eq(modelo.blursEn(SHOT_103, 4530.6).length, 0);
        t.eq(modelo.blursEn(SHOT_103, 4528)[0].sigma, 21.85);
    });

    t.grupo('Preview · moverse entre cortes');

    t.test('la flecha arriba vuelve al principio del shot en el que estás', () => {
        // Es lo que uno quiere el 90% de las veces: volver al corte que
        // acabás de pasar. Un segundo toque sigue hacia atrás.
        const ed = edicionFalsa();
        t.cerca(modelo.saltoDeCorte(ed, 1.5, -1), 1, 1e-9);
        t.cerca(modelo.saltoDeCorte(ed, 1, -1), 0, 1e-9, 'parado en el corte, va al anterior');
        t.eq(modelo.saltoDeCorte(ed, 0, -1), null, 'desde el principio no hay a dónde');
    });

    t.test('la flecha abajo va al corte siguiente', () => {
        const ed = edicionFalsa();
        t.cerca(modelo.saltoDeCorte(ed, 0, 1), 1, 1e-9);
        t.cerca(modelo.saltoDeCorte(ed, 1.5, 1), 2, 1e-9);
        t.eq(modelo.saltoDeCorte(ed, 4.5, 1), null, 'desde el último no hay siguiente');
    });
    t.grupo('Preview · qué fuentes hace falta tener listas');

    t.test('cada layout pide lo suyo', () => {
        t.deep([...modelo.fuentesDe({ layout: 'CAM_WIDE' })], ['cam']);
        t.deep([...modelo.fuentesDe({ layout: 'SCREEN' })], ['screen']);
        t.deep([...modelo.fuentesDe({ layout: 'SCREEN', pip: true })], ['screen', 'cam']);
        t.ok(modelo.fuentesDe({ layout: 'SCENE', scene: 'titulo' }).has('bg_loop'));
        t.ok(modelo.fuentesDe({ layout: 'SCENE', scene: 'titulo' }).has('cam'), 'la caja del profesor');
        t.ok(modelo.fuentesDe({ layout: 'SCENE', scene: 'titulo' }).has('scene'));
    });

    t.test('se sabe qué shot va a volver a pedir una fuente', () => {
        // Es lo que permite ir posicionando el relevo ANTES del corte, que es
        // todo lo que separa un corte limpio de un cuadro congelado.
        const ed = edicionFalsa();
        t.eq(modelo.proximoUso(ed, 0, 'screen').i, 2);
        t.eq(modelo.proximoUso(ed, 2, 'cam').i, 3, 'la caja del SCENE_L también es cámara');
        t.eq(modelo.proximoUso(ed, 4, 'cam'), null, 'después del último no hay nada');
        t.eq(modelo.proximoUso(ed, 0, 'screen', 1), null, 'no se mira más allá del alcance');
    });

    t.grupo('Preview · el plan de un cuadro');

    t.test('la tabla de layouts decide qué fuentes van y cómo entra la cámara', () => {
        t.deep([...modelo.fuentesDe({ layout: 'SPLIT' })].sort(), ['bg_loop', 'cam', 'screen']);
        t.deep([...modelo.fuentesDe({ layout: 'SCENE_FULL', pip: true })].sort(), ['bg_loop', 'cam']);
        t.eq(modelo.camaraDe({ layout: 'SCENE_FULL' }), null, 'sin PiP, SCENE_FULL no lleva cámara');
        t.eq(modelo.camaraDe({ layout: 'SPLIT' }), 'lateral');
        t.eq(modelo.camaraDe({ layout: 'SCENE_L' }), 'caja');
        t.eq(modelo.camaraDe({ layout: 'UN_LAYOUT_NUEVO' }), null, 'uno desconocido no pide nada');
    });

    t.test('el plan sale del cuadro y no del instante crudo', () => {
        // 3.51 s es el cuadro 105. La escena `tools` entra en el 60 y el overlay
        // en el 90, así que por cuadro van 1.5 s y 0.5 s adentro; con el
        // instante crudo serían 1.51 y 0.51, que es un cuadro más adelante.
        const ed = edicionFalsa();
        const p = modelo.planDe(ed, 3.51);
        t.eq(p.f, 105);
        t.eq(p.shot.i, 3);
        t.eq(p.escena.nombre, 'tools');
        t.cerca(p.escena.t, 1.5, 1e-9);
        t.deep(p.overlays.map(o => o.i), [0], 'el overlay va por índice');
        t.cerca(p.overlays[0].t, 0.5, 1e-9);
        t.eq(p.pantalla, null, 'SCENE_L no arma capa de pantalla');
    });

    t.test('una escena sigue corriendo en el hueco de un shot que no la dibuja', () => {
        // El shot 2 es de pantalla y no dibuja escena, pero cae adentro de la
        // ventana de `tools` (2 a 5 s). Si se la pausara ahí, al volver tendría
        // que buscar un segundo hacia adelante justo en el corte.
        const ed = edicionFalsa();
        const p = modelo.planDe(ed, 2.5);
        t.eq(p.escena, null, 'no se dibuja');
        t.eq(p.escenaQueCorre.nombre, 'tools', 'pero corre');
        t.cerca(p.escenaQueCorre.t, 0.5, 1e-9);
        t.eq(modelo.planDe(ed, 5.5).escenaQueCorre, null, 'afuera de toda ventana, ninguna');
    });

    t.test('un shot de pantalla trae su zoom y dónde va cada par', () => {
        const ed = edicionFalsa();
        const p = modelo.planDe(ed, 2.5);
        t.eq(p.camara, 'pip');
        t.ok(p.pantalla && p.pantalla.vista, 'con la vista del zoom resuelta');
        t.cerca(p.proxy.cam, p.T - ed.medios.cam.offset, 1e-9, 'la cámara, corrida por el offset de su proxy');
    });

    t.grupo('Preview · el compositor');

    /**
     * Un DOM que solo sabe hacer canvas, y que anota cada llamada.
     *
     * Alcanza para lo que importa acá: que un layout no tire y que pinte lo que
     * tiene que pintar donde lo tiene que pintar. La imagen de verdad la mide
     * `tools/comparar-preview.js` contra el render.
     */
    function lienzosFalsos() {
        const lienzos = [];
        globalThis.document = {
            createElement() {
                const llamadas = [];
                const estado = { globalCompositeOperation: 'source-over' };
                const ctx = new Proxy(estado, {
                    get: (o, k) => (k in o ? o[k] : (...args) => llamadas.push({ fn: k, args, modo: o.globalCompositeOperation })),
                    set: (o, k, v) => { o[k] = v; return true; }
                });
                const c = { width: 0, height: 0, llamadas, getContext: () => ctx };
                lienzos.push(c);
                return c;
            }
        };
        return lienzos;
    }

    const { Compositor } = await import('../src/js/preview/compositor.js');
    const geometriaCompleta = {
        pip: { src: [704, 16, 900, 922], dst: [1566, 766, 264, 266], rutaMascara: 'pip.png', ring_pos: [1560, 760] },
        side: { src: [848, 56, 616, 900], dst: [56, 175, 500, 731], rutaMascara: 'side.png' },
        split_screen: { dst: [584, 175, 1300, 731], rutaMascara: 'split.png', rutaAro: 'splitring.png', ring_pos: [580, 171] }
    };
    const imagenes = new Map(['pip.png', 'side.png', 'split.png', 'splitring.png'].map(r => [r, { cual: r }]));
    const video = { cual: 'video' };
    const fuentesFalsas = {
        cam: { cuadro: () => video },
        screen: { cuadro: () => video },
        bg: { cuadro: () => video },
        escenas: { cuadroDe: () => null },
        overlays: []
    };

    t.test('SCENE_FULL con PiP pone la cámara en el PiP', () => {
        // Le pasaba la geometría entera en vez de la del PiP, y `geo.src` era
        // `undefined`: tiraba en cada vuelta del lazo. Ningún shot de la clase
        // de prueba es SCENE_FULL, así que nunca había corrido.
        const lienzos = lienzosFalsos();
        const ed = edicionFalsa({
            geometria: geometriaCompleta,
            shots: [{ i: 0, f0: 0, nf: 150, src: 100, layout: 'SCENE_FULL', pip: true }]
        });
        new Compositor(ed, imagenes).dibujar(fuentesFalsas, modelo.planDe(ed, 1));
        const mascara = lienzos[2].llamadas.filter(l => l.fn === 'drawImage');
        t.ok(mascara.some(l => l.args[0] === video), 'la cámara pasó por el recorte');
        t.ok(mascara.some(l => l.args[0] === imagenes.get('pip.png') && l.modo === 'destination-in'), 'con la máscara del PiP');
    });

    t.test('SPLIT recorta la pantalla con su máscara, no solo le pone el aro', () => {
        const lienzos = lienzosFalsos();
        const ed = edicionFalsa({
            geometria: geometriaCompleta,
            shots: [{ i: 0, f0: 0, nf: 150, src: 100, layout: 'SPLIT', screen: { base: [0, 0, 1920] } }]
        });
        const comp = new Compositor(ed, imagenes);
        comp.dibujar(fuentesFalsas, modelo.planDe(ed, 1));
        const mascara = lienzos[2].llamadas.filter(l => l.fn === 'drawImage');
        t.ok(mascara.some(l => l.args[0] === comp.pantalla), 'la fuente del recorte es la capa de pantalla ya armada');
        t.ok(mascara.some(l => l.args[0] === imagenes.get('split.png') && l.modo === 'destination-in'), 'con la máscara del split');
        t.ok(lienzos[0].llamadas.some(l => l.fn === 'drawImage' && l.args[0] === imagenes.get('splitring.png')), 'y su aro');
    });

    // ── Dónde dejar cada fuente ──────────────────────────────────────
    const fuentes = await import('../src/js/preview/fuentes.js');

    t.grupo('Preview · dejar una fuente en su cuadro');

    /** Un `<video>` de mentira: solo tiene lo que `corregir` toca. */
    const videoFalso = (t0 = 0) => ({ currentTime: t0, playbackRate: 1 });

    t.test('el cuadro que se pide es el que contiene al punto medio', async () => {
        // No es `cuadroDe(objetivo)`, y confundirlos era el error. 12.7333 cae
        // un pelo por debajo del borde del cuadro 382, así que `cuadroDe` dice
        // 381 mientras que lo que se va a ver tras buscar es el 382.
        const fmt = await import('../src/js/formato.js');
        const objetivo = 12.733299999999872;
        t.eq(fmt.cuadroDe(objetivo, 30), 381, 'el tiempo crudo cae del lado de abajo');
        t.eq(fuentes.cuadroPedido(objetivo, 30), 382, 'el que se va a ver es el de arriba');
    });

    t.test('en pausa se busca una vez y después se queda quieto', () => {
        // ESTE es el que hubiera cazado la imagen negra al pausar. Comparar
        // «dónde está» contra `cuadroDe(objetivo)` no coincidía nunca, así que
        // se volvía a buscar en cada vuelta del lazo; con el elemento buscando
        // sin parar no hay cuadro que dar y la pantalla se iba a negro.
        const objetivo = 12.733299999999872;
        const el = videoFalso();
        t.eq(fuentes.corregir(el, objetivo, { andando: false, fps: 30 }), 'salto');

        // Chromium puede dejar `currentTime` en lo que se le pidió...
        t.eq(fuentes.corregir(el, objetivo, { andando: false, fps: 30 }), 'quieto',
            'no se vuelve a buscar lo que ya se encontró');

        // ...o encajarlo al principio del cuadro. Las dos cosas tienen que
        // valer, y es la razón de pedir el punto medio: el medio y el borde de
        // entrada son el mismo cuadro.
        el.currentTime = 382 / 30;
        t.eq(fuentes.corregir(el, objetivo, { andando: false, fps: 30 }), 'quieto',
            'encajado al borde del cuadro, también');
    });

    t.test('ningún tiempo de fuente de la clase deja a corregir dando vueltas', () => {
        // Un instante suelto no alcanza para probar esto: los «redondos»
        // funcionaban igual de bien con el error puesto. Lo que lo destapa es
        // recorrer los tiempos como los arma el modelo, con un `src` de cuatro
        // decimales como los que escribe Claude, que es de donde sale el pelo
        // de diferencia.
        const offset = 3364;
        let sinConverger = 0;
        for (const src of [3367.3667, 3372.9667, 3497.9333, 4525.4, 3420.5001]) {
            for (let k = 0; k < 120; k++) {
                const objetivo = src + k / 30 - offset;
                const el = videoFalso();
                fuentes.corregir(el, objetivo, { andando: false, fps: 30 });
                if (fuentes.corregir(el, objetivo, { andando: false, fps: 30 }) !== 'quieto') sinConverger++;
            }
        }
        t.eq(sinConverger, 0, 'todos quedan quietos en la segunda pasada');
    });

    t.test('en marcha no se busca por una deriva de medio cuadro', () => {
        // La contracara: el régimen de pausa es exacto al cuadro, el de marcha
        // no puede serlo. Buscar por medio cuadro sería un tirón por vuelta.
        const el = videoFalso(12.75);
        t.eq(fuentes.corregir(el, 12.7333, { andando: true, fps: 30 }), 'bien');
        t.eq(el.currentTime, 12.75, 'no se tocó');
        t.eq(fuentes.corregir(videoFalso(12.75), 12.9, { andando: true, fps: 30 }), 'corrige',
            'una deriva de 0.15 s se alcanza acelerando');
        t.eq(fuentes.corregir(videoFalso(12.75), 20, { andando: true, fps: 30 }), 'salto',
            'siete segundos no se alcanzan: se busca');
    });

    // ── La línea de montaje ──────────────────────────────────────────
    // De `linea.js` solo se prueba lo que no toca el DOM, que es justo donde
    // se puede mentir sin que se note: un tramo mal juntado dibuja una pista
    // perfectamente creíble que dice que la cámara estuvo en pantalla veinte
    // segundos seguidos cuando estuvo diez y volvió.
    const linea = await import('../src/js/preview/linea.js');

    t.grupo('Preview · la línea de montaje');

    t.test('los shots seguidos que hacen lo mismo se juntan en un clip', () => {
        const ed = edicionFalsa();
        // Shots 0 (SCENE) y 1 (CAM_WIDE) usan la cámara de formas distintas;
        // 2 (SCREEN+pip) de una tercera; 3 (SCENE_L) vuelve a caja; 4 (CAM_MED)
        // a entera. Ninguno se junta con su vecino: cinco clips de un segundo.
        const camara = linea.tramos(ed, modelo.camaraDe);
        t.deep(camara.map(c => c.modo), ['caja', 'entera', 'pip', 'caja', 'entera']);
        t.deep(camara.map(c => c.desde), [0, 1, 2, 3, 4]);

        // Dos shots seguidos con el mismo uso sí son un clip solo, y el clip
        // recuerda cuántos cortes se tragó.
        const pegados = linea.tramos(edicionFalsa({
            shots: [
                { i: 0, f0: 0, nf: 30, src: 100, layout: 'CAM_WIDE' },
                { i: 1, f0: 30, nf: 30, src: 900, layout: 'CAM_MED' },
                { i: 2, f0: 60, nf: 30, src: 300, layout: 'SCREEN', pip: true }
            ]
        }), modelo.camaraDe);
        t.eq(pegados.length, 2);
        t.eq(pegados[0].shots, 2, 'los dos de cámara entera son un clip');
        t.cerca(pegados[0].hasta, 2, 1e-9);
        t.eq(pegados[1].modo, 'pip', 'cambiar de uso corta el tramo aunque no haya hueco');
    });

    t.test('un hueco corta el tramo aunque el modo sea el mismo', () => {
        // Es la razón de que el juntador mire `f0` y no solo el modo: la
        // cámara entera antes y después de un SCREEN son dos apariciones, y
        // dibujarlas como una sola taparía el tramo en que no se la ve.
        const ed = edicionFalsa({
            shots: [
                { i: 0, f0: 0, nf: 30, src: 100, layout: 'CAM_WIDE' },
                { i: 1, f0: 30, nf: 30, src: 200, layout: 'SCREEN' },
                { i: 2, f0: 60, nf: 30, src: 300, layout: 'CAM_WIDE' }
            ]
        });
        const camara = linea.tramos(ed, modelo.camaraDe);
        t.eq(camara.length, 2, 'el SCREEN sin pip parte el tramo de cámara');
        t.cerca(camara[0].hasta, 1, 1e-9);
        t.cerca(camara[1].desde, 2, 1e-9);
    });

    t.test('el clip encendido es el que contiene al instante, no el de al lado', () => {
        // El mismo intervalo medio abierto que los shots: en el borde exacto
        // manda el que empieza. Con 152 clips de audio, equivocarse por uno
        // enciende el pedazo anterior en todos los cortes de sonido.
        const clips = [
            { desde: 0, hasta: 1 },
            { desde: 1, hasta: 2.5 },
            { desde: 4, hasta: 5 }
        ];
        t.eq(linea.clipEn(clips, 0), 0);
        t.eq(linea.clipEn(clips, 0.999), 0);
        t.eq(linea.clipEn(clips, 1), 1, 'en el borde manda el que empieza');
        t.eq(linea.clipEn(clips, 2.5), -1, 'el hueco no enciende nada');
        t.eq(linea.clipEn(clips, 4.5), 2);
        t.eq(linea.clipEn(clips, 9), -1, 'más allá del final tampoco');
    });

    t.test('cada layout tiene su color y los desconocidos uno propio', () => {
        // Un layout que esta versión no conoce tiene que verse, y verse
        // distinto: pintarlo del color de otro sería dibujar una mentira.
        const usados = new Set();
        for (const nombre of Object.keys(modelo.LAYOUTS)) {
            t.ok(linea.COLORES[nombre], `${nombre} tiene color`);
            t.ok(!usados.has(linea.COLORES[nombre]), `${nombre} no repite el color de otro`);
            usados.add(linea.COLORES[nombre]);
        }
        t.eq(linea.COLORES.LAYOUT_QUE_NO_EXISTE, undefined);
    });
};
