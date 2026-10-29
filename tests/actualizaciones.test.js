'use strict';
/**
 * Si hay una versión nueva.
 *
 * Lo que de verdad se prueba acá es la comparación de versiones, porque es
 * donde el error se esconde mejor: comparadas como texto, "1.0.10" va ANTES que
 * "1.0.9", y el síntoma no es una excepción sino una app que nunca más avisa de
 * nada. Eso no se ve mirando el código y no se ve usando la app; solo se ve
 * cuando el patch pasa de 9 a 10, meses después.
 *
 * El resto va contra un servidor local en 127.0.0.1 —no sale a internet, que es
 * lo que la suite promete— para recorrer el camino de verdad: cabeceras,
 * códigos de error, el repo sin releases, el release sin `.pkg`. Un `fetch`
 * sustituido a mano probaría el sustituto.
 */

const http = require('http');

const actualizaciones = require('../engine/actualizaciones');

/**
 * Un GitHub de juguete que contesta lo que se le diga.
 *
 * `0` como puerto deja que el sistema elija uno libre: un puerto fijo choca con
 * cualquier cosa que esté escuchando en esta Mac y el test falla por algo que no
 * tiene nada que ver con las actualizaciones.
 */
function servidor(responder) {
    return new Promise(listo => {
        const s = http.createServer(responder);
        s.listen(0, '127.0.0.1', () => listo({
            base: `http://127.0.0.1:${s.address().port}`,
            cerrar: () => new Promise(f => s.close(f))
        }));
    });
}

const release = extra => JSON.stringify({
    tag_name: 'v0.2.0',
    html_url: 'https://github.com/DanielGutierrezB/Reviewer/releases/tag/v0.2.0',
    body: 'Ahora el reproductor va a cuadro.',
    assets: [{ name: 'Reviewer-0.2.0-arm64-update.pkg', size: 136314880 }],
    ...extra
});

