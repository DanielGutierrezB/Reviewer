'use strict';
/**
 * Frame.io: el cliente, la subida, el versionado y la conversión.
 *
 * Todo contra un Frame.io de juguete en 127.0.0.1, igual que los tests de
 * actualizaciones: no sale a internet, que es lo que la suite promete, y
 * recorre el camino de verdad —cabeceras, paginado, 429, firmas de las partes—
 * en vez de un sustituto que probaría al sustituto.
 *
 * Lo que más importa acá es lo que miente en silencio: un timecode convertido
 * con los fps equivocados cae segundo y medio más adelante y nadie lo nota
 * hasta que Claude corta en el lugar errado, y una fusión que no es idempotente
 * duplica cada comentario en cada vuelta de dos minutos.
 */

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');

const auth = require('../engine/frameio-auth');
const comentariosLib = require('../engine/comentarios');
const convertir = require('../engine/frameio-convertir');
const frameio = require('../engine/frameio');
const subida = require('../engine/frameio-subida');
const vinculo = require('../engine/frameio-vinculo');
const temporal = require('./lib/temporal');

/** Un Frame.io de juguete que contesta lo que se le diga, y anota qué le pidieron. */
function servidor(responder) {
    const pedidos = [];
    return new Promise(listo => {
        const s = http.createServer((req, res) => {
            let cuerpo = '';
            req.on('data', t => { cuerpo += t; });
            req.on('end', () => {
                pedidos.push({ metodo: req.method, url: req.url, cabeceras: req.headers, cuerpo });
                responder(req, res, cuerpo);
            });
        });
        s.listen(0, '127.0.0.1', () => listo({
            base: `http://127.0.0.1:${s.address().port}`,
            pedidos,
            cerrar: () => new Promise(f => s.close(f))
        }));
    });
}

const json = (res, datos, estado = 200) => {
    res.writeHead(estado, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(datos));
};

/** Una versión como la que arma el escaneo, con lo justo. */
const version = (archivo, n, extra = {}) => ({
    archivo, n, etiqueta: `v${n}`, ruta: `/cursos/${archivo}`, edicion: false, archivada: false, media: { fps: 30 }, ...extra
});

