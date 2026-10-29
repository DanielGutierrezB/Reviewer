'use strict';
/**
 * Mejorar la redacción con la cuenta de Claude.
 *
 * Nada de acá sale a internet ni gasta del plan de nadie: lo que se prueba es
 * la lectura de lo que contesta el CLI —que es lógica pura— y, para el camino
 * completo, un `claude` de mentira escrito en Node que se pasa por
 * `REVIEWER_CLAUDE_BIN`. Tampoco hay ningún token acá adentro, ni de ejemplo:
 * este archivo está en el repo.
 */

const fs = require('fs');
const path = require('path');

const ajustes = require('../engine/ajustes');
const claude = require('../engine/claude');
const llm = require('../engine/llm');
const temporal = require('./lib/temporal');

/**
 * Un `claude` de mentira que escribe lo que se le diga y sale con el código que
 * se le diga. Es la única forma de probar `preguntar` entera —argumentos, hijo,
 * lectura de la respuesta— sin una cuenta y sin red.
 */
function cliFalso(nombre, salida, code) {
    const dir = temporal.carpeta(nombre);
    const bin = path.join(dir, 'claude');
    fs.writeFileSync(bin, [
        '#!/usr/bin/env node',
        // Los argumentos recibidos quedan al lado, para poder afirmar con qué
        // se lo llamó sin tener que parsear la salida del propio test.
        `require('fs').writeFileSync(${JSON.stringify(path.join(dir, 'args.json'))}, JSON.stringify(process.argv.slice(2)));`,
        `process.stdout.write(${JSON.stringify(salida)});`,
        `process.exit(${Number(code) || 0});`
    ].join('\n'));
    fs.chmodSync(bin, 0o755);
    return { bin, args: () => JSON.parse(fs.readFileSync(path.join(dir, 'args.json'), 'utf8')) };
}

/** Lo que de verdad contestó el CLI de esta máquina con la sesión vencida. */
const VENCIDA = JSON.stringify({
    type: 'result',
    subtype: 'success',
    is_error: true,
    api_error_status: 401,
    result: 'Failed to authenticate. API Error: 401 OAuth access token has expired. Re-authenticate to continue.'
});

