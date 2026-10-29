'use strict';
/**
 * Que borrar un comentario se pueda deshacer de verdad.
 *
 * El texto volvía solo con rescribir el JSON; lo que no volvía era el cuadro.
 * Estos tests miran el disco y no la estructura devuelta, porque el modo en que
 * esto se rompe es exactamente ese: la tarjeta reaparece completa en pantalla,
 * con su ruta de imagen adentro, y el PNG al que apunta ya no existe. Nada
 * falla; solo queda un hueco gris donde estaba el encuadre del que hablaba el
 * comentario.
 */

const fs = require('fs');
const path = require('path');

const comentarios = require('../engine/comentarios');
const temporal = require('./lib/temporal');
const workspace = require('../engine/workspace');

module.exports = function (t) {
    t.grupo('Papelera y deshacer');

    /** Una versión con un comentario que tiene cuadro y dibujo en el disco. */
    function conImagenes() {
        const dir = temporal.carpeta('papelera');
        const ruta = temporal.archivo(dir, 'Clase 07 v2.mp4');
        const ctx = { rutaVideo: ruta, media: temporal.media() };

        const { id } = comentarios.agregar(ruta, { t: 3, texto: 'El logo pisa el borde' }, ctx);
        const archivos = workspace.archivosDeVersion(ruta);
        fs.mkdirSync(archivos.frames, { recursive: true });
        fs.mkdirSync(archivos.dibujos, { recursive: true });
        const frame = path.join(workspace.FRAMES_DIR, `${id}.png`);
        const dibujo = path.join(workspace.DIBUJOS_DIR, `${id}.png`);
        fs.writeFileSync(path.join(archivos.carpeta, frame), 'el cuadro');
        fs.writeFileSync(path.join(archivos.carpeta, dibujo), 'el cuadro con el trazo');

        const datos = comentarios.editar(ruta, id, { frame, dibujo }, ctx);
        return { ruta, ctx, id, archivos, frame, dibujo, datos };
    }

    const hay = (archivos, relativa) => fs.existsSync(path.join(archivos.carpeta, relativa));

    t.test('borrar no tira los PNG: los guarda', () => {
        const { ruta, ctx, id, archivos, frame, dibujo } = conImagenes();
        comentarios.borrar(ruta, id, ctx);

        t.ok(!hay(archivos, frame), 'el cuadro sale de su carpeta');
        t.ok(!hay(archivos, dibujo), 'y el dibujo también');
        t.eq(fs.readdirSync(archivos.papelera).length, 2, 'pero los dos están en la papelera');
    });

    t.test('deshacer el borrado devuelve el comentario Y sus PNG', () => {
        const { ruta, ctx, id, archivos, frame, dibujo, datos } = conImagenes();
        comentarios.borrar(ruta, id, ctx);
        const vuelto = comentarios.aplicar(ruta, datos, ctx);

        t.eq(vuelto.comentarios.length, 1, 'el comentario está de nuevo');
        t.eq(vuelto.comentarios[0].id, id, 'con su mismo id, que ya viajó en el feedback');
        t.ok(hay(archivos, frame), 'y el cuadro volvió a su lugar');
        t.eq(fs.readFileSync(path.join(archivos.carpeta, dibujo), 'utf8'), 'el cuadro con el trazo',
            'con su contenido, no un archivo vacío con el nombre justo');
        t.ok(!fs.readdirSync(archivos.papelera).length, 'y la papelera quedó vacía');
    });

    t.test('rehacer el borrado los vuelve a guardar', () => {
        const { ruta, ctx, id, archivos, frame, datos } = conImagenes();
        const sinEl = comentarios.borrar(ruta, id, ctx);
        comentarios.aplicar(ruta, datos, ctx);
        comentarios.aplicar(ruta, sinEl, ctx);

        t.ok(!hay(archivos, frame), 'el cuadro se fue otra vez');
        t.eq(fs.readdirSync(archivos.papelera).length, 2, 'y está esperando de nuevo');
    });

    t.test('un cuadro y un dibujo del mismo comentario no se pisan en la papelera', () => {
        // Los dos se llaman `c01.png`; lo que los distingue es la carpeta. Si
        // la papelera fuera plana sin aplanar el nombre, el segundo pisaría al
        // primero y deshacer devolvería el dibujo en el lugar del cuadro.
        const { ruta, ctx, id, archivos, frame, dibujo, datos } = conImagenes();
        t.eq(path.basename(frame), path.basename(dibujo), 'tienen el mismo nombre a propósito');

        comentarios.borrar(ruta, id, ctx);
        comentarios.aplicar(ruta, datos, ctx);

        t.eq(fs.readFileSync(path.join(archivos.carpeta, frame), 'utf8'), 'el cuadro');
        t.eq(fs.readFileSync(path.join(archivos.carpeta, dibujo), 'utf8'), 'el cuadro con el trazo');
    });

    t.test('deshacer hasta dejarlo vacío borra el feedback, pero no la red', () => {
        const { ruta, ctx, id, archivos } = conImagenes();
        comentarios.borrar(ruta, id, ctx);

        t.ok(!fs.existsSync(archivos.feedback), 'sin comentarios no queda markdown');
        t.ok(fs.existsSync(archivos.papelera), 'y la papelera sobrevive a que la carpeta se vacíe');
    });

    t.test('vaciar la papelera la tira entera', () => {
        const { ruta, ctx, id, archivos } = conImagenes();
        comentarios.borrar(ruta, id, ctx);
        workspace.vaciarPapelera(ruta);
        t.ok(!fs.existsSync(archivos.papelera), 'se fue');
        // Se llama al cambiar de versión, que puede pasar sin haber borrado
        // nada: no puede tirar si no hay qué.
        workspace.vaciarPapelera(ruta);
        t.ok(true, 'y vaciarla dos veces no rompe');
    });

    t.test('reemplazar el cuadro por «editar» también manda el viejo a la papelera', () => {
        // La decisión que protege: hay UN solo camino de escritura al disco.
        // Cuando había dos —`guardar`, que no miraba archivos, y `aplicar`, que
        // reconciliaba— este flujo iba por el primero: el canal
        // `comentario-imagenes` llama a `editar`, y el PNG del cuadro anterior
        // quedaba huérfano en `frames/` sin que nada fallara y sin que nadie lo
        // nombrara. Son dos archivos y no uno porque el nombre del cuadro lleva
        // el timecode adentro (`frames.nombreDe`): sacarlo de nuevo en otro
        // instante escribe al lado, no encima.
        const { ruta, ctx, id, archivos, frame, dibujo, datos } = conImagenes();
        const otro = path.join(workspace.FRAMES_DIR, `${id}-00h00m09s15f.png`);
        fs.writeFileSync(path.join(archivos.carpeta, otro), 'el cuadro del segundo 9');

        comentarios.editar(ruta, id, { frame: otro }, ctx);

        t.ok(!hay(archivos, frame), 'el cuadro viejo salió de frames/');
        t.ok(hay(archivos, otro), 'y el nuevo es el que quedó en su lugar');
        t.deep(fs.readdirSync(archivos.papelera), [`${workspace.FRAMES_DIR}_${path.basename(frame)}`],
            'el viejo está guardado, no tirado');

        // Y por eso mismo el reemplazo se puede deshacer entero, que es lo que
        // el huérfano no permitía: el PNG de antes seguía en la carpeta por
        // casualidad, no porque alguien lo hubiera guardado.
        const vuelto = comentarios.aplicar(ruta, datos, ctx);
        t.eq(vuelto.comentarios[0].frame, frame, 'el JSON volvió a nombrar el cuadro de antes');
        t.eq(fs.readFileSync(path.join(archivos.carpeta, frame), 'utf8'), 'el cuadro');
        t.eq(fs.readFileSync(path.join(archivos.carpeta, dibujo), 'utf8'), 'el cuadro con el trazo');
        t.ok(!hay(archivos, otro), 'y el que se había puesto encima quedó esperando su propio ⌘⇧Z');
    });

    t.test('el deshacer y el guardado son la misma función, y no dos caminos', () => {
        // Lo que esto fija no es una conducta sino la estructura: mientras
        // `aplicar` sea `guardar`, la invariante de la papelera se sostiene por
        // construcción y no porque ocho funciones elijan bien. Si alguien le
        // vuelve a escribir un cuerpo propio, este test avisa antes de que el
        // próximo PNG se quede huérfano.
        t.eq(comentarios.aplicar, comentarios.guardar,
            '`comentarios-aplicar` es el nombre que usa ⌘Z, no una segunda salida al disco');
    });

    t.test('traer de la papelera no pisa un archivo que el editor volvió a poner', () => {
        // Los nombres en el disco se reciclan: el del archivo lo elige
        // `nombreLibre`, que mira qué hay en la carpeta, y lo que está en la
        // papelera no está en la carpeta. Así que quitar un adjunto y colgar
        // otro distinto con el mismo nombre deja dos archivos homónimos en dos
        // lugares. Si la vuelta pisara, el adjunto se llamaría como el que el
        // editor acaba de poner y por dentro sería el que había sacado —y eso
        // no se ve desde ningún lado: se ve en el render de mañana.
        const dir = temporal.carpeta('papelera-homonimos');
        const ruta = temporal.archivo(dir, 'Clase 12 v1.mp4');
        const ctx = { rutaVideo: ruta, media: temporal.media() };
        const { id } = comentarios.agregar(ruta, { t: 1, texto: 'el logo no es ese' }, ctx);
        const archivos = workspace.archivosDeVersion(ruta);

        const viejo = comentarios.adjuntar(ruta, id, [
            { origen: temporal.archivo(dir, 'v1.png', 'el logo viejo'), nombre: 'logo.png' }
        ], ctx).datos.comentarios[0].adjuntos[0];
        comentarios.quitarAdjunto(ruta, id, viejo.archivo, ctx);

        const nuevo = comentarios.adjuntar(ruta, id, [
            { origen: temporal.archivo(dir, 'v2.png', 'el logo nuevo'), nombre: 'logo.png' }
        ], ctx).datos.comentarios[0].adjuntos[0];

        t.eq(nuevo.archivo, viejo.archivo, 'se recicló el nombre, que es la condición del caso');
        t.eq(fs.readFileSync(path.join(archivos.carpeta, nuevo.archivo), 'utf8'), 'el logo nuevo',
            'y en la carpeta quedó el que se acaba de colgar, no el que esperaba en la papelera');
    });

    t.test('aplicar no deja entrar rutas de afuera de la carpeta', () => {
        // El JSON es un archivo que alguien puede editar a mano, y de él sale
        // una ruta que se usa para mover archivos.
        const { ruta, ctx, id, datos } = conImagenes();
        const afuera = path.join(path.dirname(ruta), 'no-tocar.txt');
        fs.writeFileSync(afuera, 'esto no es de Reviewer');

        const envenenado = {
            ...datos,
            comentarios: [{ ...datos.comentarios[0], frame: '../no-tocar.txt' }]
        };
        comentarios.aplicar(ruta, envenenado, ctx);
        comentarios.borrar(ruta, id, ctx);

        t.ok(fs.existsSync(afuera), 'el archivo de al lado sigue donde estaba');
    });
};