module.exports = async function (t) {
    t.grupo('Frame.io: el cliente');

    t.test('manda el Bearer y pega en la ruta de la cuenta', async () => {
        const s = await servidor((req, res) => json(res, { data: { id: 'f1', name: 'uno.mp4' } }));
        try {
            const api = frameio.cliente({ token: 'abc', cuenta: 'cta', _base: s.base });
            const r = await api.archivo('f1');
            t.eq(r.name, 'uno.mp4');
            t.eq(s.pedidos[0].url, '/v4/accounts/cta/files/f1');
            t.eq(s.pedidos[0].cabeceras.authorization, 'Bearer abc');
            t.ok(s.pedidos[0].cabeceras['user-agent'], 'con User-Agent, que si no algunos intermediarios cortan');
        } finally { await s.cerrar(); }
    });

    t.test('el token puede ser una función, para pedirlo recién al salir', async () => {
        // Es lo que deja que una llamada que arranca con el token por vencer lo
        // renueve antes, en vez de fallar con un 401 que el llamador tendría
        // que interpretar.
        let veces = 0;
        const s = await servidor((req, res) => json(res, { data: {} }));
        try {
            const api = frameio.cliente({ token: async () => { veces++; return `t${veces}`; }, cuenta: 'c', _base: s.base });
            await api.archivo('a');
            await api.archivo('b');
            t.eq(veces, 2, 'se pide uno por llamada');
            t.eq(s.pedidos[1].cabeceras.authorization, 'Bearer t2');
        } finally { await s.cerrar(); }
    });

    t.test('sigue el cursor y le vuelve a poner los parámetros, que el enlace pierde', async () => {
        // `links.next` de Frame.io solo lleva el `after`: `include`, `sort` y
        // `page_size` no viajan. Seguirlo tal cual trae la segunda página sin
        // las respuestas ni el autor, que es justo lo que se había pedido.
        const s = await servidor((req, res) => {
            const u = new URL(req.url, 'http://x');
            if (!u.searchParams.get('after')) {
                json(res, { data: [{ id: 'c1' }], links: { next: '/v4/accounts/c/files/f/comments?after=XYZ' } });
            } else {
                json(res, { data: [{ id: 'c2' }], links: { next: null } });
            }
        });
        try {
            const api = frameio.cliente({ token: 'x', cuenta: 'c', _base: s.base });
            const todos = await api.comentarios('f');
            t.deep(todos.map(c => c.id), ['c1', 'c2']);
            const segunda = new URL(s.pedidos[1].url, 'http://x');
            t.eq(segunda.searchParams.get('after'), 'XYZ');
            t.eq(segunda.searchParams.get('include'), 'replies,owner', 'el include se vuelve a poner');
            t.eq(segunda.searchParams.get('timestamp_as_timecode'), 'false', 'y el formato del instante también');
        } finally { await s.cerrar(); }
    });

    t.test('un 429 se espera y se reintenta en vez de fallar', async () => {
        // Los límites de esta API son bajos —10 por minuto para editar un
        // comentario— así que toparse con ellos es parte del uso normal.
        let veces = 0;
        const s = await servidor((req, res) => {
            veces++;
            if (veces === 1) { res.writeHead(429, { 'retry-after': '1' }); res.end('{}'); return; }
            json(res, { data: { ok: true } });
        });
        try {
            const api = frameio.cliente({ token: 'x', cuenta: 'c', _base: s.base, reintentos: 2 });
            const r = await api.archivo('f');
            t.eq(r.ok, true);
            t.eq(veces, 2);
        } finally { await s.cerrar(); }
    });

    t.test('los errores llegan escritos y con su número', async () => {
        for (const [estado, trozo] of [[401, 'venció'], [403, 'permiso'], [404, 'ya no está']]) {
            const s = await servidor((req, res) => json(res, { errors: [{ detail: 'lo que sea' }] }, estado));
            try {
                const api = frameio.cliente({ token: 'x', cuenta: 'c', _base: s.base, reintentos: 0 });
                let e = null;
                try { await api.archivo('f'); } catch (err) { e = err; }
                t.ok(e, `el ${estado} lanza`);
                t.eq(e.estado, estado, 'con el número, que el llamador usa para decidir');
                t.tiene(e.message, trozo);
            } finally { await s.cerrar(); }
        }
    });

    t.grupo('Frame.io: subir un render por partes');

    t.test('manda cada parte con su firma y espera a que Frame.io lo reciba', async () => {
        const dir = temporal.carpeta('fio-subir');
        const ruta = path.join(dir, 'clase.mp4');
        const contenido = Buffer.alloc(300, 7);
        fs.writeFileSync(ruta, contenido);

        const recibido = [];
        let consultas = 0;
        const s = await servidor((req, res, cuerpo) => {
            if (req.url.endsWith('/files/local_upload')) {
                const pedido = JSON.parse(cuerpo).data;
                t.eq(pedido.file_size, 300, 'se declara el tamaño de verdad');
                t.eq(pedido.media_type, 'video/mp4');
                json(res, {
                    data: {
                        id: 'nuevo',
                        media_type: 'video/mp4',
                        view_url: 'https://next.frame.io/x',
                        upload_urls: [
                            { size: 100, url: `${s.base}/parte/1` },
                            { size: 100, url: `${s.base}/parte/2` },
                            { size: 100, url: `${s.base}/parte/3` }
                        ]
                    }
                }, 201);
                return;
            }
            if (req.url.startsWith('/parte/')) {
                recibido.push({ url: req.url, bytes: Buffer.byteLength(cuerpo), tipo: req.headers['content-type'], acl: req.headers['x-amz-acl'] });
                res.writeHead(200).end();
                return;
            }
            if (req.url.endsWith('/status')) {
                consultas++;
                // La primera vez todavía no terminó: así se prueba que espera.
                json(res, { data: { status: consultas < 2 ? 'created' : 'uploaded' } });
                return;
            }
            res.writeHead(404).end();
        });

        try {
            const api = frameio.cliente({ token: 'x', cuenta: 'c', _base: s.base });
            const avances = [];
            const r = await subida.subir(api, 'carpeta', ruta, { alAvanzar: a => avances.push(a.pct) });
            t.eq(r.ok, true, r.error);
            t.eq(r.archivo.id, 'nuevo');
            t.eq(recibido.length, 3, 'una llamada por parte');
            t.deep(recibido.map(p => p.bytes), [100, 100, 100], 'cada una con sus bytes');
            // Los tres van dentro de la firma de S3: cambiar uno la invalida y
            // la subida falla con un 403 que no explica nada.
            t.ok(recibido.every(p => p.tipo === 'video/mp4'), 'el Content-Type es el declarado');
            t.ok(recibido.every(p => p.acl === 'private'), 'y el x-amz-acl va en todas');
            t.eq(avances[avances.length - 1], 100);
            t.ok(consultas >= 2, 'se espera a que Frame.io lo dé por recibido');
        } finally { await s.cerrar(); }
    });

    t.test('una parte que falla se reintenta, y lo que no se puede se dice', async () => {
        const dir = temporal.carpeta('fio-reintento');
        const ruta = path.join(dir, 'clase.mp4');
        fs.writeFileSync(ruta, Buffer.alloc(50, 1));
        let intentos = 0;
        const s = await servidor((req, res) => {
            if (req.url.endsWith('/files/local_upload')) {
                json(res, { data: { id: 'n', media_type: 'video/mp4', upload_urls: [{ size: 50, url: `${s.base}/p` }] } }, 201);
                return;
            }
            if (req.url === '/p') {
                intentos++;
                // Falla una vez y después anda: es el Wi-Fi que parpadea.
                res.writeHead(intentos === 1 ? 500 : 200).end();
                return;
            }
            json(res, { data: { status: 'uploaded' } });
        });
        try {
            const api = frameio.cliente({ token: 'x', cuenta: 'c', _base: s.base });
            const r = await subida.subir(api, 'carpeta', ruta);
            t.eq(r.ok, true, r.error);
            t.eq(intentos, 2, 'se reintentó la parte, no la subida entera');
        } finally { await s.cerrar(); }
    });

    t.test('el tipo sale de la extensión, porque Frame.io lo exige al reservar', () => {
        t.eq(subida.tipoDe('/x/a.mp4'), 'video/mp4');
        t.eq(subida.tipoDe('/x/a.MOV'), 'video/quicktime');
        t.eq(subida.tipoDe('/x/a.raro'), 'application/octet-stream');
    });

    t.test('las partes se cortan por los tamaños que mandó Frame.io, no a ojo', () => {
        // Dividir el archivo en partes iguales deja la última corta y el
        // archivo llega roto, pero «subido».
        const tramos = subida.tramos([{ size: 70, url: 'a' }, { size: 30, url: 'b' }], 100);
        t.deep(tramos.map(x => [x.desde, x.hasta]), [[0, 69], [70, 99]]);
        t.eq(tramos.reduce((n, x) => n + x.bytes, 0), 100, 'sin dejar bytes afuera');
    });

    t.grupo('Frame.io: el versionado');

    t.test('la v1 va suelta, la v2 arma la pila y la v3 se mueve adentro', () => {
        const curso = temporal.carpeta('fio-versionado');
        vinculo.vincular(curso, { cuenta: 'c', carpeta: 'car', carpetaNombre: 'Entregas' });
        const clase = { versiones: [version('a_v1.mp4', 1), version('a_v2.mp4', 2), version('a_v3.mp4', 3)] };

        // Nada subido: la primera va suelta a la carpeta.
        t.deep(vinculo.plan(vinculo.leer(curso), clase, clase.versiones[0]).apilar, { tipo: 'suelto' });

        vinculo.anotarRender(curso, 'a_v1.mp4', { fileId: 'F1' });
        const dos = vinculo.plan(vinculo.leer(curso), clase, clase.versiones[1]);
        t.eq(dos.apilar.tipo, 'crear');
        t.deep(dos.apilar.fileIds, ['F1'], 'la pila se arma con la que ya estaba, del más viejo al más nuevo');

        vinculo.anotarRender(curso, 'a_v1.mp4', { pilaId: 'P' });
        vinculo.anotarRender(curso, 'a_v2.mp4', { fileId: 'F2', pilaId: 'P' });
        t.deep(vinculo.plan(vinculo.leer(curso), clase, clase.versiones[2]).apilar, { tipo: 'mover', pilaId: 'P' });
    });

    t.test('lo que ya está arriba no se vuelve a subir', () => {
        const curso = temporal.carpeta('fio-no-repite');
        vinculo.vincular(curso, { cuenta: 'c', carpeta: 'car' });
        vinculo.anotarRender(curso, 'a_v1.mp4', { fileId: 'F1' });
        const clase = { versiones: [version('a_v1.mp4', 1)] };
        t.eq(vinculo.plan(vinculo.leer(curso), clase, clase.versiones[0]).subir, false);
        t.deep(vinculo.faltan(vinculo.leer(curso), [clase]), []);
    });

    t.test('si quedaron dos sueltas, la pila las junta a las tres', () => {
        // Pasa cuando el armado de la pila falló una vez: el desorden no tiene
        // que crecer, la entrega siguiente lo arregla.
        const curso = temporal.carpeta('fio-dos-sueltas');
        vinculo.vincular(curso, { cuenta: 'c', carpeta: 'car' });
        vinculo.anotarRender(curso, 'a_v1.mp4', { fileId: 'F1' });
        vinculo.anotarRender(curso, 'a_v2.mp4', { fileId: 'F2' });
        const clase = { versiones: [version('a_v1.mp4', 1), version('a_v2.mp4', 2), version('a_v3.mp4', 3)] };
        const plan = vinculo.plan(vinculo.leer(curso), clase, clase.versiones[2]);
        t.deep(plan.apilar.fileIds, ['F1', 'F2']);
    });

    t.test('las ediciones y las archivadas no se suben', () => {
        // Una edición es un `edit.json` con proxies al lado, no un video. Y una
        // archivada que nunca se subió quedaría arriba de la pila, como si
        // fuera lo último entregado.
        const curso = temporal.carpeta('fio-no-suben');
        vinculo.vincular(curso, { cuenta: 'c', carpeta: 'car' });
        const clase = {
            versiones: [
                version('a_v1.mp4', 1, { archivada: true }),
                version('a_v2.mp4', 2, { edicion: true }),
                version('a_v3.mp4', 3)
            ]
        };
        t.deep(vinculo.faltan(vinculo.leer(curso), [clase]).map(x => x.version.archivo), ['a_v3.mp4']);
    });

    t.test('el vínculo se guarda por nombre, así sobrevive a archivar', () => {
        // Archivar la v2 en `Pre versions/` le cambia la ruta y no el nombre, y
        // sus comentarios tienen que seguir llegando a la v2.
        const curso = temporal.carpeta('fio-archivar');
        vinculo.vincular(curso, { cuenta: 'c', carpeta: 'car' });
        vinculo.anotarRender(curso, 'a_v2.mp4', { fileId: 'F2' });
        const enRaiz = version('a_v2.mp4', 2);
        const archivada = version('a_v2.mp4', 2, { ruta: '/cursos/Pre versions/a_v2.mp4', archivada: true });
        t.eq(vinculo.deVersion(vinculo.leer(curso), enRaiz).fileId, 'F2');
        t.eq(vinculo.deVersion(vinculo.leer(curso), archivada).fileId, 'F2', 'y archivada, igual');
    });

    t.test('cambiar de carpeta tira los vínculos, porque allá no están esos archivos', () => {
        const curso = temporal.carpeta('fio-cambia-carpeta');
        vinculo.vincular(curso, { cuenta: 'c', carpeta: 'uno' });
        vinculo.anotarRender(curso, 'a_v1.mp4', { fileId: 'F1' });
        t.eq(Object.keys(vinculo.vincular(curso, { cuenta: 'c', carpeta: 'uno' }).renders).length, 1, 'la misma carpeta los conserva');
        t.eq(Object.keys(vinculo.vincular(curso, { cuenta: 'c', carpeta: 'dos' }).renders).length, 0);
    });

    t.test('emparejar es por nombre exacto, y lo que no coincide se dice', () => {
        // Emparejar por parecido es cómo un comentario de la v2 termina en la
        // v3: lo que no es idéntico lo decide una persona.
        const curso = temporal.carpeta('fio-emparejar');
        vinculo.vincular(curso, { cuenta: 'c', carpeta: 'car' });
        const clases = [{ nombre: 'A', versiones: [version('a_v1.mp4', 1), version('a_v2.mp4', 2)] }];
        const r = vinculo.emparejar(vinculo.leer(curso), clases, [
            { id: 'F1', nombre: 'a_v1.mp4' },
            { id: 'OTRO', nombre: 'a v2.mp4' },
            { id: 'AJENO', nombre: 'de-otra-cosa.mp4' }
        ]);
        t.deep(r.emparejados.map(e => e.fileId), ['F1']);
        t.deep(r.sinEmparejar.map(x => x.archivo), ['a_v2.mp4'], 'el que no coincide exacto queda a mano');
        t.deep(r.huerfanos.map(x => x.id), ['OTRO', 'AJENO'], 'y lo que está allá y no acá también');
    });

    t.grupo('Frame.io: un comentario de allá, dicho de acá');

    const crudo = (extra = {}) => ({
        id: 'FC1', file_id: 'F1', text: 'Bajale la música', created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z', owner: { name: 'Ana' }, timestamp: 2500, ...extra
    });

    t.test('el instante llega en cuadros y se convierte con los fps del render', () => {
        // Con 30 de fábrica, el cuadro 2500 de una clase a 29.97 cae segundo y
        // medio más adelante, y nadie lo nota hasta que el corte queda mal.
        t.cerca(convertir.comentario(crudo(), { fps: 29.97 }).t, 2500 / 29.97, 0.0001);
        t.cerca(convertir.comentario(crudo(), { fps: 30 }).t, 2500 / 30, 0.0001);
    });

    t.test('la duración es el largo del tramo, no su final', () => {
        const c = convertir.comentario(crudo({ duration: 60 }), { fps: 30 });
        t.cerca(c.t, 2500 / 30, 0.0001);
        t.cerca(c.tHasta, 2560 / 30, 0.0001, 'instante más largo');
        t.eq(convertir.comentario(crudo(), { fps: 30 }).tHasta, null, 'sin duración es un instante');
    });

    t.test('completado allá es resuelto acá', () => {
        t.eq(convertir.comentario(crudo(), {}).estado, 'abierto');
        t.eq(convertir.comentario(crudo({ completed_at: '2026-02-02T00:00:00Z' }), {}).estado, 'resuelto');
    });

    t.test('las respuestas van adentro del texto, con quién las escribió', () => {
        // Un hilo partido en cinco comentarios sueltos no se entiende; junto, sí.
        const c = convertir.comentario(crudo({
            replies: [{ text: 'desde el minuto 2', owner: { name: 'Beto' } }, { text: 'ok', owner: { email: 'c@x.com' } }]
        }), {});
        t.tiene(c.texto, 'Bajale la música');
        t.tiene(c.texto, '↳ Beto: desde el minuto 2');
        t.tiene(c.texto, '↳ c@x.com: ok', 'sin nombre, el correo');
        t.eq(c.origen.frameio.respuestas, 2);
    });

    t.test('una caja de Frame.io es una caja de Reviewer, en las mismas coordenadas', () => {
        const c = convertir.comentario(crudo({
            annotation: JSON.stringify([{ tool: 'rect', color: '#F22237', x: 0.1, y: 0.2, w: 0.3, h: 0.4 }])
        }), {});
        t.eq(c.trazos.length, 1);
        t.eq(c.trazos[0].lapiz, 'caja');
        t.eq(c.trazos[0].color, '#F22237');
        t.deep(c.trazos[0].puntos.map(p => [p.x, p.y]), [[0.1, 0.2], [0.4, 0.6000000000000001]]);
    });

    t.test('un trazo a mano alzada entra como trazo libre, venga como venga', () => {
        // La web de Frame.io los manda en `points`, `path` o `vertices`, y cada
        // punto como par o como objeto. Adivinar mal deja el dibujo vacío, y un
        // dibujo vacío se ve igual que no tener ninguno.
        const comoPares = convertir.comentario(crudo({
            annotation: JSON.stringify([{ tool: 'pen', points: [[0.1, 0.1], [0.5, 0.5]] }])
        }), {});
        t.eq(comoPares.trazos[0].lapiz, 'libre');
        t.eq(comoPares.trazos[0].puntos.length, 2);
        const comoObjetos = convertir.comentario(crudo({
            annotation: JSON.stringify([{ tool: 'path', path: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.3 }] }])
        }), {});
        t.eq(comoObjetos.trazos[0].puntos.length, 2);
    });

    t.test('un dibujo que no se entiende no se tira: queda crudo', () => {
        // El día que Frame.io agregue una herramienta, el comentario va a
        // seguir diciendo que tiene un dibujo, en vez de mostrarse vacío.
        const c = convertir.comentario(crudo({ annotation: JSON.stringify([{ tool: 'inventada', raro: 1 }]) }), {});
        t.eq(c.trazos, null);
        t.ok(c.origen.frameio.annotation, 'se guarda tal cual vino');
        const roto = convertir.comentario(crudo({ annotation: 'esto no es json' }), {});
        t.eq(roto.trazos, null);
        t.ok(roto.origen.frameio.annotation);
    });

    t.grupo('Frame.io: meter esos comentarios en una versión');

    /** Una versión en el disco, con su carpeta lista para comentarios. */
    function enDisco(nombre) {
        const dir = temporal.carpeta(nombre);
        const ruta = path.join(dir, 'Clase 01.mp4');
        fs.writeFileSync(ruta, 'x');
        return ruta;
    }

    t.test('traer dos veces lo mismo no duplica nada', () => {
        // Esto corre cada dos minutos: si no fuera idempotente, una tarde de
        // trabajo deja trescientas copias del mismo comentario.
        const ruta = enDisco('fio-fusion');
        const entrantes = convertir.comentarios([crudo()], { fps: 30, fileId: 'F1' });
        const uno = comentariosLib.fusionarDeFrameio(ruta, 'F1', entrantes, {});
        t.eq(uno.agregados, 1);
        t.eq(uno.datos.comentarios.length, 1);
        t.eq(uno.datos.comentarios[0].id, 'c01', 'con un id de Reviewer, que es el que viaja al feedback');

        const dos = comentariosLib.fusionarDeFrameio(ruta, 'F1', entrantes, {});
        t.eq(dos.agregados, 0);
        t.eq(dos.actualizados, 0);
        t.eq(dos.datos.comentarios.length, 1);
    });

    t.test('si allá cambió, gana Frame.io', () => {
        const ruta = enDisco('fio-cambia');
        comentariosLib.fusionarDeFrameio(ruta, 'F1', convertir.comentarios([crudo()], { fps: 30, fileId: 'F1' }), {});
        const r = comentariosLib.fusionarDeFrameio(ruta, 'F1', convertir.comentarios([
            crudo({ text: 'Mejor subila', updated_at: '2026-03-03T00:00:00Z' })
        ], { fps: 30, fileId: 'F1' }), {});
        t.eq(r.actualizados, 1);
        t.eq(r.datos.comentarios[0].texto, 'Mejor subila');
        t.eq(r.datos.comentarios[0].id, 'c01', 'y sigue siendo el mismo comentario');
    });

    t.test('si allá no cambió, lo de acá se queda: resolver no se deshace solo', () => {
        // Es la regla que hace que resolver en Reviewer sobreviva a la vuelta
        // siguiente. Sin ella, cada dos minutos se reabría lo que se acababa de
        // cerrar, hasta que el empuje llegara a Frame.io.
        const ruta = enDisco('fio-resuelto');
        const entrantes = convertir.comentarios([crudo()], { fps: 30, fileId: 'F1' });
        comentariosLib.fusionarDeFrameio(ruta, 'F1', entrantes, {});
        comentariosLib.editar(ruta, 'c01', { estado: 'resuelto' }, {});
        const r = comentariosLib.fusionarDeFrameio(ruta, 'F1', entrantes, {});
        t.eq(r.datos.comentarios[0].estado, 'resuelto');
        t.deep(comentariosLib.paraCompletarEnFrameio(r.datos), [{ id: 'FC1', hecho: true }], 'y queda para mandarle la casilla');
    });

    t.test('lo que se borró allá se borra acá', () => {
        const ruta = enDisco('fio-borrado');
        comentariosLib.fusionarDeFrameio(ruta, 'F1', convertir.comentarios([crudo()], { fps: 30, fileId: 'F1' }), {});
        const r = comentariosLib.fusionarDeFrameio(ruta, 'F1', [], {});
        t.eq(r.borrados, 1);
        t.eq(r.datos.comentarios.length, 0);
    });

    t.test('los comentarios del editor no los toca nadie', () => {
        const ruta = enDisco('fio-mios');
        comentariosLib.agregar(ruta, { t: 1, texto: 'Esto lo escribí yo' }, {});
        const r = comentariosLib.fusionarDeFrameio(ruta, 'F1', convertir.comentarios([crudo()], { fps: 30, fileId: 'F1' }), {});
        t.eq(r.datos.comentarios.length, 2);
        t.eq(r.datos.comentarios.filter(c => !c.origen).length, 1, 'el propio sigue ahí');
        // Y una vuelta sin novedades tampoco se lo lleva por delante.
        const vacia = comentariosLib.fusionarDeFrameio(ruta, 'F1', [], {});
        t.eq(vacia.datos.comentarios.length, 1);
        t.eq(vacia.datos.comentarios[0].texto, 'Esto lo escribí yo');
    });

    t.test('un dibujo hecho acá le gana al de allá', () => {
        // Al importar, los trazos son de Frame.io y no hay PNG. Si el editor
        // dibuja encima queda un `dibujo` compuesto: a partir de ahí los trazos
        // son suyos, y alguien que edita el texto allá no se los borra.
        const ruta = enDisco('fio-dibujo');
        const conDibujo = JSON.stringify([{ tool: 'rect', x: 0, y: 0, w: 0.1, h: 0.1 }]);
        comentariosLib.fusionarDeFrameio(ruta, 'F1', convertir.comentarios([crudo({ annotation: conDibujo })], { fps: 30, fileId: 'F1' }), {});
        comentariosLib.editar(ruta, 'c01', { dibujo: 'dibujos/c01.png', trazos: [{ lapiz: 'flecha', color: '#fff', puntos: [] }] }, {});
        const r = comentariosLib.fusionarDeFrameio(ruta, 'F1', convertir.comentarios([
            crudo({ text: 'otra cosa', updated_at: '2026-04-04T00:00:00Z', annotation: conDibujo })
        ], { fps: 30, fileId: 'F1' }), {});
        t.eq(r.datos.comentarios[0].texto, 'otra cosa', 'el texto sí se actualiza');
        t.eq(r.datos.comentarios[0].trazos[0].lapiz, 'flecha', 'y el dibujo del editor se queda');
    });

    t.test('una lectura de otro archivo no borra lo de este', () => {
        // Puede haber comentarios de dos archivos si se cambió el vínculo, y
        // una lectura parcial no puede llevarse lo que no fue a buscar.
        const ruta = enDisco('fio-dos-archivos');
        comentariosLib.fusionarDeFrameio(ruta, 'F1', convertir.comentarios([crudo()], { fps: 30, fileId: 'F1' }), {});
        const r = comentariosLib.fusionarDeFrameio(ruta, 'F2', [], {});
        t.eq(r.borrados, 0);
        t.eq(r.datos.comentarios.length, 1);
    });

    t.test('el feedback dice de quién es el comentario', () => {
        const ruta = enDisco('fio-feedback');
        comentariosLib.fusionarDeFrameio(ruta, 'F1', convertir.comentarios([crudo()], { fps: 30, fileId: 'F1' }), {});
        const md = fs.readFileSync(path.join(path.dirname(ruta), 'Clase 01', 'feedback.md'), 'utf8');
        t.tiene(md, 'lo pidió Ana, en Frame.io');
    });

    t.grupo('Frame.io: entrar con la cuenta de Adobe');

    t.test('el PKCE es un verificador al azar y su hash, nunca el mismo', () => {
        // Es lo que reemplaza al secreto de cliente, que una app de escritorio
        // no puede guardar. Si el verificador se repitiera, el código
        // interceptado de una sesión serviría en la siguiente.
        const uno = auth.pkce();
        const dos = auth.pkce();
        t.ok(uno.verificador.length >= 43, 'el verificador tiene el largo que pide la RFC');
        t.ok(uno.verificador !== dos.verificador, 'y no se repite');
        t.ok(uno.estado !== dos.estado, 'el state tampoco');
        t.eq(
            uno.desafio,
            crypto.createHash('sha256').update(uno.verificador).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
            'el desafío es el SHA-256 del verificador en base64url'
        );
        t.ok(!/[+/=]/.test(uno.desafio), 'sin caracteres que haya que escapar en una URL');
    });

    t.test('la URL de Adobe lleva el método S256 y el permiso del refresco', () => {
        const u = new URL(auth.urlDeAutorizacion({ clientId: 'ID', desafio: 'D', estado: 'E' }));
        t.eq(u.searchParams.get('client_id'), 'ID');
        t.eq(u.searchParams.get('code_challenge_method'), 'S256', 'S256 y no plain, que no protege nada');
        t.eq(u.searchParams.get('response_type'), 'code');
        t.eq(u.searchParams.get('state'), 'E');
        t.eq(u.searchParams.get('redirect_uri'), auth.REDIRECT);
        // Sin `offline_access` no hay token de refresco y hay que volver a
        // iniciar sesión cada hora.
        t.tiene(u.searchParams.get('scope'), 'offline_access');
    });

    t.test('el regreso entra por 127.0.0.1 y comprueba el state', async () => {
        const { estado } = auth.pkce();
        const r = await auth.abrirRetorno(estado, { puerto: 43190, plazoMs: 5000 });
        try {
            await fetch(`http://127.0.0.1:43190/callback?code=ABC&state=${estado}`);
            t.eq(await r.codigo, 'ABC');
        } finally { r.cerrar(); }
    });

    t.test('una vuelta con otro state se rechaza, que es para lo que está', async () => {
        // Sin esta comprobación, alguien podría hacer que la app canjee un
        // código que no pidió.
        const r = await auth.abrirRetorno('el-mio', { puerto: 43191, plazoMs: 5000 });
        try {
            await fetch('http://127.0.0.1:43191/callback?code=ABC&state=otro');
            let e = null;
            try { await r.codigo; } catch (err) { e = err; }
            t.ok(e, 'lanza');
            t.tiene(e.message, 'no corresponde');
        } finally { r.cerrar(); }
    });

    t.test('el puerto ocupado se dice, en vez de mudarse a otro', async () => {
        // Mudarse rompería el `redirect_uri`, que Adobe compara carácter por
        // carácter contra el registrado, y la persona terminaría en otro lado
        // sin que nada lo explique.
        const tapon = http.createServer();
        await new Promise(listo => tapon.listen(43192, '127.0.0.1', listo));
        try {
            let e = null;
            try { await auth.abrirRetorno('x', { puerto: 43192 }); } catch (err) { e = err; }
            t.ok(e);
            t.tiene(e.message, 'ocupado');
        } finally { tapon.close(); }
    });

    t.test('el código se canjea mandando el verificador', async () => {
        const s = await servidor((req, res) => json(res, { access_token: 'AT', refresh_token: 'RT', expires_in: 3600 }));
        try {
            const tokens = await auth.canjear({ clientId: 'ID', codigo: 'C', verificador: 'V', ims: s.base });
            t.eq(tokens.acceso, 'AT');
            t.eq(tokens.refresco, 'RT');
            t.ok(tokens.vence > Date.now(), 'con el vencimiento ya resuelto');
            const campos = new URLSearchParams(s.pedidos[0].cuerpo);
            t.eq(campos.get('grant_type'), 'authorization_code');
            t.eq(campos.get('code_verifier'), 'V', 'el verificador, que es lo que prueba que el pedido es nuestro');
            t.ok(!campos.get('client_secret'), 'y ningún secreto, porque no hay');
        } finally { await s.cerrar(); }
    });

    t.test('al refrescar se conserva el de refresco si Adobe no manda otro', async () => {
        // Adobe no siempre devuelve uno nuevo. Tirarlo obligaría a volver a
        // iniciar sesión dentro de una hora.
        const s = await servidor((req, res) => json(res, { access_token: 'AT2', expires_in: 3600 }));
        try {
            const t2 = await auth.refrescar({ clientId: 'ID', refresco: 'RT', previos: { refresco: 'RT', quien: 'Ana' }, ims: s.base });
            t.eq(t2.acceso, 'AT2');
            t.eq(t2.refresco, 'RT');
            t.eq(t2.quien, 'Ana', 'y de quién es la sesión');
        } finally { await s.cerrar(); }
    });

    t.test('un error de Adobe llega con su explicación, no como «falló»', async () => {
        const s = await servidor((req, res) => json(res, { error: 'invalid_grant', error_description: 'el código ya se usó' }, 400));
        try {
            let e = null;
            try { await auth.canjear({ clientId: 'ID', codigo: 'C', verificador: 'V', ims: s.base }); } catch (err) { e = err; }
            t.ok(e);
            t.tiene(e.message, 'el código ya se usó');
        } finally { await s.cerrar(); }
    });
};
