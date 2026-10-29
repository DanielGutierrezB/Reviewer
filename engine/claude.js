'use strict';
/**
 * claude.js — Mejorar la redacción con la cuenta de Claude del editor, pasando
 * por el CLI de `claude` que ya está instalado y con sesión iniciada.
 *
 * **Por qué el CLI y no un OAuth nuestro.** El pedido fue «simplemente inicio
 * sesión y uso Haiku». Las dos formas de darle eso son construir un flujo
 * OAuth contra Anthropic y guardar nosotros el token, o invocar un binario que
 * YA está autenticado. La segunda no tiene credenciales: no hay token que
 * guardar, ni que renovar, ni que filtrar en un log, ni que quede en un backup
 * de Time Machine. El que autentica es `claude`, el que guarda es `claude`, y
 * el que renueva cuando vence es `claude`. Esta app no toca un secreto en
 * ningún momento, y por eso en `ajustes.json` no hay un campo nuevo donde
 * pueda aparecer uno.
 *
 * Es también lo que hace HyperPremiere, aunque allá no se vea a primera
 * vista: su botón «Iniciar sesión» corre `claude setup-token` y se guarda el
 * `sk-ant-oat…` que sale, pero su propio `bridge/claude-session.js` documenta
 * que ese token es OPCIONAL —el proveedor solo lo inyecta como
 * `CLAUDE_CODE_OAUTH_TOKEN` si existe, y sin él el CLI resuelve con su propia
 * sesión—. Allá hacía falta porque el panel corre dentro de Premiere, en la
 * máquina de otro, donde no hay terminal a mano. Acá la hay: esta app existe
 * para hablarle a Claude, así que el editor tiene la CLI y la terminal abierta.
 * Nos quedamos con la mitad que de verdad autentica y tiramos la que obliga a
 * custodiar un secreto.
 *
 * **Esto manda texto afuera de la máquina.** Las otras dos opciones —Ollama y
 * el servidor compatible— apuntan por defecto a `localhost`: el comentario no
 * sale de la Mac. Con la cuenta de Claude sí sale, y un comentario es lo que el
 * editor opina del trabajo de alguien. No es un detalle de implementación: es
 * un cambio de naturaleza, y por eso la pantalla de Ajustes lo dice con todas
 * las letras en vez de dejarlo deducir del nombre del proveedor.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

/**
 * Los modelos que se ofrecen, y por qué son alias y no nombres completos.
 *
 * El CLI no tiene un comando que liste modelos —se revisó `claude --help` de la
 * 2.1.289: hay `--model`, y la ayuda dice «provide an alias for the latest
 * model (e.g. 'fable', 'opus', or 'sonnet') or a model's full name», pero no
 * hay nada que los enumere—. Así que o se escribe una lista fija de versiones,
 * que envejece sola y miente en cuanto Anthropic saca otra, o se usan los alias
 * y decide el CLI. Los alias ganan: avanzan cuando el editor actualiza su
 * `claude` y acá no hay que sacar una versión nueva para que aparezca el modelo
 * del mes.
 *
 * HyperPremiere llega a lo mismo por el camino largo: lee el menú `/model` de
 * adentro del binario y mide cada alias con una llamada real para saber qué
 * contesta (`bridge/claude-modelos.js`). Eso resuelve un problema que acá no
 * existe —allá se eligen modelos para DISEÑAR animaciones, donde la diferencia
 * entre Opus 5.5 y Opus 4.8 se paga— mientras que esto reescribe dos frases que
 * el editor ya escribió. Una llamada de medición por modelo, para un botón de
 * reescribir, es gastar del plan del editor para decorar un desplegable.
 *
 * Haiku primero y por defecto porque es textualmente lo que se pidió: el más
 * rápido. Y acá, a diferencia de en HyperPremiere, es el que corresponde: lo
 * que peor rinde de Haiku es diseñar, y reescribir un comentario sin inventar
 * nada es justo lo contrario de diseñar.
 */
const MODELOS = [
    { id: 'haiku', nombre: 'Haiku — el más rápido (recomendado)' },
    { id: 'sonnet', nombre: 'Sonnet — rápido y más capaz' },
    { id: 'opus', nombre: 'Opus — el más capaz, el más lento' }
];

