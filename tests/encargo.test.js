'use strict';
/**
 * El encargo de cada clase: cuándo vale y cuándo lo arma el export.
 *
 * Lo que se protege acá es una sola cosa: que a Claude nunca le llegue un
 * encargo que ya no resume lo que hay. Uno viejo no se ve viejo —es una lista
 * ordenada y razonable— y deja afuera justo el comentario que se agregó
 * después.
 *
 * El modelo es un servidor local en 127.0.0.1 que habla el dialecto de OpenAI,
 * como LM Studio. No sale a internet, y deja contar cuántas veces se le
 * preguntó, que es la mitad de lo que hay que probar.
 */

const fs = require('fs');
const http = require('http');

const comentarios = require('../engine/comentarios');
const encargo = require('../engine/encargo');
const exportar = require('../engine/exportar');
const feedback = require('../engine/feedback');
const general = require('../engine/general');
const temporal = require('./lib/temporal');
const versiones = require('../engine/versiones');
const workspace = require('../engine/workspace');

/** Un modelo de mentira. `responder` decide qué contesta a cada pedido. */
function modelo(responder) {
    return new Promise(listo => {
        const pedidos = [];
        const s = http.createServer((req, res) => {
            let cuerpo = '';
            req.on('data', d => { cuerpo += d; });
            req.on('end', () => {
                const pedido = JSON.parse(cuerpo || '{}');
                pedidos.push(pedido);
                const r = responder(pedido);
                res.writeHead(r.estado || 200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(r.cuerpo || { choices: [{ message: { content: r.texto } }] }));
            });
        });
        s.listen(0, '127.0.0.1', () => listo({
            config: { proveedor: 'openai', url: `http://127.0.0.1:${s.address().port}`, modelo: 'falso' },
            pedidos,
            cerrar: () => new Promise(f => s.close(f))
        }));
    });
}

/** Un curso con dos clases y un comentario abierto en cada una. */
async function curso(nombre) {
    const dir = temporal.carpeta(nombre);
    const uno = temporal.archivo(dir, 'Clase 01 - Intro.mp4');
    const dos = temporal.archivo(dir, 'Clase 02 - Hooks.mp4');
    const contextoDe = ruta => ({ rutaVideo: ruta, media: temporal.media() });
    comentarios.agregar(uno, { t: 1, texto: 'Bajale a la música' }, contextoDe(uno));
    comentarios.agregar(dos, { t: 2, texto: 'El logo va arriba' }, contextoDe(dos));
    const clases = (await versiones.escanear(dir)).clases;
    return { dir, uno, dos, clases, contextoDe };
}

const ENCARGO = '- Primero lo de la música (c01).';

