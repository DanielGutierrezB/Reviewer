'use strict';
/**
 * Cómo se agrupan las versiones. Es lo primero que hace la app al abrir una
 * carpeta y de lo que dependen todas las pantallas.
 */

const versiones = require('../engine/versiones');

module.exports = function (t) {
    t.grupo('Versiones: partir el nombre');

    t.test('sin sufijo es la v1', () => {
        t.deep(versiones.partir('Clase 03 - Hooks'), { clase: 'Clase 03 - Hooks', version: 1, explicita: false });
    });

    t.test('los tres separadores valen', () => {
        for (const nombre of ['Clase 03 v2', 'Clase 03_v2', 'Clase 03-v2']) {
            const r = versiones.partir(nombre);
            t.eq(r.version, 2, nombre);
            t.eq(r.clase, 'Clase 03', nombre);
        }
    });

    t.test('la V mayúscula también', () => {
        t.eq(versiones.partir('Intro V12').version, 12);
    });

    t.test('un número pegado a una palabra NO es una versión', () => {
        // «Entrevista Nivel 2» leída como la versión 2 de «Entrevista Nivel»
        // partiría en dos una clase que no tiene versiones.
        t.deep(versiones.partir('Entrevista Nivel 2'), { clase: 'Entrevista Nivel 2', version: 1, explicita: false });
    });

    t.test('el guion del nombre no se come', () => {
        const r = versiones.partir('Clase 03 - Hooks - v4');
        t.eq(r.clase, 'Clase 03 - Hooks');
        t.eq(r.version, 4);
    });

    t.test('la clave ignora mayúsculas y espacios de más', () => {
        t.eq(versiones.clave('Clase  03 - HOOKS'), versiones.clave('clase 03 - hooks'));
    });

    t.grupo('Versiones: agrupar una carpeta');

    const temporal = require('./lib/temporal');

    t.test('cuatro archivos, dos clases, y la extensión no agrupa', async () => {
        const dir = temporal.carpeta('versiones');
        temporal.archivo(dir, 'Clase 03 - Hooks.mp4');
        temporal.archivo(dir, 'Clase 03 - Hooks v2.mov');
        temporal.archivo(dir, 'Clase 03 - Hooks v3.mp4');
        temporal.archivo(dir, 'Clase 04 - Estado_v2.mp4');
        temporal.archivo(dir, 'notas.txt');

        const r = await versiones.escanear(dir);
        t.eq(r.clases.length, 2, 'dos clases');
        t.eq(r.clases[0].nombre, 'Clase 03 - Hooks');
        t.deep(r.clases[0].versiones.map(v => v.n), [1, 2, 3]);
        t.eq(r.clases[0].ultima.n, 3, 'la última es la que se abre');
        t.deep(r.clases[1].versiones.map(v => v.n), [2], 'un hueco es un hueco: no se inventa la v1');
    });

    t.test('las clases salen en orden humano: la 10 después de la 9', async () => {
        const dir = temporal.carpeta('orden');
        for (const n of [1, 2, 9, 10, 11]) temporal.archivo(dir, `Clase ${n}.mp4`);
        const r = await versiones.escanear(dir);
        t.deep(r.clases.map(c => c.nombre), ['Clase 1', 'Clase 2', 'Clase 9', 'Clase 10', 'Clase 11']);
    });

    t.test('una carpeta que no está no explota', async () => {
        const r = await versiones.escanear('/no/existe/esto');
        t.ok(r.error, 'dice el motivo');
        t.deep(r.clases, []);
    });
};