const MODELO_POR_DEFECTO = 'haiku';

/**
 * Dónde deja el binario cada forma de instalar Claude Code.
 *
 * No se usa `engine/paths.js` para esto, y no es por descuido: sus `KNOWN_DIRS`
 * son los de Homebrew y `/usr/bin`, y el instalador oficial de Claude deja el
 * binario en `~/.local/bin`, que no está en ninguno. `which` tampoco alcanza:
 * una app de macOS arrancada desde el Finder hereda un PATH mínimo que no
 * incluye `~/.local/bin`, así que el editor que lo ve perfecto desde su
 * terminal nos daría «no está instalado». Se busca por ruta y `which` queda de
 * último recurso, al revés que allá.
 *
 * Tampoco se cachea el resultado: `paths.resolveTool` memoriza para siempre,
 * incluido el «no está», y alguien que instala la CLI con la app abierta
 * quedaría sin opción hasta reiniciar. Son dos `statSync`, no vale la pena.
 */
function rutasConocidas() {
    const casa = os.homedir();
    return [
        path.join(casa, '.local', 'bin', 'claude'),      // el instalador oficial
        path.join(casa, '.claude', 'local', 'claude'),   // la instalación «local» del propio CLI
        '/opt/homebrew/bin/claude',
        '/usr/local/bin/claude'
    ];
}

function ejecutable(p) {
    try {
        fs.accessSync(p, fs.constants.X_OK);
        return true;
    } catch (e) {
        return false;
    }
}

/**
 * Dónde está `claude` en esta Mac, o `null`.
 *
 * `REVIEWER_CLAUDE_BIN` es la escotilla: sirve para una instalación en un lugar
 * que no se nos ocurrió y es lo que usan los tests para apuntar a un CLI de
 * mentira, que es como se prueba todo esto sin pegarle a Anthropic ni gastar
 * del plan de nadie.
 */
function donde() {
    const forzado = String(process.env.REVIEWER_CLAUDE_BIN || '').trim();
    // Una escotilla que apunta a la nada se trata como "no hay CLI" y NO se
    // intenta igual: desde la app, un binario que no se puede ejecutar y uno
    // que no está son lo mismo, y lanzarlo para que el sistema conteste
    // «spawn ENOENT» cambia un mensaje que dice dónde buscar por uno que dice
    // el nombre de un error. La ruta escrita a mano igual se nombra en el
    // detalle, así que un error de tipeo se ve.
    if (forzado) return ejecutable(forzado) ? forzado : null;
    for (const p of rutasConocidas()) {
        if (ejecutable(p)) return p;
    }
    return null;
}

/** Dónde se buscó, para poder mirar ahí. Nombra la escotilla si está puesta. */
function dondeBusque() {
    const forzado = String(process.env.REVIEWER_CLAUDE_BIN || '').trim();
    if (forzado) return `La variable REVIEWER_CLAUDE_BIN apunta a:\n  ${forzado}\n…y ahí no hay nada que se pueda ejecutar.`;
    return `Busqué en:\n  ${rutasConocidas().join('\n  ')}`;
}

/** Cuánto se espera a `claude auth status`, que contesta en ~250 ms. */
const ESTADO_MAX_MS = 20000;

/**
 * Corre el CLI y devuelve lo que escribió. Nunca lanza.
 *
 * Sin `shell`: el texto del comentario va como argumento y pasarlo por un shell
 * sería dejar que unas comillas en «el fade de 2" queda corto» se conviertan en
 * sintaxis. Con el array de argumentos no hay nada que escapar.
 *
 * El entorno se hereda tal cual, SIN tocar `CLAUDE_CODE_OAUTH_TOKEN`: esa
 * variable es la que usa HyperPremiere para inyectar su token guardado, y no
 * ponerla es exactamente la decisión de no tener credenciales. Si el editor ya
 * la tiene puesta en su shell, es de él y se respeta; nosotros no la leemos ni
 * la escribimos.
 */
