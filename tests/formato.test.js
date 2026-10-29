'use strict';
/**
 * La copia de los tiempos que usa la ventana tiene que decir lo mismo que la
 * del motor.
 *
 * Son dos archivos a propósito —el renderer no tiene `require` y pasar cada
 * formateo por el puente sería un viaje por cuadro— y esa duplicación solo es
 * aceptable mientras no se separen. Acá se comparan contra los mismos números.
 */

const tiempo = require('../engine/tiempo');

module.exports = async function (t) {
    t.grupo('Formato (la copia de la ventana)');

    const fmt = await import('../src/js/formato.js');

    t.test('las dos usan la misma tolerancia para contar el cuadro', () => {
        // Comparar resultados no alcanza: con los dos archivos equivocados del
        // mismo modo coincidían igual, que es exactamente cómo el epsilon chico
        // sobrevivió. El número se compara aparte.
        t.eq(fmt.TOLERANCIA, tiempo.TOLERANCIA);
    });

    t.test('las dos leen igual el tiempo recortado del <video>', () => {
        // Los instantes que de verdad llegan: el comienzo de un cuadro tal
        // como lo devuelve `currentTime`, con los microsegundos de menos.
        for (const fps of [24, 25, 30, 50, 60]) {
            for (let cuadro = 1; cuadro < 300; cuadro++) {
                const leido = (Math.floor(tiempo.segundosDe(cuadro, fps) * 1e6) - 1) / 1e6;
                t.eq(fmt.cuadroDe(leido, fps), cuadro, `la ventana, a ${fps} fps, cuadro ${cuadro}`);
                t.eq(fmt.cuadroDe(leido, fps), tiempo.cuadroDe(leido, fps), `${fps} fps, cuadro ${cuadro}`);
            }
        }
    });

    t.test('los dos cuentan el mismo cuadro', () => {
        for (const fps of [23.976, 25, 29.97, 50, 60]) {
            for (let s = 0; s < 40; s += 0.137) {
                t.eq(fmt.cuadroDe(s, fps), tiempo.cuadroDe(s, fps), `${fps} fps en ${s.toFixed(3)} s`);
            }
        }
    });

    t.test('los dos escriben el mismo timecode', () => {
        for (const fps of [24, 29.97, 30]) {
            for (let s = 0; s < 200; s += 1.7) {
                t.eq(fmt.timecode(s, fps), tiempo.timecode(s, fps), `${fps} fps en ${s} s`);
            }
        }
    });

    t.test('los dos escriben el mismo reloj y los mismos fps', () => {
        for (const s of [0, 9.4, 61, 3600, 3661.9]) t.eq(fmt.reloj(s), tiempo.reloj(s));
        for (const f of [24, 25, 29.97, 23.976]) t.eq(fmt.fpsTexto(f), tiempo.fpsTexto(f));
    });

    t.test('la ficha dice si es vertical u horizontal', () => {
        t.tiene(fmt.ficha({ ok: true, anchoReal: 1080, alto: 1920, vertical: true, codec: 'hevc', fps: 30, duracion: 42 }), '9:16');
        t.tiene(fmt.ficha({ ok: true, anchoReal: 1920, alto: 1080, vertical: false, codec: 'h264', fps: 25, duracion: 42 }), '16:9');
    });

    t.test('un archivo que no se pudo medir muestra el motivo', () => {
        t.eq(fmt.ficha({ ok: false, error: 'no se pudo leer' }), 'no se pudo leer');
    });
};