module.exports = async function (t) {
    t.grupo('El encargo: cuándo vale');

    const datos = {
        fps: 25,
        comentarios: [
            { id: 'c01', t: 1, texto: 'uno', estado: 'abierto', adjuntos: [] },
            { id: 'c02', t: 2, texto: 'dos', estado: 'resuelto', adjuntos: [] }
        ]
    };

    t.test('vale mientras el modelo leería lo mismo', () => {
        const huella = encargo.huellaDe(datos, 'general');
        const con = { ...datos, instruccion: { texto: ENCARGO, huella } };
        t.ok(encargo.vigente(con, 'general'));

        const editado = { ...con, comentarios: [{ ...datos.comentarios[0], texto: 'uno cambiado' }, datos.comentarios[1]] };
        t.eq(encargo.vigente(editado, 'general'), false, 'un comentario abierto editado lo vence');
        t.eq(encargo.vigente(con, 'otro general'), false, 'cambiar el texto general también');

        // Lo resuelto no lo lee el modelo, así que tocarlo no cambia nada.
        const resuelto = { ...con, comentarios: [datos.comentarios[0], { ...datos.comentarios[1], texto: 'otra cosa' }] };
        t.ok(encargo.vigente(resuelto, 'general'), 'editar uno resuelto no lo vence');
    });

    t.test('un encargo sin huella no vale nunca', () => {
        // Son los que dejó el botón viejo «Preparar para Claude»: no hay forma
        // de saber qué resumían, así que se rehacen en el próximo export.
        t.eq(encargo.vigente({ ...datos, instruccion: { texto: ENCARGO } }, ''), false);
    });

    t.test('el feedback.md lleva el encargo solo si todavía vale', () => {
        const ctx = { rutaVideo: '/x/Clase v1.mp4', clase: 'X', etiqueta: 'v1' };
        const base = { ...datos, video: 'Clase v1.mp4' };
        const vale = feedback.escribir({ ...base, instruccion: { texto: ENCARGO, huella: encargo.huellaDe(base, '') } }, ctx);
        t.tiene(vale, ENCARGO);
        t.ok(vale.indexOf('## Qué hay que hacer') < vale.indexOf('## Comentarios de este video'), 'y va antes de la lista');

        const viejo = feedback.escribir({ ...base, instruccion: { texto: ENCARGO, huella: 'otra' } }, ctx);
        t.noTiene(viejo, ENCARGO, 'uno viejo no se escribe');
    });

    t.grupo('El encargo: lo arma el export');

    t.test('exportar arma el encargo de cada clase y lo pone arriba de ella', async () => {
        const m = await modelo(() => ({ texto: ENCARGO }));
        try {
            const { dir, uno, clases, contextoDe } = await curso('encargo-arma');
            const r = await exportar.encargosAlDia(dir, clases, { config: m.config, contextoDe });
            t.eq(r.hechos, 2, 'uno por clase');
            t.eq(m.pedidos.length, 2);

            const doc = fs.readFileSync(exportar.exportar(dir, clases).documento, 'utf8');
            const seccion = doc.slice(doc.indexOf('## Clase 01 - Intro'), doc.indexOf('## Clase 02 - Hooks'));
            t.tiene(seccion, '### Qué hay que hacer');
            t.ok(seccion.indexOf(ENCARGO) < seccion.indexOf('Bajale a la música'), 'el encargo va antes de los comentarios');

            // Y queda guardado con la versión, que es lo que lo hace reusable.
            t.ok(encargo.vigente(comentarios.leer(uno), ''), 'guardado y vigente');
        } finally {
            await m.cerrar();
        }
    });

    t.test('exportar otra vez sin cambios no le vuelve a preguntar al modelo', async () => {
        const m = await modelo(() => ({ texto: ENCARGO }));
        try {
            const { dir, uno, clases, contextoDe } = await curso('encargo-reusa');
            await exportar.encargosAlDia(dir, clases, { config: m.config, contextoDe });
            const segunda = await exportar.encargosAlDia(dir, clases, { config: m.config, contextoDe });
            t.eq(segunda.hechos, 0);
            t.eq(segunda.vigentes, 2);
            t.eq(m.pedidos.length, 2, 'los dos de la primera vez y ninguno más');

            // Tocar una clase rehace esa y nada más.
            comentarios.agregar(uno, { t: 3, texto: 'Y el corte del final' }, contextoDe(uno));
            const tercera = await exportar.encargosAlDia(dir, clases, { config: m.config, contextoDe });
            t.eq(tercera.hechos, 1);
            t.eq(m.pedidos.length, 3);
        } finally {
            await m.cerrar();
        }
    });

    t.test('cambiar el texto general rehace todos los encargos', async () => {
        // El modelo lo lee para escribir cada uno.
        const m = await modelo(() => ({ texto: ENCARGO }));
        try {
            const { dir, clases, contextoDe } = await curso('encargo-general');
            await exportar.encargosAlDia(dir, clases, { config: m.config, contextoDe });
            general.guardar(dir, 'Los títulos en minúscula.');
            const r = await exportar.encargosAlDia(dir, clases, { config: m.config, contextoDe });
            t.eq(r.hechos, 2);
        } finally {
            await m.cerrar();
        }
    });

    t.test('un encargo que quedó viejo no entra al export aunque esté guardado', async () => {
        // Se comentó después de armarlo y el export no lo pudo rehacer —sin
        // modelo, en este caso—. Mandar el viejo sería mandar una lista que
        // parece completa y no tiene el comentario nuevo.
        const m = await modelo(() => ({ texto: ENCARGO }));
        try {
            const { dir, uno, clases, contextoDe } = await curso('encargo-viejo');
            await exportar.encargosAlDia(dir, clases, { config: m.config, contextoDe });
            comentarios.agregar(uno, { t: 3, texto: 'Y el corte del final' }, contextoDe(uno));

            const doc = fs.readFileSync(exportar.exportar(dir, clases).documento, 'utf8');
            const seccion = doc.slice(doc.indexOf('## Clase 01 - Intro'), doc.indexOf('## Clase 02 - Hooks'));
            t.noTiene(seccion, ENCARGO, 'el de la clase tocada no va');
            t.tiene(doc.slice(doc.indexOf('## Clase 02 - Hooks')), ENCARGO, 'el de la otra, que sigue valiendo, sí');
        } finally {
            await m.cerrar();
        }
    });

    t.test('sin modelo elegido el export sale igual, sin encargos', async () => {
        const { dir, clases, contextoDe } = await curso('encargo-sin-modelo');
        const r = await exportar.encargosAlDia(dir, clases, { config: { proveedor: 'ollama', modelo: '' }, contextoDe });
        t.eq(r.sinModelo, true);
        const hecho = exportar.exportar(dir, clases);
        t.ok(hecho.ok);
        const doc = fs.readFileSync(hecho.documento, 'utf8');
        t.noTiene(doc, '### Qué hay que hacer');
        t.tiene(doc, 'Bajale a la música', 'la lista de comentarios va siempre');
    });

    t.test('si el modelo falla, esa clase sale sin encargo y se dice cuál', async () => {
        const m = await modelo(() => ({ estado: 500, cuerpo: { error: 'se cayó' } }));
        try {
            const { dir, clases, contextoDe } = await curso('encargo-falla');
            const r = await exportar.encargosAlDia(dir, clases, { config: m.config, contextoDe, soloClase: clases[0].id });
            t.eq(r.hechos, 0);
            t.eq(r.fallados.length, 1);
            t.tiene(r.fallados[0], 'Clase 01 - Intro');
        } finally {
            await m.cerrar();
        }
    });

    t.test('el encargo nuevo se ve en el feedback.md de la versión', async () => {
        // Es el mismo encargo que va al export: el que copia la ruta de una sola
        // versión para pasársela a Claude tiene que encontrar lo mismo.
        const m = await modelo(() => ({ texto: ENCARGO }));
        try {
            const { dir, uno, clases, contextoDe } = await curso('encargo-feedback');
            await exportar.encargosAlDia(dir, clases, { config: m.config, contextoDe });
            t.tiene(fs.readFileSync(workspace.archivosDeVersion(uno).feedback, 'utf8'), ENCARGO);
        } finally {
            await m.cerrar();
        }
    });

    t.test('el avance se cuenta antes de cada clase', async () => {
        const m = await modelo(() => ({ texto: ENCARGO }));
        try {
            const { dir, clases, contextoDe } = await curso('encargo-avance');
            const avisos = [];
            await exportar.encargosAlDia(dir, clases, { config: m.config, contextoDe, alAvanzar: a => avisos.push(a) });
            t.deep(avisos.map(a => [a.hecho, a.total]), [[0, 2], [1, 2]]);
            t.tiene(avisos[0].nombre, 'Clase 01 - Intro');
        } finally {
            await m.cerrar();
        }
    });

};