function correr(bin, args, timeoutMs, entrada) {
    return new Promise(resolve => {
        let hijo;
        try {
            hijo = spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'] });
        } catch (e) {
            resolve({ code: -1, out: '', err: e.message, corto: false });
            return;
        }

        let out = '';
        let err = '';
        let corto = false;
        const reloj = setTimeout(() => {
            corto = true;
            try { hijo.kill('SIGKILL'); } catch (e) { /* ya estaba muerto */ }
        }, timeoutMs);

        hijo.stdout.on('data', d => { out += String(d); });
        hijo.stderr.on('data', d => { err += String(d); });
        hijo.on('error', e => {
            clearTimeout(reloj);
            resolve({ code: -1, out, err: e.message, corto });
        });
        hijo.on('close', code => {
            clearTimeout(reloj);
            resolve({ code, out, err, corto });
        });

        try {
            if (entrada !== undefined) hijo.stdin.write(entrada);
            hijo.stdin.end();
        } catch (e) { /* si no acepta stdin, el close de arriba lo cuenta */ }
    });
}

/**
 * Lo que dijo `claude auth status`, leído. Función pura y aparte para poder
 * probar cada respuesta posible sin un CLI al lado.
 *
 * Son CUATRO estados y no dos, y la diferencia importa: «no se sabe» —un CLI
 * viejo que no conoce el subcomando, un binario que no contesta— NO es «no hay
 * sesión». Mandar a iniciar sesión a alguien que la tiene es el peor error
 * posible acá, porque lo manda a arreglar algo que funciona.
 */
function leerEstado(r) {
    const crudo = `${(r && r.out) || ''}\n${(r && r.err) || ''}`;
    const llave = crudo.indexOf('{');
    let datos = null;
    if (llave !== -1) {
        try { datos = JSON.parse(crudo.slice(llave, crudo.lastIndexOf('}') + 1)); } catch (e) { datos = null; }
    }

    if (datos && typeof datos.loggedIn === 'boolean') {
        if (!datos.loggedIn || datos.authMethod === 'none') {
            return { estado: 'sin-sesion', cuenta: '', plan: '', porQue: 'el CLI contestó que no tiene con qué autenticarse' };
        }
        return {
            estado: 'con-sesion',
            cuenta: String(datos.email || ''),
            plan: String(datos.subscriptionType || ''),
            porQue: ''
        };
    }

    if (r && r.corto) return { estado: 'no-se-sabe', cuenta: '', plan: '', porQue: `el CLI no contestó en ${ESTADO_MAX_MS / 1000} s` };
    if (/unknown command|unknown option|no such command/i.test(crudo)) {
        return { estado: 'no-se-sabe', cuenta: '', plan: '', porQue: 'esta versión del CLI no conoce `claude auth status`' };
    }
    if (r && r.code === -1) return { estado: 'no-se-sabe', cuenta: '', plan: '', porQue: 'no se pudo ejecutar el CLI' };
    return { estado: 'no-se-sabe', cuenta: '', plan: '', porQue: 'el CLI contestó algo que no supe leer' };
}

/** Cómo se instala, dicho igual en todos lados. */
const COMO_INSTALAR = 'Instalalo con:  curl -fsSL https://claude.ai/install.sh | bash';

/** Cómo se inicia sesión, dicho igual en todos lados. */
const COMO_ENTRAR = 'Abrí una terminal y corré:  claude auth login';

/**
 * ¿Hay sesión de Claude en esta Mac? Es lo que muestra Ajustes y lo que mira el
 * botón de mejorar antes de fallar en silencio. Nunca lanza.
 *
 * **Que diga que sí no garantiza que la llamada vaya a andar, y está medido.**
 * En esta misma máquina, con el CLI 2.1.289, `claude auth status` contestó
 * `{"loggedIn":true,"authMethod":"claude.ai",…}` y la llamada siguiente se cayó
 * con `401 OAuth access token has expired. Re-authenticate to continue.`. O sea
 * que el subcomando dice «hay con qué autenticarse», no «la credencial sirve».
 * Es la misma advertencia que deja escrita `claude-session.js` de
 * HyperPremiere, y es la razón por la que el vencimiento se detecta donde de
 * verdad se nota —en la respuesta de la consulta, ver `leerRespuesta`— y no
 * acá. Preguntar dos veces no arreglaría nada: la única forma de saber si el
 * token vive es usarlo.
 */
