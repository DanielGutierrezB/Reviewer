'use strict';
/**
 * La vuelta: Claude marca en el documento lo que hizo y Reviewer lo resuelve.
 *
 * Lo que se protege es que lo hecho no se vuelva a pedir —el caso de pasarle
 * una clase sola y después el curso entero—, sin que una marca resuelva algo
 * que nadie hizo: un comentario que cambió después de pedirse, uno que el
 * editor volvió a abrir, o el ejemplo de las instrucciones.
 */

const fs = require('fs');
const path = require('path');

const comentarios = require('../engine/comentarios');
const entrega = require('../engine/entrega');
const exportar = require('../engine/exportar');
const temporal = require('./lib/temporal');
const versiones = require('../engine/versiones');

const ctx = ruta => ({ rutaVideo: ruta, media: temporal.media() });

/** Un curso con dos clases y un comentario abierto en cada una. */
async function curso(nombre) {
    const dir = temporal.carpeta(nombre);
    const uno = temporal.archivo(dir, 'Clase 01 - Intro.mp4');
    const dos = temporal.archivo(dir, 'Clase 02 - Hooks.mp4');
    comentarios.agregar(uno, { t: 1, texto: 'Bajale a la música' }, ctx(uno));
    comentarios.agregar(dos, { t: 2, texto: 'El logo va arriba' }, ctx(dos));
    const { clases } = await versiones.escanear(dir);
    return { dir, uno, dos, clases };
}

/** Lo que haría Claude: marcar la casilla de un código en el documento. */
function marcar(documento, codigo, nota) {
    const texto = fs.readFileSync(documento, 'utf8');
    const casilla = `- [ ] Hecho · [${codigo}]`;
    if (!texto.includes(casilla)) throw new Error(`no está la casilla de ${codigo}`);
    fs.writeFileSync(documento, texto.replace(casilla, `- [x] Hecho · [${codigo}]${nota ? ` — ${nota}` : ''}`));
}

function codigoDe(clases, i, ruta) {
    const clase = clases[i];
    const version = clase.versiones[0];
    const c = comentarios.leer(ruta, temporal.media()).comentarios[0];
    return entrega.codigoDe(clase, version, c);
}

const estadoDe = ruta => comentarios.leer(ruta, temporal.media()).comentarios[0];

