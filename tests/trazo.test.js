'use strict';
/**
 * Cómo nace un trazo.
 *
 * Esto se prueba porque es el único código de dibujo que corre en las DOS
 * pizarras —la de la Mac y la del iPad— y porque lo que fija son reglas que no
 * se ven leyendo: que una forma guarde dos puntos y no el camino, y cuál es el
 * largo abajo del cual una caja era un clic. Si alguien las cambia de un lado,
 * acá se entera de qué se rompe del otro.
 */

const path = require('path');

const RUTA = path.join(__dirname, '..', 'src', 'js', 'trazo.js');

/** Un evento de puntero como el que manda Chromium, con lo justo. */
function puntero(x, y, presion) {
    return { clientX: x, clientY: y, pressure: presion == null ? 0.5 : presion };
}

const CAJA = { left: 100, top: 50, width: 400, height: 200 };

module.exports = async function (t) {
    t.grupo('Trazo');

    const trazo = await import(RUTA);

    t.test('un punto se guarda en fracción de la caja, no en píxeles', () => {
        const p = trazo.puntoEn(CAJA, puntero(300, 150));
        t.eq(p.x, 0.5, 'la mitad del ancho');
        t.eq(p.y, 0.5, 'la mitad del alto');
    });

    t.test('un punto afuera de la caja se pega al borde', () => {
        // Pasa de verdad: con captura de puntero el lápiz sigue mandando
        // posiciones después de salirse del canvas, y sin recortar, el trazo
        // se iría a dibujar afuera del cuadro que se le manda a Claude.
        const p = trazo.puntoEn(CAJA, puntero(900, -40));
        t.eq(p.x, 1);
        t.eq(p.y, 0);
    });

    t.test('la presión 0 se lee como 0.5 y no como «apoyó sin fuerza»', () => {
        t.eq(trazo.puntoEn(CAJA, puntero(300, 150, 0)).p, 0.5);
        t.eq(trazo.puntoEn(CAJA, puntero(300, 150, 0.9)).p, 0.9);
    });

    t.test('una forma guarda dos puntos y no el camino', () => {
        const t1 = { lapiz: 'caja', puntos: [trazo.puntoEn(CAJA, puntero(100, 50))] };
        trazo.estirar(t1, CAJA, puntero(300, 150));
        trazo.estirar(t1, CAJA, puntero(500, 250));
        t.eq(t1.puntos.length, 2, 'la esquina de arranque y la de ahora');
        t.deep(t1.puntos[1], { x: 1, y: 1, p: 0.5 }, 'el segundo punto se reemplaza');
    });

    t.test('a mano alzada los puntos se acumulan', () => {
        const t1 = { lapiz: 'libre', puntos: [trazo.puntoEn(CAJA, puntero(100, 50))] };
        trazo.estirar(t1, CAJA, puntero(300, 150));
        trazo.estirar(t1, CAJA, puntero(500, 250));
        t.eq(t1.puntos.length, 3);
    });

    t.test('a mano alzada los puntos pegados al anterior se tiran', () => {
        const t1 = { lapiz: 'libre', puntos: [trazo.puntoEn(CAJA, puntero(300, 150))] };
        // Un píxel sobre 400 de ancho es 0.0025: menos que el mínimo.
        trazo.estirar(t1, CAJA, puntero(301, 150));
        t.eq(t1.puntos.length, 1, 'no agregó nada');
        trazo.estirar(t1, CAJA, puntero(320, 150));
        t.eq(t1.puntos.length, 2, 'cinco píxeles sí');
    });

    t.test('un clic suelto no es un trazo', () => {
        t.eq(trazo.sirve({ lapiz: 'libre', puntos: [{ x: 0.5, y: 0.5 }] }), false);
        t.eq(trazo.sirve(null), false);
    });

    t.test('una forma de la nada tampoco, un trazo libre corto sí', () => {
        const casi = [{ x: 0.5, y: 0.5 }, { x: 0.502, y: 0.5 }];
        t.eq(trazo.sirve({ lapiz: 'flecha', puntos: casi }), false, 'la flecha del clic');
        t.eq(trazo.sirve({ lapiz: 'libre', puntos: casi }), true, 'un punto a propósito');
        t.eq(trazo.sirve({ lapiz: 'flecha', puntos: [{ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.8 }] }), true);
    });

    t.test('el dedo dibuja hasta que aparece un lápiz, y después no', () => {
        const puedeDibujar = trazo.rechazoDePalma();
        t.eq(puedeDibujar({ pointerType: 'touch' }), true, 'sin lápiz, el dedo dibuja');
        t.eq(puedeDibujar({ pointerType: 'pen' }), true);
        t.eq(puedeDibujar({ pointerType: 'touch' }), false, 'ahora el dedo es la palma');
        t.eq(puedeDibujar({ pointerType: 'mouse' }), true, 'el mouse nunca es una palma');
    });

    t.test('cada pizarra tiene su propio portero', () => {
        // Si el «ya vi un lápiz» fuera uno solo, tocar el iPad una vez dejaría
        // al mouse de la Mac sin poder dibujar.
        const deLaMac = trazo.rechazoDePalma();
        const delIPad = trazo.rechazoDePalma();
        delIPad({ pointerType: 'pen' });
        t.eq(deLaMac({ pointerType: 'touch' }), true);
        t.eq(delIPad({ pointerType: 'touch' }), false);
    });
};
