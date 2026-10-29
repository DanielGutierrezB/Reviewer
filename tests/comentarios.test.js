'use strict';
/**
 * El guardado de los comentarios, y sobre todo la regla que pidió el editor: la
 * carpeta de una versión no existe hasta que hay al menos un comentario.
 */

const fs = require('fs');
const path = require('path');

const comentarios = require('../engine/comentarios');
const temporal = require('./lib/temporal');
const workspace = require('../engine/workspace');

module.exports = function (t) {
    t.grupo('Comentarios');

    function escenario() {
        const dir = temporal.carpeta('comentarios');
        const ruta = temporal.archivo(dir, 'Clase 03 v2.mp4');
        return { dir, ruta, ctx: { rutaVideo: ruta, media: temporal.media({ fps: 29.97 }) } };
    }

    t.test('leer una versión sin comentarios NO crea la carpeta', () => {
        const { ruta } = escenario();
        const datos = comentarios.leer(ruta, temporal.media());
        t.deep(datos.comentarios, []);
        t.ok(!fs.existsSync(workspace.carpetaDeVersion(ruta)), 'la carpeta no existe');
    });

    t.test('el primer comentario la crea, con sus dos archivos', () => {
        const { ruta, ctx } = escenario();
        comentarios.agregar(ruta, { t: 12.5, texto: 'Esto sobra' }, ctx);
        const archivos = workspace.archivosDeVersion(ruta);
        t.ok(fs.existsSync(archivos.comentarios), 'el JSON');
        t.ok(fs.existsSync(archivos.feedback), 'y el markdown');
    });

    t.test('borrar el último se lleva los dos archivos y la carpeta vacía', () => {
        const { ruta, ctx } = escenario();
        const { id } = comentarios.agregar(ruta, { t: 1, texto: 'x' }, ctx);
        comentarios.borrar(ruta, id, ctx);
        const archivos = workspace.archivosDeVersion(ruta);
        t.ok(!fs.existsSync(archivos.comentarios), 'sin JSON');
        t.ok(!fs.existsSync(archivos.feedback), 'sin markdown');
        t.ok(!fs.existsSync(archivos.carpeta), 'y sin carpeta: un feedback vacío miente');
    });

    t.test('los ids no se repiten aunque se borre del medio', () => {
        const { ruta, ctx } = escenario();
        comentarios.agregar(ruta, { t: 1, texto: 'a' }, ctx);
        const segundo = comentarios.agregar(ruta, { t: 2, texto: 'b' }, ctx);
        comentarios.borrar(ruta, segundo.id, ctx);
        const tercero = comentarios.agregar(ruta, { t: 3, texto: 'c' }, ctx);
        t.eq(tercero.id, 'c03', 'mira el mayor que hubo, no cuántos quedan');
    });

    t.test('se ordenan por tiempo y no por cuándo se escribieron', () => {
        const { ruta, ctx } = escenario();
        comentarios.agregar(ruta, { t: 90, texto: 'tarde' }, ctx);
        const r = comentarios.agregar(ruta, { t: 3, texto: 'temprano' }, ctx);
        t.deep(r.datos.comentarios.map(c => c.texto), ['temprano', 'tarde']);
    });

    t.test('un tramo al revés se guarda como un instante', () => {
        const { ruta, ctx } = escenario();
        const r = comentarios.agregar(ruta, { t: 50, tHasta: 20, texto: 'x' }, ctx);
        t.eq(r.datos.comentarios[0].tHasta, null, 'un final antes del principio no es un tramo');
    });

    t.test('editar deja lo que no se tocó', () => {
        const { ruta, ctx } = escenario();
        const { id } = comentarios.agregar(ruta, { t: 10, texto: 'original' }, ctx);
        const datos = comentarios.editar(ruta, id, { estado: 'resuelto' }, ctx);
        t.eq(datos.comentarios[0].texto, 'original');
        t.eq(datos.comentarios[0].estado, 'resuelto');
        t.ok(datos.comentarios[0].modificado, 'y anota cuándo');
    });

    t.test('borrar un comentario se lleva sus PNG', () => {
        const { ruta, ctx } = escenario();
        const { id } = comentarios.agregar(ruta, { t: 10, texto: 'con imagen' }, ctx);
        const archivos = workspace.archivosDeVersion(ruta);
        workspace.ensureDir(archivos.frames);
        const png = path.join(archivos.frames, 'c01-x.png');
        fs.writeFileSync(png, 'png');
        comentarios.editar(ruta, id, { frame: 'frames/c01-x.png' }, ctx);
        comentarios.agregar(ruta, { t: 20, texto: 'otro, para que la carpeta siga' }, ctx);

        comentarios.borrar(ruta, id, ctx);
        t.ok(!fs.existsSync(png), 'el PNG que nadie nombra ya no está');
    });

    t.test('una ruta de PNG que apunta afuera no borra nada afuera', () => {
        const { dir, ruta, ctx } = escenario();
        const intruso = temporal.archivo(dir, 'no-tocar.png');
        const { id } = comentarios.agregar(ruta, { t: 1, texto: 'x' }, ctx);
        comentarios.editar(ruta, id, { frame: '../no-tocar.png' }, ctx);
        comentarios.borrar(ruta, id, ctx);
        t.ok(fs.existsSync(intruso), 'el JSON es un archivo que alguien puede editar a mano');
    });

    t.test('mandan los fps que acaba de medir ffprobe, no los guardados', () => {
        const { ruta, ctx } = escenario();
        comentarios.agregar(ruta, { t: 1, texto: 'x' }, ctx);
        const releido = comentarios.leer(ruta, temporal.media({ fps: 25 }));
        t.eq(releido.fps, 25, 'el render se reemplazó y ahora mide otra cosa');
    });

    t.test('un JSON roto se lee como una versión sin comentarios', () => {
        const { ruta } = escenario();
        const archivos = workspace.asegurarCarpeta(ruta);
        fs.writeFileSync(archivos.comentarios, '{ esto no es json');
        t.deep(comentarios.leer(ruta, temporal.media()).comentarios, []);
    });

    t.test('la cuenta separa abiertos de resueltos', () => {
        const { ruta, ctx } = escenario();
        comentarios.agregar(ruta, { t: 1, texto: 'a' }, ctx);
        const segundo = comentarios.agregar(ruta, { t: 2, texto: 'b' }, ctx);
        const datos = comentarios.editar(ruta, segundo.id, { estado: 'resuelto' }, ctx);
        t.deep(comentarios.cuenta(datos), { total: 2, abiertos: 1, resueltos: 1 });
    });

    t.test('el JSON guarda rutas relativas, para que la carpeta pueda viajar', () => {
        const { ruta, ctx } = escenario();
        const { id } = comentarios.agregar(ruta, { t: 1, texto: 'x' }, ctx);
        comentarios.editar(ruta, id, { frame: 'frames/c01-x.png' }, ctx);
        const crudo = fs.readFileSync(workspace.archivosDeVersion(ruta).comentarios, 'utf8');
        t.noTiene(crudo, temporal.RAIZ, 'ninguna ruta absoluta adentro del JSON');
    });

    t.test('el feedback se rehace en cada cambio', () => {
        const { ruta, ctx } = escenario();
        const { id } = comentarios.agregar(ruta, { t: 1, texto: 'lo primero' }, ctx);
        comentarios.editar(ruta, id, { texto: 'lo corregido' }, ctx);
        const md = fs.readFileSync(workspace.archivosDeVersion(ruta).feedback, 'utf8');
        t.tiene(md, 'lo corregido');
        t.noTiene(md, 'lo primero');
    });
};