async function sesion() {
    const bin = donde();
    if (!bin) {
        return {
            estado: 'sin-cli',
            bin: '',
            cuenta: '',
            resumen: 'No encontré el CLI de Claude en esta Mac.',
            detalle: `${dondeBusque()}\n${COMO_INSTALAR}`
        };
    }

    const r = await correr(bin, ['auth', 'status'], ESTADO_MAX_MS);
    const leido = leerEstado(r);

    if (leido.estado === 'con-sesion') {
        return {
            estado: 'con-sesion',
            bin,
            cuenta: leido.cuenta,
            resumen: leido.cuenta
                ? `Sesión iniciada como ${leido.cuenta}${leido.plan ? ` (plan ${leido.plan})` : ''}.`
                : 'Sesión de Claude iniciada en esta Mac.',
            detalle: ''
        };
    }

    if (leido.estado === 'sin-sesion') {
        return {
            estado: 'sin-sesion',
            bin,
            cuenta: '',
            resumen: 'El CLI de Claude está, pero sin sesión iniciada.',
            detalle: COMO_ENTRAR
        };
    }

    // No se sabe. Se dice, y no se le pone cara de problema: el editor puede
    // estar perfectamente logueado y lo único que falló fue la pregunta.
    return {
        estado: 'no-se-sabe',
        bin,
        cuenta: '',
        resumen: `No pude comprobar la sesión (${leido.porQue}).`,
        detalle: 'No quiere decir que falte. Probá «Probar» y, si falla, ' + COMO_ENTRAR.toLowerCase()
    };
}

/**
 * Cerrar sesión: se la cierra en el CLI, que es el único que la tiene.
 *
 * No hay nada nuestro que borrar —ese es todo el punto de no guardar
 * credenciales— y por eso este módulo no tiene un «olvidar token». Lo que sí
 * hay que decir es que esto cierra la sesión del CLI de Claude para TODA la
 * máquina, no solo para Reviewer: el editor que apriete esto también se queda
 * sin `claude` en la terminal. Lo dice la pantalla antes de hacerlo.
 */
async function salir() {
    const bin = donde();
    if (!bin) return { ok: false, error: 'No encontré el CLI de Claude en esta Mac.' };
    const r = await correr(bin, ['auth', 'logout'], ESTADO_MAX_MS);
    if (r.code !== 0) {
        return { ok: false, error: `El CLI no pudo cerrar la sesión: ${(r.err || r.out).trim().slice(0, 200) || `salió con código ${r.code}`}` };
    }
    return { ok: true };
}

/**
 * De qué se cayó la llamada, mirando lo que escribió el CLI. Función pura:
 * recibe texto y devuelve una clave, así cada modo de falla se prueba sin
 * levantar nada.
 *
 * Son estos cuatro y no una bolsa de «algo falló» porque el arreglo de cada uno
 * es distinto y el editor tiene que poder hacerlo sin preguntarnos: la sesión
 * se renueva en la terminal, el límite de uso se espera o se cambia de
 * proveedor, el modelo se cambia en el desplegable de al lado, y la red se
 * arregla sola. Un botón que dice «error» a las cuatro cosas obliga a escribirle
 * a alguien.
 */
function causaDe(pistas) {
    const t = String(pistas || '');
    if (/expired|re-?authenticate|not logged ?in|unauthoriz|unauthenticat|\b401\b|authentication_error|invalid api ?key|please run \/login/i.test(t)) return 'sesion';
    if (/rate.?limit|quota|usage limit|out of credit|insufficient|\b429\b|overloaded/i.test(t)) return 'cuota';
    if (/model|\b404\b/i.test(t) && /not found|unknown|unrecogni|invalid/i.test(t)) return 'modelo';
    if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|getaddrinfo|network|fetch failed|offline/i.test(t)) return 'red';
    return '';
}

