'use strict';
/**
 * Las referencias adjuntas al comentario del curso.
 *
 * Lo que importa es la regla que se copió de HyperPremiere: la carpeta manda
 * sobre el manifiesto. Un archivo que el manifiesto nombra y no está se MUESTRA
 * faltante en vez de desaparecer, y uno que alguien soltó desde el Finder se
 * adopta.
 */

const fs = require('fs');
const path = require('path');

const referencias = require('../engine/referencias');
const temporal = require('./lib/temporal');
const workspace = require('../engine/workspace');

module.exports = function (t) {
    t.grupo('Referencias');

    t.test('sin nada adjunto, la lista está vacía', () => {
        t.deep(referencias.listar(temporal.carpeta('refs')), []);
    });

    t.test('agregar copia el archivo adentro de la carpeta', () => {
        const dir = temporal.carpeta('refs');
        const origen = temporal.archivo(dir, 'logo.png', 'png');
        const lista = referencias.agregar(dir, { origen });
        t.eq(lista.length, 1);
        t.eq(lista[0].tipo, 'imagen');
        t.eq(lista[0].numero, 1);
        t.ok(fs.existsSync(lista[0].ruta), 'se copia, no se enlaza: la carpeta tiene que poder viajar');
    });

    t.test('dos con el mismo nombre no se pisan', () => {
        const dir = temporal.carpeta('refs');
        referencias.agregar(dir, { nombre: 'captura.png', bytes: Buffer.from('a') });
        const lista = referencias.agregar(dir, { nombre: 'captura.png', bytes: Buffer.from('b') });
        t.deep(lista.map(r => r.file), ['captura.png', 'captura-2.png']);
    });

    t.test('las imágenes se numeran salteando las que faltan', () => {
        const dir = temporal.carpeta('refs');
        referencias.agregar(dir, { nombre: 'a.png', bytes: Buffer.from('a') });
        referencias.agregar(dir, { nombre: 'b.png', bytes: Buffer.from('b') });
        referencias.agregar(dir, { nombre: 'c.png', bytes: Buffer.from('c') });
        fs.unlinkSync(path.join(workspace.archivosGenerales(dir).referencias, 'b.png'));

        const lista = referencias.listar(dir);
        t.eq(lista[1].falta, true, 'la del medio se muestra faltante, no desaparece');
        t.eq(lista[2].numero, 2, 'y el número no deja huecos: el feedback promete 1 a 2');
    });

    t.test('un archivo soltado desde el Finder se adopta', () => {
        const dir = temporal.carpeta('refs');
        referencias.agregar(dir, { nombre: 'a.png', bytes: Buffer.from('a') });
        const carpeta = workspace.archivosGenerales(dir).referencias;
        fs.writeFileSync(path.join(carpeta, 'suelta.pdf'), 'pdf');

        const lista = referencias.listar(dir);
        t.eq(lista.length, 2);
        t.eq(lista[1].adoptada, true, 'la carpeta viaja con el curso: que se vea lo que hay adentro');
        t.eq(lista[1].tipo, 'documento');
    });

    t.test('el token es el que se escribe en un comentario', () => {
        const dir = temporal.carpeta('refs');
        const [ref] = referencias.agregar(dir, { nombre: 'manual de marca.pdf', bytes: Buffer.from('x') });
        t.eq(ref.token, '@[curso/manual de marca.pdf]');
    });

    t.test('quitar borra el archivo y la entrada', () => {
        const dir = temporal.carpeta('refs');
        const [ref] = referencias.agregar(dir, { nombre: 'a.png', bytes: Buffer.from('a') });
        t.deep(referencias.quitar(dir, ref.file), []);
        t.ok(!fs.existsSync(ref.ruta));
    });

    t.test('al feedback solo viajan las que están', () => {
        const dir = temporal.carpeta('refs');
        referencias.agregar(dir, { nombre: 'a.png', bytes: Buffer.from('a') });
        referencias.agregar(dir, { nombre: 'b.png', bytes: Buffer.from('b') });
        fs.unlinkSync(path.join(workspace.archivosGenerales(dir).referencias, 'a.png'));
        const viajan = referencias.paraFeedback(dir);
        t.eq(viajan.length, 1);
        t.eq(viajan[0].nombre, 'b.png');
    });

    t.test('un nombre con barras no se escapa de la carpeta', () => {
        const dir = temporal.carpeta('refs');
        const [ref] = referencias.agregar(dir, { nombre: '../../fuera.png', bytes: Buffer.from('x') });
        t.ok(workspace.dentroDe(workspace.archivosGenerales(dir).referencias, ref.ruta));
    });
};
