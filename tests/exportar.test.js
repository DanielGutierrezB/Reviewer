'use strict';
/**
 * La carpeta `Feedback/`: todo lo que hay por hacer, junto y valiéndose por sí
 * solo.
 *
 * Lo que se vigila acá es que no se pierda nada en el camino. Un comentario
 * que no entra al documento, o un cuadro que se nombra pero no se copió, es un
 * ajuste que no se hace y nadie se entera hasta que el curso sale con el error
 * adentro.
 */

const fs = require('fs');
const path = require('path');

const comentarios = require('../engine/comentarios');
const exportar = require('../engine/exportar');
const general = require('../engine/general');
const temporal = require('./lib/temporal');
const versiones = require('../engine/versiones');
const workspace = require('../engine/workspace');

module.exports = async function (t) {
    t.grupo('Exportar para Claude');

    /** Una carpeta con dos clases, comentarios y un cuadro guardado. */
    async function curso(nombre) {
        const dir = temporal.carpeta(nombre);
        const uno = temporal.archivo(dir, 'Clase 01 - Intro.mp4');
        const dos = temporal.archivo(dir, 'Clase 02 - Hooks v2.mp4');
        const ctx = ruta => ({ rutaVideo: ruta, media: temporal.media() });

        comentarios.agregar(uno, { t: 1, texto: 'Bajale tres dB a la música' }, ctx(uno));
        comentarios.agregar(uno, { t: 4, texto: 'Este corte queda duro' }, ctx(uno));
        const conCuadro = comentarios.agregar(dos, { t: 2, texto: 'El logo va arriba a la derecha' }, ctx(dos));

        // Un cuadro guardado, que es el caso normal: casi todo comentario que
        // habla de lo que se ve trae su PNG al lado.
        const archivos = workspace.asegurarCarpeta(dos);
        workspace.ensureDir(archivos.frames);
        fs.writeFileSync(path.join(archivos.frames, 'c01.png'), 'PNG');
        comentarios.editar(dos, conCuadro.id, { frame: 'frames/c01.png' }, ctx(dos));

        const leido = await versiones.escanear(dir);
        return { dir, uno, dos, clases: leido.clases };
    }

    /** Lo que quedó escrito en el documento. */
    function documento(r) {
        return fs.readFileSync(r.documento, 'utf8');
    }

    t.test('junta las clases en un solo documento', async () => {
        const { dir, clases } = await curso('exportar');
        const r = exportar.exportar(dir, clases);

        t.ok(r.ok, r.error);
        t.eq(r.clases, 2);
        t.eq(r.comentarios, 3);
        t.eq(path.basename(r.carpeta), workspace.EXPORTACION_DIR);

        const md = documento(r);
        t.tiene(md, 'Bajale tres dB a la música');
        t.tiene(md, 'Este corte queda duro');
        t.tiene(md, 'El logo va arriba a la derecha');
        t.tiene(md, 'Clase 01 - Intro · v1');
        t.tiene(md, 'Clase 02 - Hooks · v2', 'el número de versión, que es lo que Claude tiene que tocar');
    });

    t.test('los comentarios resueltos no se exportan', () => {
        // Es la mitad del sentido de exportar: lo que llega es la lista de lo
        // que falta, no el historial. Un resuelto adentro es trabajo que se
        // rehace.
        const dir = temporal.carpeta('exportar-resueltos');
        const ruta = temporal.archivo(dir, 'Clase 01.mp4');
        const ctx = { rutaVideo: ruta, media: temporal.media() };
        const puesto = comentarios.agregar(ruta, { t: 1, texto: 'esto ya está hecho' }, ctx);
        comentarios.editar(ruta, puesto.id, { estado: 'resuelto' }, ctx);
        comentarios.agregar(ruta, { t: 2, texto: 'esto falta' }, ctx);

        const clases = [{ id: 'c', nombre: 'Clase 01', versiones: [{ n: 1, ruta, media: temporal.media() }] }];
        const r = exportar.exportar(dir, clases);

        t.eq(r.comentarios, 1);
        t.tiene(documento(r), 'esto falta');
        t.noTiene(documento(r), 'esto ya está hecho');
    });

    t.test('sin nada por hacer no se escribe una carpeta vacía', () => {
        const dir = temporal.carpeta('exportar-nada');
        const ruta = temporal.archivo(dir, 'Clase 01.mp4');
        const clases = [{ id: 'c', nombre: 'Clase 01', versiones: [{ n: 1, ruta, media: temporal.media() }] }];

        const r = exportar.exportar(dir, clases);
        t.eq(r.ok, false);
        t.ok(!fs.existsSync(path.join(dir, workspace.EXPORTACION_DIR)), 'ni se crea');
    });

    t.test('el cuadro de un comentario se copia adentro y se nombra ahí', async () => {
        // Que la carpeta se valga por sí sola es la razón de copiar: un
        // documento que apunta al cuadro original deja de servir en cuanto ese
        // comentario se borra, y el cuadro se va con él.
        const dir = temporal.carpeta('exportar-cuadros');
        const ruta = temporal.archivo(dir, 'Clase 01.mp4');
        const ctx = { rutaVideo: ruta, media: temporal.media() };
        const puesto = comentarios.agregar(ruta, { t: 1, texto: 'mirá este encuadre' }, ctx);

        // El cuadro lo escribe ffmpeg en la app; acá se deja uno a mano, que
        // es lo mismo que el exportador se encuentra en el disco.
        const archivos = workspace.asegurarCarpeta(ruta);
        workspace.ensureDir(archivos.frames);
        fs.writeFileSync(path.join(archivos.frames, 'c01.png'), 'PNG');
        comentarios.editar(ruta, puesto.id, { frame: 'frames/c01.png' }, ctx);

        const clases = [{ id: 'c', nombre: 'Clase 01', versiones: [{ n: 1, ruta, media: temporal.media() }] }];
        const r = exportar.exportar(dir, clases);

        const copias = fs.readdirSync(path.join(r.carpeta, exportar.IMAGENES_DIR));
        t.eq(copias.length, 1, 'se copió');
        t.tiene(copias[0], 'cuadro', 'y el nombre dice qué es');

        const md = documento(r);
        const destino = path.join(r.carpeta, exportar.IMAGENES_DIR, copias[0]);
        t.tiene(md, destino, 'el documento nombra la copia');
        t.noTiene(md, path.join(archivos.frames, 'c01.png'), 'y no el original');
    });

    t.test('todas las rutas del documento existen de verdad', async () => {
        // El test que atrapa la clase de error más cara: nombrar un archivo
        // que no se copió. El agente abre, no encuentra y contesta a ciegas.
        const { dir, clases } = await curso('exportar-rutas');
        const r = exportar.exportar(dir, clases);
        const md = documento(r);

        const nombradas = [...md.matchAll(/→ (\/\S.*)$/gm)].map(m => m[1].trim());
        t.ok(nombradas.length > 0, 'la lista final nombra archivos');
        for (const ruta of nombradas) t.ok(fs.existsSync(ruta), `existe ${path.basename(ruta)}`);

        // Y los videos, que son rutas de afuera de la carpeta a propósito:
        // Claude tiene que editar el render, no una copia.
        for (const m of md.matchAll(/^- \*\*Video:\*\* (.+)$/gm)) t.ok(fs.existsSync(m[1].trim()), 'el render existe');
    });

    t.test('el comentario general va una sola vez', async () => {
        // Hoy está copiado adentro de cada feedback.md. Repetirlo veintitrés
        // veces en un documento solo gasta contexto y abre la puerta a que dos
        // copias digan cosas distintas.
        const { dir, clases } = await curso('exportar-general');
        general.guardar(dir, 'La marca es azul.');

        const md = documento(exportar.exportar(dir, clases));
        t.eq(md.split('La marca es azul.').length - 1, 1);
    });

    t.test('exportar una sola clase deja solo esa', async () => {
        const { dir, clases } = await curso('exportar-una');
        const r = exportar.exportar(dir, clases, { soloClase: clases[1].id });

        t.eq(r.clases, 1);
        t.eq(r.comentarios, 1);
        t.tiene(documento(r), 'El logo va arriba a la derecha');
        t.noTiene(documento(r), 'Bajale tres dB');
    });

    t.test('exportar de nuevo reemplaza, no acumula', async () => {
        // Una carpeta que acumula tiene adentro el cuadro de un comentario que
        // ya se borró, y el que la lee no tiene cómo saber cuál sobra.
        const { dir, uno, clases } = await curso('exportar-dos-veces');
        const primera = exportar.exportar(dir, clases);
        t.tiene(documento(primera), 'Este corte queda duro');

        const datos = comentarios.leer(uno, temporal.media());
        const segundo = datos.comentarios.find(c => c.texto.includes('corte duro') || c.texto.includes('corte queda'));
        comentarios.borrar(uno, segundo.id, { rutaVideo: uno, media: temporal.media() });

        const segunda = exportar.exportar(dir, clases);
        t.noTiene(documento(segunda), 'Este corte queda duro');
    });

    t.test('no pisa una carpeta Feedback que no es de Reviewer', async () => {
        // El único accidente caro de todo esto: alguien que ya tenía una
        // carpeta con ese nombre y sus cosas adentro.
        const { dir, clases } = await curso('exportar-ajena');
        const ajena = path.join(dir, workspace.EXPORTACION_DIR);
        workspace.ensureDir(ajena);
        fs.writeFileSync(path.join(ajena, 'mis notas.txt'), 'no me borres');

        const r = exportar.exportar(dir, clases);
        t.eq(r.ok, false);
        t.tiene(r.error, 'Movela');
        t.ok(fs.existsSync(path.join(ajena, 'mis notas.txt')), 'sigue ahí');
    });

    t.test('avisa cuando lo que queda abierto es de una versión vieja', async () => {
        // Comentaste la v1, Claude entregó la v2 y nunca marcaste nada como
        // resuelto. Esos pedidos entran igual —no están hechos que se sepa—
        // pero leerlos sin saber que son de dos versiones atrás lleva a
        // rehacer algo que ya se rehizo.
        const dir = temporal.carpeta('exportar-vieja');
        const v1 = temporal.archivo(dir, 'Clase 01.mp4');
        temporal.archivo(dir, 'Clase 01 v2.mp4');
        comentarios.agregar(v1, { t: 1, texto: 'esto era de la v1' }, { rutaVideo: v1, media: temporal.media() });

        const leido = await versiones.escanear(dir);
        const r = exportar.exportar(dir, leido.clases);

        t.deep(r.viejas, ['Clase 01 v1']);
        t.tiene(documento(r), 'ya hay una **v2**');
    });
};