/** El mensaje que ve el editor, con el próximo paso adentro. */
function mensajeDe(causa, modelo, dijo) {
    const cola = dijo ? ` (el CLI dijo: ${dijo})` : '';
    switch (causa) {
        case 'sesion':
            // «No está activa» y no «venció»: desde acá las dos se ven iguales
            // —el CLI contesta 401 tanto si nunca entró como si el token se le
            // pasó— y decir «venció» a quien nunca inició sesión lo manda a
            // buscar qué hizo mal. El arreglo es el mismo en los dos casos, así
            // que se nombra el arreglo y no la causa.
            return `La sesión de Claude no está activa. ${COMO_ENTRAR} y volvé a intentar.${cola}`;
        case 'cuota':
            return `Tu cuenta de Claude llegó al límite de uso. Esperá a que se renueve, o pasá a Ollama en Ajustes para seguir mientras tanto.${cola}`;
        case 'modelo':
            return `El CLI no reconoce el modelo «${modelo || 'sin elegir'}». Elegí otro en Ajustes.${cola}`;
        case 'red':
            return `No hay conexión con Anthropic. Esta opción necesita internet; Ollama no.${cola}`;
        default:
            return dijo || 'El CLI de Claude falló y no dijo por qué.';
    }
}

/** Lo que el CLI escribe cuando algo sale mal, sin el JSON alrededor. */
function recortar(texto) {
    return String(texto || '').replace(/\s+/g, ' ').trim().slice(0, 200);
}

/**
 * Lo que contestó el CLI, convertido en `{ ok, texto, motivo }`. Pura, y es la
 * pieza más importante de este archivo.
 *
 * **El CLI puede fallar con código de salida 0.** Medido en esta máquina: con
 * el token vencido, `claude -p … --output-format json` salió con código 0 y el
 * error adentro del JSON (`"is_error":true`, `"api_error_status":401`,
 * `"result":"Failed to authenticate. API Error: 401 OAuth access token has
 * expired…"`). Quien mire solo el código de salida se lleva ese texto como si
 * fuera el comentario reescrito, y el editor termina con «Failed to
 * authenticate» guardado adentro de su nota. Por eso `is_error` se mira
 * SIEMPRE, antes que nada.
 *
 * Con `--output-format json` el motivo viaja por stdout, no por stderr: mirar
 * solo stderr —que es lo natural— deja el diagnóstico tirado. Es el mismo error
 * que HyperPremiere documenta en `providers/claude-cli.js` y acá se nace sin él.
 */
function leerRespuesta(r, modelo) {
    if (r.corto) return { ok: false, motivo: 'Claude tardó demasiado y se cortó la consulta.' };
    if (r.code === -1) return { ok: false, motivo: `No se pudo ejecutar el CLI de Claude: ${recortar(r.err)}` };

    let datos = null;
    try { datos = JSON.parse(r.out); } catch (e) { datos = null; }

    if (datos && datos.is_error) {
        const dijo = recortar(datos.result || datos.error);
        return { ok: false, motivo: mensajeDe(causaDe(`${dijo} ${datos.api_error_status || ''}`), modelo, dijo) };
    }
    if (r.code !== 0) {
        const dijo = recortar(r.err || r.out);
        return { ok: false, motivo: mensajeDe(causaDe(dijo), modelo, dijo) };
    }
    if (!datos) {
        // Un CLI viejo sin `--output-format json` escribe el texto pelado. Se
        // acepta: es una respuesta, y negarla por el formato sería dejar sin
        // función a quien no actualizó.
        return { ok: true, texto: String(r.out || '') };
    }
    return { ok: true, texto: String(datos.result || '') };
}

/**
 * Los argumentos de una consulta. Aparte para poder probarlos sin correr nada:
 * este arreglo es el contrato con el CLI y cada flag está por un motivo.
 */