module.exports = async function (t) {
    const { comparar, instalador, buscar } = actualizaciones;

    t.grupo('Actualizaciones: comparar versiones');

    t.test('10 es mayor que 9 y no al revés', () => {
        // El test que justifica que esto no sea `a > b` sobre dos strings.
        t.ok(comparar('1.0.10', '1.0.9') > 0, '1.0.10 es posterior a 1.0.9');
        t.ok(comparar('1.0.9', '1.0.10') < 0, 'y 1.0.9 anterior a 1.0.10');
        t.ok(comparar('0.1.20', '0.1.3') > 0);
        t.ok(comparar('1.10.0', '1.9.0') > 0);
    });

    t.test('la misma versión es 0', () => {
        t.eq(comparar('0.1.0', '0.1.0'), 0);
        // El tag en GitHub lleva `v` y `version.json` no: si la `v` no se saca,
        // la app se compara contra sí misma y se ofrece para siempre.
        t.eq(comparar('v0.1.0', '0.1.0'), 0, 'la v del tag no cuenta');
        t.eq(comparar(' 0.1.0 ', '0.1.0'), 0, 'ni los espacios');
    });

    t.test('cada número pesa más que el de su derecha', () => {
        t.ok(comparar('1.0.0', '0.99.99') > 0, 'el major manda');
        t.ok(comparar('0.2.0', '0.1.99') > 0, 'después el minor');
    });

    t.test('una versión con menos partes se completa con ceros', () => {
        t.eq(comparar('1.0', '1.0.0'), 0);
        t.ok(comparar('1.0.1', '1.0') > 0);
    });

    t.test('el sufijo de una prerelease no participa', () => {
        // Acá solo se decide si hay algo más nuevo. Ordenar betas entre sí sería
        // otra función y nadie la necesita.
        t.eq(comparar('0.2.0-beta.1', '0.2.0'), 0);
    });

    t.test('nada y basura valen 0.0.0 y no explotan', () => {
        // Un `tag_name` vacío o raro llega desde la red: si esto lanzara, la
        // excepción saldría en el arranque de la app.
        t.eq(comparar(null, '0.0.0'), 0);
        t.eq(comparar('', undefined), 0);
        t.ok(comparar('0.0.1', 'main') > 0);
    });

    t.grupo('Actualizaciones: elegir el instalador');

    t.test('se prefiere el de actualización sobre el completo', () => {
        // El completo arrastra el modelo de Whisper otra vez: 600 MB contra 130
        // para cambiar código que ya está instalado.
        const elegido = instalador({ assets: [
            { name: 'Reviewer-0.2.0-arm64.pkg', size: 600 },
            { name: 'Reviewer-0.2.0-arm64-update.pkg', size: 130 }
        ] });
        t.eq(elegido.name, 'Reviewer-0.2.0-arm64-update.pkg');
    });

    t.test('con solo el completo, sirve el completo', () => {
        t.eq(instalador({ assets: [{ name: 'Reviewer-0.2.0-arm64.pkg' }] }).name, 'Reviewer-0.2.0-arm64.pkg');
    });

    t.test('sin assets no hay instalador y no hay excepción', () => {
        t.eq(instalador({ assets: [] }), null);
        t.eq(instalador(null), null);
    });

    t.grupo('Actualizaciones: preguntarle al repo');

    t.test('una versión posterior se reporta con sus notas y su página', async () => {
        const s = await servidor((req, res) => {
            t.tiene(req.url, '/repos/quien/que/releases/latest', 'pega en el endpoint de GitHub');
            t.ok(req.headers['user-agent'], 'con User-Agent, que GitHub exige');
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(release());
        });
        try {
            const r = await buscar({ versionActual: '0.1.0', owner: 'quien', repo: 'que', _base: s.base });
            t.eq(r.hay, true);
            t.eq(r.version, '0.2.0', 'sin la v del tag');
            t.tiene(r.notas, 'a cuadro', 'las notas viajan para mostrarlas antes de bajar');
            t.tiene(r.pagina, '/releases/tag/v0.2.0');
            t.eq(r.sinInstalador, false);
        } finally { await s.cerrar(); }
    });

    t.test('la misma versión publicada no es una actualización', async () => {
        const s = await servidor((req, res) => { res.end(release()); });
        try {
            const r = await buscar({ versionActual: '0.2.0', _base: s.base });
            t.eq(r.hay, false);
            t.tiene(r.motivo, 'última versión');
        } finally { await s.cerrar(); }
    });

    t.test('la local más nueva que la publicada tampoco', async () => {
        // Pasa todo el tiempo mientras se desarrolla: `subir-version.js` ya
        // movió el número y el release todavía no salió. No es un error y no se
        // puede decir distinto de estar al día.
        const s = await servidor((req, res) => { res.end(release()); });
        try {
            const r = await buscar({ versionActual: '0.3.1', _base: s.base });
            t.eq(r.hay, false);
            t.eq(r.version, '0.2.0', 'igual dice cuál es la última publicada');
        } finally { await s.cerrar(); }
    });

    t.test('un repo sin releases no es una avería', async () => {
        // `/releases/latest` contesta 404 cuando no hay ninguno. Mostrarlo como
        // error deja el botón diciendo que algo se rompió el primer día.
        const s = await servidor((req, res) => { res.writeHead(404); res.end('{}'); });
        try {
            const r = await buscar({ versionActual: '0.1.0', _base: s.base });
            t.eq(r.hay, false);
            t.tiene(r.motivo, 'Todavía no hay');
        } finally { await s.cerrar(); }
    });

    t.test('un error del servidor se devuelve escrito, no lanzado', async () => {
        // Esto se llama solo al arrancar: una promesa rechazada que nadie
        // atrapa deja la app abierta y una línea en el diario que no explica
        // nada. El motivo tiene que poder mostrarse tal cual.
        const s = await servidor((req, res) => { res.writeHead(503); res.end('{}'); });
        try {
            const r = await buscar({ versionActual: '0.1.0', _base: s.base });
            t.eq(r.hay, false);
            t.tiene(r.motivo, '503');
        } finally { await s.cerrar(); }
    });

    t.test('sin internet la app no se entera: contesta que no hay nada', async () => {
        // El caso de verdad del arranque. 127.0.0.1 en un puerto cerrado da
        // ECONNREFUSED, que es el mismo camino que un ENOTFOUND sin DNS.
        const r = await buscar({ versionActual: '0.1.0', _base: 'http://127.0.0.1:1', timeoutMs: 500 });
        t.eq(r.hay, false);
        t.ok(r.motivo, 'con un motivo escrito');
    });

    t.test('un servidor que no contesta corta por tiempo', async () => {
        // Sin tope, el pedido queda abierto el resto de la sesión. El plazo se
        // mide entero y no por socket quieto: un byte cada tanto no dispara el
        // `timeout` del pedido.
        const s = await servidor(() => { /* nunca contesta */ });
        try {
            const empezo = Date.now();
            const r = await buscar({ versionActual: '0.1.0', _base: s.base, timeoutMs: 300 });
            t.eq(r.hay, false);
            t.ok(Date.now() - empezo < 3000, 'y corta cuando dijo');
        } finally { await s.cerrar(); }
    });

    t.test('una respuesta que no es JSON no rompe nada', async () => {
        const s = await servidor((req, res) => { res.end('<html>Service Unavailable</html>'); });
        try {
            const r = await buscar({ versionActual: '0.1.0', _base: s.base });
            t.eq(r.hay, false);
            t.tiene(r.motivo, 'no se entiende');
        } finally { await s.cerrar(); }
    });

    t.test('un release sin .pkg avisa igual, pero lo dice', async () => {
        // El olvido clásico: crear el tag y no subir el instalador. Hay algo
        // nuevo y hay que contarlo; lo que no hay es qué bajar.
        const s = await servidor((req, res) => { res.end(release({ assets: [] })); });
        try {
            const r = await buscar({ versionActual: '0.1.0', _base: s.base });
            t.eq(r.hay, true);
            t.eq(r.sinInstalador, true);
        } finally { await s.cerrar(); }
    });

    t.test('un release sin tag no se trata como versión', async () => {
        const s = await servidor((req, res) => { res.end(JSON.stringify({ assets: [] })); });
        try {
            const r = await buscar({ versionActual: '0.1.0', _base: s.base });
            t.eq(r.hay, false);
            t.tiene(r.motivo, 'qué versión');
        } finally { await s.cerrar(); }
    });

    t.test('por defecto apunta al repo de Reviewer', () => {
        // Si esto se escribe mal, la app consulta un repo que no existe y
        // contesta 404 para siempre: «todavía no hay ninguna versión».
        t.eq(actualizaciones.DEFAULTS.owner, 'DanielGutierrezB');
        t.eq(actualizaciones.DEFAULTS.repo, 'Reviewer');
    });
};