module.exports = function (t) {
    t.grupo('Cuenta de Claude');

    // ── Lo que se guarda, y sobre todo lo que no ──────────────────────

    t.test('«claude» es un proveedor válido y no trae credenciales', () => {
        const a = ajustes.sanear({ llm: { proveedor: 'claude' } });
        t.eq(a.llm.proveedor, 'claude');
        // La garantía del diseño, escrita como test: el ajuste de este
        // transporte es UNA clave, el modelo. Si alguna vez aparece acá un
        // `apiKey`, un `token` o una `url`, es que se volvió a meter un secreto
        // en el archivo de preferencias y este test tiene que romper.
        t.deep(Object.keys(a.llm.claude), ['modelo']);
    });

    t.test('un ajustes.json con un token adentro no lo conserva', () => {
        // No es paranoia: el archivo se puede editar a mano, y alguien que
        // copie la configuración de otra herramienta podría pegar uno. Sanear
        // lo tira, así que no sobrevive a un guardado.
        const a = ajustes.sanear({
            llm: { proveedor: 'claude', claude: { modelo: 'haiku', apiKey: 'no-va', oauthToken: 'tampoco' } }
        });
        t.deep(Object.keys(a.llm.claude), ['modelo']);
    });

    t.test('de fábrica el modelo es el rápido', () => {
        // Es la razón que dio el usuario para querer esto: «uso Haiku … que
        // puede que responda más rápido».
        t.eq(ajustes.sanear(null).llm.claude.modelo, 'haiku');
        t.eq(claude.MODELO_POR_DEFECTO, 'haiku');
        t.eq(claude.MODELOS[0].id, 'haiku', 'y es el primero del desplegable');
    });

    t.test('un modelo inventado vuelve al rápido', () => {
        t.eq(ajustes.sanear({ llm: { claude: { modelo: 'gpt-5' } } }).llm.claude.modelo, 'haiku');
        t.eq(ajustes.sanear({ llm: { claude: { modelo: 'sonnet' } } }).llm.claude.modelo, 'sonnet', 'y uno real se respeta');
    });

    t.test('cambiar de transporte no pisa lo del otro', () => {
        const a = ajustes.sanear({
            llm: { proveedor: 'claude', ollama: { modelo: 'qwen3:8b' }, claude: { modelo: 'opus' } }
        });
        t.eq(a.llm.ollama.modelo, 'qwen3:8b');
        t.eq(a.llm.claude.modelo, 'opus');
    });

    t.test('el transporte activo sale aplanado sin clave', () => {
        const a = ajustes.sanear({ llm: { proveedor: 'claude', claude: { modelo: 'haiku' } } });
        const activo = ajustes.llmActivo(a);
        t.eq(activo.proveedor, 'claude');
        t.eq(activo.modelo, 'haiku');
        t.eq(activo.apiKey, '', 'no hay clave que mandar');
    });

    // ── La lista de modelos ───────────────────────────────────────────

    t.test('los modelos no se le preguntan a nadie', async () => {
        // Sin red, sin binario y sin sesión: son alias fijos que resuelve el
        // CLI. Que esto no pueda fallar es justamente lo que lo distingue de
        // los otros dos transportes.
        t.deep(await llm.modelos({ proveedor: 'claude' }), ['haiku', 'sonnet', 'opus']);
    });

    // ── Leer el estado de la sesión ───────────────────────────────────

    t.test('con sesión se dice quién está conectado', () => {
        const r = claude.leerEstado({
            code: 0,
            out: '{"loggedIn":true,"authMethod":"claude.ai","email":"alguien@ejemplo.com","subscriptionType":"team"}'
        });
        t.eq(r.estado, 'con-sesion');
        t.eq(r.cuenta, 'alguien@ejemplo.com');
        t.eq(r.plan, 'team');
    });

    t.test('sin sesión se dice que no hay', () => {
        t.eq(claude.leerEstado({ code: 0, out: '{"loggedIn":false,"authMethod":"none"}' }).estado, 'sin-sesion');
        t.eq(claude.leerEstado({ code: 0, out: '{"loggedIn":true,"authMethod":"none"}' }).estado, 'sin-sesion');
    });

    t.test('lo que no se entiende es «no se sabe», nunca «falta»', () => {
        // El error más caro de este módulo sería mandar a iniciar sesión a
        // alguien que ya la tiene: lo manda a arreglar algo que funciona. Por
        // eso un CLI viejo, uno que no contesta y uno que escribe cualquier
        // cosa caen todos en el estado neutro.
        t.eq(claude.leerEstado({ code: 1, err: 'unknown command: auth' }).estado, 'no-se-sabe');
        t.eq(claude.leerEstado({ code: 0, out: '', corto: true }).estado, 'no-se-sabe');
        t.eq(claude.leerEstado({ code: -1, err: 'ENOENT' }).estado, 'no-se-sabe');
        t.eq(claude.leerEstado({ code: 0, out: 'buenas' }).estado, 'no-se-sabe');
    });

    // ── Leer la respuesta de una consulta ─────────────────────────────

    t.test('un error con código de salida 0 NO pasa por respuesta', () => {
        // Medido en una Mac real: con la sesión vencida el CLI sale con código
        // 0 y el error adentro del JSON. Quien mire solo el código se lleva
        // «Failed to authenticate» y se lo guarda al editor adentro del
        // comentario, que es el peor final posible.
        const r = claude.leerRespuesta({ code: 0, out: VENCIDA, err: '' }, 'haiku');
        t.eq(r.ok, false);
        t.tiene(r.motivo, 'sesión de Claude no está activa');
        t.tiene(r.motivo, 'claude auth login', 'y dice cómo se arregla');
    });

    t.test('una respuesta buena devuelve el texto y nada más', () => {
        const r = claude.leerRespuesta({ code: 0, out: JSON.stringify({ is_error: false, result: 'Alargar el fade.' }) }, 'haiku');
        t.eq(r.ok, true);
        t.eq(r.texto, 'Alargar el fade.');
    });

    t.test('un CLI viejo sin JSON igual sirve', () => {
        // Negarle la función a quien no actualizó sería gratuito: lo que
        // escribió es una respuesta.
        const r = claude.leerRespuesta({ code: 0, out: 'Alargar el fade.' }, 'haiku');
        t.eq(r.ok, true);
        t.eq(r.texto, 'Alargar el fade.');
    });

    t.test('el timeout y el binario que no corre se dicen distinto', () => {
        t.tiene(claude.leerRespuesta({ corto: true, code: null, out: '' }, 'haiku').motivo, 'tardó demasiado');
        t.tiene(claude.leerRespuesta({ code: -1, out: '', err: 'ENOENT' }, 'haiku').motivo, 'No se pudo ejecutar');
    });

    // ── Cada falla con su nombre y su próximo paso ────────────────────

    t.test('las cuatro fallas se distinguen', () => {
        // Cuatro y no una bolsa de «algo falló» porque el arreglo de cada una
        // es distinto y el editor tiene que poder hacerlo sin preguntarnos.
        t.eq(claude.causaDe('401 OAuth access token has expired'), 'sesion');
        t.eq(claude.causaDe('Not logged in'), 'sesion');
        t.eq(claude.causaDe('429 rate limit exceeded'), 'cuota');
        t.eq(claude.causaDe('You have reached your usage limit'), 'cuota');
        t.eq(claude.causaDe('model not found: haiku-99'), 'modelo');
        t.eq(claude.causaDe('getaddrinfo ENOTFOUND api.anthropic.com'), 'red');
        t.eq(claude.causaDe('se cayó el techo'), '', 'lo que no se reconoce no se disfraza');
    });

    t.test('cada falla dice qué hacer', () => {
        const dice = salida => claude.leerRespuesta({ code: 1, out: '', err: salida }, 'haiku').motivo;
        t.tiene(dice('429 rate limit exceeded'), 'límite de uso');
        t.tiene(dice('429 rate limit exceeded'), 'Ollama', 'y ofrece seguir trabajando');
        t.tiene(dice('getaddrinfo ENOTFOUND api.anthropic.com'), 'internet');
        t.tiene(dice('model not found: pepe'), '«haiku»');
    });

    // ── Con qué se llama al CLI ───────────────────────────────────────

    t.test('la consulta va sin herramientas y sin --bare', () => {
        const args = claude.argumentos('refiná esto', 'sos un editor', 'haiku');
        t.eq(args[0], '-p');
        t.eq(args[1], 'refiná esto', 'el texto va como argumento, no por un shell');
        t.tiene(args.join(' '), '--model haiku');
        t.tiene(args.join(' '), '--tools');
        t.tiene(args.join(' '), '--append-system-prompt');
        // `--bare` apagaría la sesión de la que depende todo esto: su propia
        // ayuda dice que con él la autenticación es solo ANTHROPIC_API_KEY y
        // que OAuth y el llavero no se leen nunca.
        t.noTiene(args.join(' '), '--bare');
        t.eq(args[args.indexOf('--tools') + 1], '', 'ninguna herramienta');
    });

    t.test('sin modelo elegido no se manda el flag vacío', () => {
        t.noTiene(claude.argumentos('hola', '', '').join(' '), '--model');
    });

    // ── El camino entero, contra un CLI de mentira ────────────────────

    t.test('una consulta completa, sin red', async () => {
        const falso = cliFalso('claude-ok', JSON.stringify({ is_error: false, result: 'Alargar el fade.' }), 0);
        const antes = process.env.REVIEWER_CLAUDE_BIN;
        process.env.REVIEWER_CLAUDE_BIN = falso.bin;
        try {
            t.eq(claude.donde(), falso.bin, 'la escotilla del entorno manda');
            const r = await claude.preguntar({ modelo: 'haiku' }, { sistema: 'S', usuario: 'U' });
            t.eq(r.texto, 'Alargar el fade.');
            t.eq(r.modelo, 'haiku');
            t.tiene(falso.args().join(' '), '--model haiku', 'y se lo llamó con el modelo elegido');
        } finally {
            if (antes === undefined) delete process.env.REVIEWER_CLAUDE_BIN;
            else process.env.REVIEWER_CLAUDE_BIN = antes;
        }
    });

    t.test('la sesión vencida llega como un error legible, no como texto', async () => {
        const falso = cliFalso('claude-vencida', VENCIDA, 0);
        const antes = process.env.REVIEWER_CLAUDE_BIN;
        process.env.REVIEWER_CLAUDE_BIN = falso.bin;
        try {
            let error = null;
            try { await claude.preguntar({ modelo: 'haiku' }, { sistema: 'S', usuario: 'U' }); } catch (e) { error = e; }
            t.ok(error, 'tiene que lanzar');
            // Lo primero que se lee es el arreglo, en español. El crudo del CLI
            // va detrás y entre paréntesis: sirve para diagnosticar, pero no
            // puede ser lo que el editor tenga que interpretar.
            t.ok(error.message.startsWith('La sesión de Claude no está activa'), `empieza en español: ${error.message.slice(0, 40)}`);
            t.tiene(error.message, 'claude auth login');
        } finally {
            if (antes === undefined) delete process.env.REVIEWER_CLAUDE_BIN;
            else process.env.REVIEWER_CLAUDE_BIN = antes;
        }
    });

    t.test('sin CLI, el botón de mejorar explica qué falta', async () => {
        // Que falle bien es el requisito: mejorar comentarios es un extra, así
        // que la app tiene que seguir entera y el botón tiene que decir qué
        // instalar en vez de quedarse mudo.
        const antes = process.env.REVIEWER_CLAUDE_BIN;
        process.env.REVIEWER_CLAUDE_BIN = path.join(temporal.carpeta('claude-sin'), 'no-existe');
        try {
            let error = null;
            try { await claude.preguntar({ modelo: 'haiku' }, { sistema: 'S', usuario: 'U' }); } catch (e) { error = e; }
            t.ok(error, 'tiene que lanzar');
            t.tiene(error.message, 'No encontré el CLI de Claude');
            t.tiene(error.message, 'claude.ai/install.sh', 'y dice cómo instalarlo');
            // Y el cartel de Ajustes dice lo mismo, nombrando la ruta mal
            // escrita en vez de dejar buscar a ciegas.
            const s = await claude.sesion();
            t.eq(s.estado, 'sin-cli');
            t.tiene(s.detalle, 'REVIEWER_CLAUDE_BIN');
        } finally {
            if (antes === undefined) delete process.env.REVIEWER_CLAUDE_BIN;
            else process.env.REVIEWER_CLAUDE_BIN = antes;
        }
    });

    t.test('donde() busca en las rutas del instalador oficial', () => {
        // `which` no alcanza: una app de macOS abierta desde el Finder hereda un
        // PATH que no tiene `~/.local/bin`, que es justo donde deja el binario
        // el instalador que recomienda Anthropic.
        t.ok(claude.rutasConocidas().some(r => r.endsWith('/.local/bin/claude')));
    });
};