module.exports = async function (t) {
    t.grupo('La vuelta de Claude: marcar lo hecho en el documento');

    t.test('cada comentario viaja con su casilla y su código', async () => {
        const { dir, uno, clases } = await curso('entrega-casillas');
        const r = exportar.exportar(dir, clases);
        const texto = fs.readFileSync(r.documento, 'utf8');
        t.tiene(texto, `- [ ] Hecho · [${codigoDe(clases, 0, uno)}]`);
        t.tiene(texto, 'cambiá `[ ]` por `[x]`', 'y el documento dice cómo marcarla');
    });

    t.test('lo que Claude marca en el documento de una clase queda resuelto', async () => {
        const { dir, uno, clases } = await curso('entrega-marca');
        const deLaClase = exportar.exportar(dir, clases, { soloClase: clases[0].id });
        marcar(deLaClase.documento, codigoDe(clases, 0, uno), 'bajé la música 3 dB');

        const r = entrega.aplicarHechos(dir, ctx);
        t.eq(r.resueltos.length, 1);
        const c = estadoDe(uno);
        t.eq(c.estado, 'resuelto');
        t.eq(c.hecho.nota, 'bajé la música 3 dB', 'con lo que dijo que hizo');
    });

    t.test('el export del curso ya no pide lo que Claude hizo en el de la clase', async () => {
        // El caso que motivó todo esto: la clase se le pasó sola, Claude la
        // hizo, y después se le pasa el curso entero.
        const { dir, uno, clases } = await curso('entrega-no-repite');
        const deLaClase = exportar.exportar(dir, clases, { soloClase: clases[0].id });
        marcar(deLaClase.documento, codigoDe(clases, 0, uno));

        const delCurso = fs.readFileSync(exportar.exportar(dir, clases).documento, 'utf8');
        t.noTiene(delCurso, 'Bajale a la música', 'lo hecho no se vuelve a pedir');
        t.tiene(delCurso, 'El logo va arriba', 'lo otro sí');
    });

    t.test('rehacer un documento no borra las marcas que todavía no se leyeron', async () => {
        // Las marcas están en el documento, y exportar lo reescribe. Si se
        // reescribiera antes de leerlas, lo que Claude marcó se perdería.
        const { dir, uno, clases } = await curso('entrega-reescribe');
        const delCurso = exportar.exportar(dir, clases);
        marcar(delCurso.documento, codigoDe(clases, 0, uno));

        exportar.exportar(dir, clases);
        t.eq(estadoDe(uno).estado, 'resuelto');
        t.noTiene(fs.readFileSync(delCurso.documento, 'utf8'), 'Bajale a la música');
    });

    t.test('si el editor lo vuelve a abrir, la marca no lo vuelve a cerrar', async () => {
        // Lo reabrió porque no quedó bien. La casilla sigue marcada en el
        // documento viejo, y no puede deshacer esa decisión.
        const { dir, uno, clases } = await curso('entrega-reabre');
        const r = exportar.exportar(dir, clases, { soloClase: clases[0].id });
        marcar(r.documento, codigoDe(clases, 0, uno));
        entrega.aplicarHechos(dir, ctx);

        comentarios.editar(uno, estadoDe(uno).id, { estado: 'abierto' }, ctx(uno));
        t.eq(estadoDe(uno).hecho, null, 'abierto otra vez, ya no dice que lo hizo Claude');
        entrega.aplicarHechos(dir, ctx);
        t.eq(estadoDe(uno).estado, 'abierto', 'sigue abierto');
    });

    t.test('una marca sobre un comentario que cambió después no lo resuelve', async () => {
        // El editor agregó algo después de pasárselo: Claude hizo el pedido
        // viejo, no este.
        const { dir, uno, clases } = await curso('entrega-cambio');
        const r = exportar.exportar(dir, clases, { soloClase: clases[0].id });
        const codigo = codigoDe(clases, 0, uno);
        comentarios.editar(uno, estadoDe(uno).id, { texto: 'Bajale a la música, y sacá el eco' }, ctx(uno));
        marcar(r.documento, codigo);

        entrega.aplicarHechos(dir, ctx);
        t.eq(estadoDe(uno).estado, 'abierto');
    });

    t.test('el ejemplo de las instrucciones no resuelve nada', async () => {
        // Las instrucciones muestran una casilla marcada. Va con sangría y con
        // un código que no existe, y las dos cosas la dejan afuera.
        t.deep(entrega.marcadasEn('    - [x] Hecho · [03-curso-v2-v4-c01] — ejemplo'), [], 'con sangría no cuenta');
        t.deep(entrega.marcadasEn('- [x] Hecho · [03-curso-v2-v4-c01] — hecho').map(m => m.codigo), ['03-curso-v2-v4-c01']);

        const { dir, uno, clases } = await curso('entrega-ejemplo');
        exportar.exportar(dir, clases);
        entrega.aplicarHechos(dir, ctx);
        t.eq(estadoDe(uno).estado, 'abierto');
    });

    t.grupo('La ruta de la carpeta, en un solo lugar');

    t.test('la ruta de esta máquina va una vez y el resto la usa como variable', async () => {
        const { dir, clases } = await curso('entrega-variable');
        const r = exportar.exportar(dir, clases);
        const texto = fs.readFileSync(r.documento, 'utf8');
        t.tiene(texto, `FEEDBACK = ${r.carpeta}`);
        t.eq(texto.split(dir).length - 1, 1, 'en un solo renglón');
        t.tiene(texto, '{FEEDBACK}/../Clase 01 - Intro.mp4', 'y los videos parten de la variable');
        t.tiene(texto, 'es la carpeta donde está este archivo', 'con el respaldo para quien no pasa por Reviewer');
    });

    t.test('al abrir la carpeta en otra máquina se corrige esa línea y nada más', async () => {
        // Otra computadora, u otra ubicación: la ruta que quedó escrita ya no
        // existe. Se corrige la línea de la variable y lo demás —las casillas
        // que Claude ya marcó— queda como estaba.
        const { dir, uno, clases } = await curso('entrega-mudanza');
        const r = exportar.exportar(dir, clases);
        marcar(r.documento, codigoDe(clases, 0, uno), 'hecho en la otra máquina');

        const otra = `${dir}-en-otra-maquina`;
        fs.renameSync(dir, otra);
        const documento = path.join(otra, 'Feedback', path.basename(r.documento));
        const antes = fs.readFileSync(documento, 'utf8');

        t.eq(entrega.corregirBase(otra), 1);
        const despues = fs.readFileSync(documento, 'utf8');
        t.tiene(despues, `FEEDBACK = ${path.join(otra, 'Feedback')}`);
        t.eq(despues.replace(/^FEEDBACK = .*$/m, ''), antes.replace(/^FEEDBACK = .*$/m, ''), 'lo demás no se tocó');
        t.eq(entrega.corregirBase(otra), 0, 'y la segunda vez no hay nada que corregir');
        fs.renameSync(otra, dir);
    });

    t.test('solo se leen los documentos que hizo el export', async () => {
        // Un .md que alguien dejó en la carpeta puede tener cualquier casilla.
        const { dir, uno, clases } = await curso('entrega-ajeno');
        const r = exportar.exportar(dir, clases);
        fs.writeFileSync(path.join(r.carpeta, 'notas.md'), `- [x] Hecho · [${codigoDe(clases, 0, uno)}]\n`);
        entrega.aplicarHechos(dir, ctx);
        t.eq(estadoDe(uno).estado, 'abierto');
    });
};
