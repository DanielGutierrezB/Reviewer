'use strict';
/**
 * Los tiempos. Un cuadro mal contado acá es un comentario que apunta a otro
 * plano, que es el peor fallo que puede tener esta herramienta: no se nota.
 */

const tiempo = require('../engine/tiempo');

module.exports = function (t) {
    t.grupo('Tiempo');

    t.test('el cuadro es el que se está VIENDO, no el de al lado', () => {
        // 83.44 s a 29.97 cae adentro del cuadro 2500, que empieza en 83.417.
        t.eq(tiempo.cuadroDe(83.44, 29.97), 2500);
        t.eq(tiempo.cuadroDe(83.41, 29.97), 2499, 'justo antes, es el anterior');
    });

    t.test('el comienzo de un cuadro vuelve a dar el mismo cuadro', () => {
        for (const fps of [23.976, 24, 25, 29.97, 30, 50, 59.94, 60]) {
            for (const cuadro of [0, 1, 999, 12345]) {
                t.eq(tiempo.cuadroDe(tiempo.segundosDe(cuadro, fps), fps), cuadro, `${fps} fps, cuadro ${cuadro}`);
            }
        }
    });

    /**
     * Lo que el `<video>` contesta cuando se le pide un instante exacto.
     *
     * Chromium guarda el tiempo del medio en microsegundos, así que
     * `currentTime` vuelve recortado a seis decimales, y medido en la app sobre
     * un mp4 a 30 fps el recorte llega a perder dos microsegundos: se le pidió
     * el cuadro 61 en 2.0333333333 s y contestó 2.033332.
     *
     * Se modela el peor caso y no el promedio porque el promedio no distingue:
     * la mayoría de los cuadros se leían bien incluso con el epsilon viejo, y
     * así el test pasaba con el bug puesto.
     */
    const comoLoDevuelveElVideo = s => (Math.floor(s * 1e6) - 1) / 1e6;

    t.test('el cuadro sobrevive a los microsegundos que devuelve el <video>', () => {
        // Es el bug de retroceder un cuadro y saltar dos: si el comienzo del
        // cuadro 61 se lee como cuadro 60, el paso para atrás arranca de 60 y
        // aterriza en 59.
        for (const fps of [23.976, 24, 25, 29.97, 30, 50, 59.94, 60]) {
            for (let cuadro = 0; cuadro < 600; cuadro++) {
                const leido = comoLoDevuelveElVideo(tiempo.segundosDe(cuadro, fps));
                t.eq(tiempo.cuadroDe(leido, fps), cuadro, `${fps} fps, cuadro ${cuadro}`);
            }
        }
    });

    t.test('la tolerancia no adelanta el cuadro que todavía no empezó', () => {
        // El otro borde, y el que nadie ve si se rompe: una tolerancia grande
        // cuenta el cuadro siguiente a un tiempo que es del anterior y corre
        // todos los comentarios en uno sin que nada falle. Medio milisegundo
        // antes del corte es un 3% del cuadro a 60 fps: tiene que seguir
        // siendo el cuadro de antes.
        for (const fps of [24, 25, 30, 50, 60]) {
            for (let cuadro = 1; cuadro < 200; cuadro++) {
                const casi = tiempo.segundosDe(cuadro + 1, fps) - 5e-4;
                t.eq(tiempo.cuadroDe(casi, fps), cuadro, `${fps} fps, justo antes del ${cuadro + 1}`);
            }
        }
    });

    t.test('timecode a 30 y a 29.97', () => {
        t.eq(tiempo.timecode(0, 30), '00:00:00:00');
        t.eq(tiempo.timecode(1, 30), '00:00:01:00');
        // A 29.97 sin drop frame el campo de cuadros se divide por 30, así que
        // el timecode se atrasa del reloj: a los 83.44 s marca 83 s y 10
        // cuadros. Es lo correcto y es lo que espera cualquier NLE.
        t.eq(tiempo.timecode(83.44, 29.97), '00:01:23:10');
        t.eq(tiempo.timecode(3661.5, 25), '01:01:01:12');
    });

    t.test('a 23.976 el campo de cuadros nunca pasa de 23', () => {
        for (let s = 0; s < 120; s += 0.37) {
            const ff = Number(tiempo.timecode(s, 23.976).split(':')[3]);
            t.ok(ff >= 0 && ff <= 23, `en ${s.toFixed(2)} s salió :${ff}`);
        }
    });

    t.test('el reloj corto no escribe la hora si no hay', () => {
        t.eq(tiempo.reloj(0), '0:00');
        t.eq(tiempo.reloj(83.9), '1:23');
        t.eq(tiempo.reloj(3661), '1:01:01');
    });

    t.test('los fps se escriben como se leen', () => {
        t.eq(tiempo.fpsTexto(30), '30');
        t.eq(tiempo.fpsTexto(29.97002997002997), '29.97');
        t.eq(tiempo.fpsTexto(23.976), '23.98');
    });

    t.test('el instante completo trae las tres formas', () => {
        const texto = tiempo.completo(83.44, 29.97);
        t.tiene(texto, '00:01:23:10', 'el timecode');
        t.tiene(texto, '83.440 s', 'los segundos');
        t.tiene(texto, 'cuadro 2500', 'el cuadro');
        t.tiene(texto, '@ 29.97', 'y a qué velocidad');
    });

    t.test('un tramo dice lo que dura', () => {
        t.tiene(tiempo.completoRango(10, 18.5, 25), 'dura 8.500 s');
    });

    t.test('el nombre de archivo no lleva dos puntos', () => {
        t.eq(tiempo.paraNombre(83.44, 29.97), '00h01m23s10f');
    });

    t.test('unos fps imposibles no rompen nada', () => {
        t.eq(tiempo.fpsValido(0), 25);
        t.eq(tiempo.fpsValido(null), 25);
        t.eq(tiempo.fpsValido(-3), 25);
        t.eq(tiempo.fpsValido(100000), 25);
    });
};