function argumentos(prompt, sistema, modelo) {
    const args = ['-p', prompt, '--output-format', 'json'];
    // El alias va tal cual; que `haiku` sea hoy Haiku 4.5 y mañana otro lo
    // decide la versión del CLI del editor, no nosotros (ver MODELOS).
    if (modelo) args.push('--model', modelo);
    // Sin herramientas. La ayuda del CLI documenta `""` para eso, y acá sobran:
    // reescribir dos frases no necesita leer archivos, y un modelo que se va a
    // buscar contexto paga segundos por nada, que es justo lo contrario de lo
    // que se pidió al elegir Haiku.
    args.push('--tools', '');
    // Sin los MCP del editor. Levantarlos cuesta arranque y le daría al modelo
    // herramientas que acá no pintan nada.
    args.push('--strict-mcp-config');
    // Que no quede una sesión en disco por cada comentario refinado: son
    // consultas sueltas sin continuidad, y `~/.claude/projects` no es un
    // basurero nuestro.
    args.push('--no-session-persistence');
    // El manual va como system prompt de verdad y no pegado al mensaje: las
    // reglas de `prompts.js` están escritas para que se obedezcan, y adentro de
    // un mensaje de usuario se negocian.
    if (sistema) args.push('--append-system-prompt', sistema);
    return args;
    // Lo que NO va: `--bare`. Parece exactamente lo que uno quiere —se saltea
    // hooks, LSP, sincronización de plugins y el descubrimiento de CLAUDE.md,
    // que es todo tiempo— pero su propia ayuda dice que con él «Anthropic auth
    // is strictly ANTHROPIC_API_KEY or apiKeyHelper (OAuth and keychain are
    // never read)». O sea que apaga justo la sesión de la que depende todo
    // esto. Es la trampa más fácil de pisar de este archivo.
}

/**
 * Una consulta. Mismo contrato que `llm.preguntar`: devuelve `{ texto, modelo,
 * ms }` o lanza con un mensaje que el editor pueda leer.
 *
 * Lo que este camino NO puede hacer, y conviene saberlo antes de buscar el bug:
 * el CLI no expone temperatura, ni tope de tokens, ni semilla. En Ollama hay un
 * `seed: 7` para que apretar ✨ dos veces dé lo mismo; acá no hay con qué, así
 * que dos refinados del mismo texto pueden volver distintos. Se acepta porque
 * la alternativa era no tener la opción: el modelo se elige por rapidez y la
 * verificación de `prompts.js` —que es la que impide que se invente algo— sigue
 * corriendo igual sobre lo que vuelva.
 */
async function preguntar(config, mensajes, opciones) {
    const bin = donde();
    if (!bin) throw new Error(`No encontré el CLI de Claude en esta Mac. ${COMO_INSTALAR}`);

    const modelo = (config && config.modelo) || MODELO_POR_DEFECTO;
    const empezo = Date.now();
    const r = await correr(
        bin,
        argumentos(mensajes.usuario, mensajes.sistema, modelo),
        (opciones && opciones.timeoutMs) || 90000
    );

    const leido = leerRespuesta(r, modelo);
    if (!leido.ok) throw new Error(leido.motivo);
    return { texto: leido.texto, modelo, ms: Date.now() - empezo };
}

/**
 * El botón «Probar» de Ajustes.
 *
 * Pregunta de verdad, igual que con Ollama, y acá importa más: es el único
 * lugar donde se puede descubrir que la sesión venció sin que se caiga un
 * refinado a mitad de camino, porque `claude auth status` no lo sabe (ver
 * `sesion`).
 */
async function probar(config) {
    const s = await sesion();
    if (s.estado === 'sin-cli' || s.estado === 'sin-sesion') {
        return { ok: false, error: `${s.resumen} ${s.detalle}`.trim(), modelos: [] };
    }
    try {
        const r = await preguntar(config, {
            sistema: 'Contestá con una sola palabra.',
            usuario: 'Decí: listo'
        }, { timeoutMs: 60000 });
        return { ok: true, modelos: MODELOS.map(m => m.id), ms: r.ms, dijo: r.texto.trim().slice(0, 40) };
    } catch (e) {
        return { ok: false, error: e.message, modelos: MODELOS.map(m => m.id) };
    }
}

module.exports = {
    MODELOS,
    MODELO_POR_DEFECTO,
    COMO_INSTALAR,
    COMO_ENTRAR,
    donde,
    rutasConocidas,
    dondeBusque,
    sesion,
    salir,
    preguntar,
    probar,
    // Expuesto para los tests: leer lo que contestó el CLI es lógica pura y se
    // prueba sin red, sin binario y sin gastar del plan de nadie.
    leerEstado,
    leerRespuesta,
    causaDe,
    argumentos
};
