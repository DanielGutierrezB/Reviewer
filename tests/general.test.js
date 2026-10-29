'use strict';
/**
 * El comentario del curso entero: que vaciarlo borre el archivo, y que al
 * cambiarlo se rehagan los `feedback.md` que llevan su copia adentro.
 */

const fs = require('fs');

const comentarios = require('../engine/comentarios');
const general = require('../engine/general');
const temporal = require('./lib/temporal');
const workspace = require('../engine/workspace');

module.exports = function (t) {
    t.grupo('Comentario general');

    t.test('sin escribir nada, no hay archivo ni carpeta', () => {
        const dir = temporal.carpeta('general');
        t.eq(general.leer(dir).texto, '');
        t.ok(!fs.existsSync(workspace.carpetaGeneral(dir)), 'la carpeta tampoco se crea al leer');
    });

    t.test('guardar escribe el .md y el sello', () => {
        const dir = temporal.carpeta('general');
        general.guardar(dir, '  Los títulos nunca en mayúsculas.  ');
        const archivos = workspace.archivosGenerales(dir);
        t.eq(fs.readFileSync(archivos.md, 'utf8'), 'Los títulos nunca en mayúsculas.\n');
        t.ok(workspace.readJson(archivos.json).actualizado, 'queda anotado cuándo');
    });

    t.test('vaciarlo BORRA el archivo, no lo deja en cero bytes', () => {
        // Un .md vacío al lado de los renders le aparece a cualquiera que abra
        // la carpeta sin querer decir nada, y Claude lo leería igual.
        const dir = temporal.carpeta('general');
        general.guardar(dir, 'algo');
        general.guardar(dir, '   ');
        t.ok(!fs.existsSync(workspace.archivosGenerales(dir).md), 'si el archivo no está, tampoco está la duda');
    });

    t.test('cambiarlo rehace los feedback que lo copiaron', () => {
        const dir = temporal.carpeta('general');
        const ruta = temporal.archivo(dir, 'Clase 01 v2.mp4');
        const ctx = { rutaVideo: ruta, media: temporal.media(), clase: 'Clase 01', numeroVersion: 2 };
        comentarios.agregar(ruta, { t: 5, texto: 'un comentario' }, ctx);

        general.guardar(dir, 'La marca es azul.');
        const md = fs.readFileSync(workspace.archivosDeVersion(ruta).feedback, 'utf8');
        t.tiene(md, 'La marca es azul.', 'el texto nuevo llegó a la copia');
        t.tiene(md, 'un comentario', 'y el comentario sigue ahí');
    });

    t.test('y al vaciarlo, la sección se va de los feedback', () => {
        const dir = temporal.carpeta('general');
        const ruta = temporal.archivo(dir, 'Clase 01 v2.mp4');
        comentarios.agregar(ruta, { t: 5, texto: 'x' }, { rutaVideo: ruta, media: temporal.media() });
        general.guardar(dir, 'La marca es azul.');
        general.guardar(dir, '');
        const md = fs.readFileSync(workspace.archivosDeVersion(ruta).feedback, 'utf8');
        t.noTiene(md, 'La marca es azul.');
    });

    t.test('una versión sin comentarios no se toca', () => {
        const dir = temporal.carpeta('general');
        temporal.archivo(dir, 'Clase 09 v1.mp4');
        general.guardar(dir, 'algo');
        t.deep(general.versionesConFeedback(dir), [], 'nada que rehacer');
        t.ok(!fs.existsSync(workspace.carpetaDeVersion(`${dir}/Clase 09 v1.mp4`)), 'y su carpeta sigue sin existir');
    });

    t.test('la carpeta Reviewer no se confunde con una carpeta de versión', () => {
        const dir = temporal.carpeta('general');
        const ruta = temporal.archivo(dir, 'Clase 01 v1.mp4');
        comentarios.agregar(ruta, { t: 1, texto: 'x' }, { rutaVideo: ruta, media: temporal.media() });
        general.guardar(dir, 'texto');
        t.eq(general.versionesConFeedback(dir).length, 1);
    });

    t.test('el feedback dice dónde está el original', () => {
        const dir = temporal.carpeta('general');
        const ruta = temporal.archivo(dir, 'Clase 01 v1.mp4');
        comentarios.agregar(ruta, { t: 1, texto: 'x' }, { rutaVideo: ruta, media: temporal.media() });
        general.guardar(dir, 'texto del curso');
        const md = fs.readFileSync(workspace.archivosDeVersion(ruta).feedback, 'utf8');
        t.tiene(md, workspace.archivosGenerales(dir).md, 'por si la copia quedó vieja');
    });
};
