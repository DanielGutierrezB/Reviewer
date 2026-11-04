'use strict';
/**
 * actualizaciones.js — Si hay una versión publicada más nueva, y cómo bajarla.
 *
 * No usa `electron-updater` a propósito. Ese instala solo, pero en macOS se
 * apoya en Squirrel.Mac, que antes de reemplazar el bundle comprueba que la
 * firma del build nuevo case con la del que está corriendo. Acá la firma es
 * ad-hoc (ver `tools/build-pkg.sh`: `codesign --sign -`, porque no hay
 * Developer ID de Apple), y su identificador cambia en cada compilación: la
 * validación falla siempre, y falla tarde, después de bajar los 130 MB.
 *
 * Lo que se hace en cambio es lo mismo que Note Taker: bajar el `.pkg` y
 * abrírselo al editor, que aprieta Continuar en el Instalador de macOS como con
 * cualquier otro instalador. Y hay un detalle que hace que eso funcione sin
 * firma: el archivo lo baja la app con `https` de Node, no un navegador, así
 * que no lleva la marca de cuarentena y Gatekeeper no lo frena. No se le quita
 * nada a nada; simplemente nunca la tuvo.
 *
 * Lo que se baja se comprueba antes de abrirlo: el tamaño contra el que GitHub
 * publica y, cuando el release trae la huella del archivo, su SHA-256. Un
 * instalador a medias o cambiado no se abre: se borra y se dice.
 *
 * Hay un solo `.pkg` por release y no trae el modelo del dictado: ese lo baja
 * la app la primera vez (`engine/dependencias.js`), así que actualizar son los
 * 130 MB de la app y nada más, y el modelo ya instalado se queda donde está.
 *
 * Nada de acá puede tumbar la app: sin internet, con GitHub caído o con un repo
 * sin releases, devuelve "no hay nada nuevo" y la app sigue andando.
 */

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');

const DEFAULTS = {
    owner: 'DanielGutierrezB',
    // Los releases viven en el mismo repo que el código. Un repo aparte solo
    // para instaladores tendría sentido si el código fuera privado; es un sitio
    // más donde mantener un nombre y equivocarse.
    repo: 'Reviewer',
    // Seis segundos. Esto se consulta sola al arrancar, así que el tope no está
    // para que el editor no espere —no está esperando nada— sino para que un
    // socket colgado no deje el pedido abierto el resto de la sesión.
    timeoutMs: 6000,
    // Las pruebas lo apuntan a un servidor local, para recorrer el camino de
    // verdad —HTTP, cabeceras, códigos de error— sin publicar un release ni
    // depender de que haya internet mientras corre la suite.
    _base: process.env.REVIEWER_UPDATE_BASE || 'https://api.github.com'
};

/** http o https según la url, que en las pruebas no es la de GitHub. */
const agente = url => (String(url).startsWith('https:') ? https : http);

function opt(opciones, clave) {
    if (opciones && opciones[clave] !== undefined && opciones[clave] !== null) return opciones[clave];
    return DEFAULTS[clave];
}

/**
 * Compara dos versiones tipo 1.0.10.
 *
 * Como números y no como texto, que es el error que se esconde mejor: ordenadas
 * alfabéticamente, "1.0.10" va ANTES que "1.0.9", y la app se queda sin ver una
 * actualización que existe hasta que el patch vuelva a tener un solo dígito.
 *
 * @returns {number} negativo si `a` es anterior a `b`, 0 si son la misma, positivo si posterior
 */
function comparar(a, b) {
    const partes = v => String(v == null ? '' : v)
        .trim()
        .replace(/^v/i, '')
        // Un sufijo tipo "-beta.2" no participa: acá solo se decide si hay algo
        // más nuevo, y para eso alcanzan los tres números.
        .split('-')[0]
        .split('.')
        .map(n => parseInt(n, 10) || 0);

    const x = partes(a);
    const y = partes(b);
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
        const dif = (x[i] || 0) - (y[i] || 0);
        if (dif) return dif;
    }
    return 0;
}

/**
 * El `.pkg` de un release.
 *
 * Desde la 0.1.17 hay uno solo. Los releases anteriores traían dos, y de esos
 * se prefiere el que termina en `-update.pkg` —solo la app— sobre el completo,
 * que arrastra el modelo de Whisper: son 600 MB para cambiar código.
 */
function instalador(release) {
    const assets = (release && release.assets) || [];
    return assets.find(a => /-update\.pkg$/i.test(a.name || ''))
        || assets.find(a => /\.pkg$/i.test(a.name || ''))
        || null;
}

/**
 * La huella SHA-256 que GitHub publica de un asset, si la publica.
 *
 * Viene como `sha256:<hex>` en el campo `digest`. Sin ella no se deja de
 * actualizar —el tamaño se comprueba igual—, pero con ella un instalador que
 * no es el que se subió no se abre.
 */
function huellaDe(asset) {
    const m = /^sha256:([0-9a-f]{64})$/i.exec((asset && asset.digest) || '');
    return m ? m[1].toLowerCase() : null;
}

function pedirJson(url, opciones) {
    return new Promise((resolve, reject) => {
        const tope = opt(opciones, 'timeoutMs');
        let reloj = null;
        const terminar = fn => (valor => { clearTimeout(reloj); fn(valor); });
        const listo = terminar(resolve);
        const fallar = terminar(reject);

        const pedido = agente(url).get(url, {
            headers: {
                // Sin User-Agent, GitHub contesta 403 y no explica por qué.
                'User-Agent': 'Reviewer',
                Accept: 'application/vnd.github+json'
            },
            timeout: tope
        }, respuesta => {
            if (respuesta.statusCode !== 200) {
                respuesta.resume();
                const fallo = new Error(`GitHub contestó ${respuesta.statusCode}`);
                fallo.statusCode = respuesta.statusCode;
                fallar(fallo);
                return;
            }
            let cuerpo = '';
            respuesta.setEncoding('utf8');
            respuesta.on('data', trozo => { cuerpo += trozo; });
            respuesta.on('error', fallar);
            respuesta.on('end', () => {
                try { listo(JSON.parse(cuerpo)); } catch (e) { fallar(new Error('la respuesta no se entiende')); }
            });
        });

        // Dos topes y no uno: el `timeout` del pedido mide el socket quieto, y
        // un servidor que manda un byte cada cinco segundos no lo dispara nunca.
        // Este es el plazo total, que es el que el editor nota.
        reloj = setTimeout(() => pedido.destroy(new Error('GitHub no contestó a tiempo')), tope);
        pedido.on('timeout', () => pedido.destroy(new Error('GitHub no contestó a tiempo')));
        pedido.on('error', fallar);
    });
}

/**
 * ¿Hay algo más nuevo que lo que corre ahora?
 *
 * Nunca lanza: un fallo de red es una respuesta válida con `hay: false` y un
 * motivo escrito para que se pueda mostrar tal cual. Quien llama a esto lo hace
 * desde el arranque de la app, y ahí una promesa rechazada que nadie atrapa deja
 * la app abierta pero con una excepción en el diario que no explica nada.
 *
 * @param {object} params { versionActual, owner, repo, timeoutMs }
 * @returns {Promise<{hay:boolean, version?:string, notas?:string, pagina?:string, nombre?:string, tamanoBytes?:number, motivo?:string}>}
 */
async function buscar(params) {
    const actual = (params && params.versionActual) || '0.0.0';
    const url = `${opt(params, '_base')}/repos/${opt(params, 'owner')}/${opt(params, 'repo')}/releases/latest`;

    let release;
    try {
        release = await pedirJson(url, params);
    } catch (err) {
        // Un repo sin ningún release contesta 404. Eso no es que la consulta
        // falló: es que todavía no hay nada publicado, y decirlo como error deja
        // el botón mostrando una avería donde no la hay.
        if (err.statusCode === 404) {
            return { hay: false, motivo: 'Todavía no hay ninguna versión publicada.' };
        }
        return { hay: false, motivo: `No se pudo consultar: ${err.message}` };
    }

    const version = String(release.tag_name || release.name || '').replace(/^v/i, '');
    if (!version) return { hay: false, motivo: 'El último release no dice qué versión es.' };
    if (comparar(version, actual) <= 0) {
        // La local más nueva que la publicada pasa todo el tiempo mientras se
        // desarrolla: la versión ya subió y el release todavía no salió. No es
        // un error y no se dice distinto de estar al día.
        return { hay: false, version, motivo: 'Estás en la última versión.' };
    }

    const pkg = instalador(release);
    return {
        hay: true,
        version,
        notas: release.body || '',
        pagina: release.html_url || `https://github.com/${opt(params, 'owner')}/${opt(params, 'repo')}/releases/latest`,
        // De dónde se baja y cómo se comprueba. La url se queda del lado del
        // proceso principal (ver `main/actualizaciones.js`): la ventana nunca
        // dice qué bajar.
        url: pkg ? pkg.browser_download_url : null,
        nombre: pkg ? pkg.name : null,
        tamanoBytes: pkg ? (pkg.size || 0) : 0,
        huella: huellaDe(pkg),
        // Publicar el tag sin subir el `.pkg` es el olvido clásico de
        // `publicar-release.sh`. Se avisa igual —hay algo nuevo— pero diciendo
        // que no hay nada que bajar todavía.
        sinInstalador: !pkg
    };
}

/** Sigue las redirecciones de GitHub hasta el archivo de verdad. */
function abrirFlujo(url, opciones, saltos = 5) {
    return new Promise((resolve, reject) => {
        const pedido = agente(url).get(url, {
            headers: { 'User-Agent': 'Reviewer' },
            timeout: opt(opciones, 'timeoutMs')
        }, respuesta => {
            const { statusCode, headers } = respuesta;
            if (statusCode >= 300 && statusCode < 400 && headers.location) {
                respuesta.resume();
                if (!saltos) { reject(new Error('demasiadas redirecciones')); return; }
                abrirFlujo(new URL(headers.location, url).href, opciones, saltos - 1).then(resolve, reject);
                return;
            }
            if (statusCode !== 200) {
                respuesta.resume();
                reject(new Error(`la descarga contestó ${statusCode}`));
                return;
            }
            resolve(respuesta);
        });
        pedido.on('timeout', () => pedido.destroy(new Error('la descarga se quedó sin respuesta')));
        pedido.on('error', reject);
    });
}

function sha256De(archivo) {
    return new Promise((resolve, reject) => {
        const h = crypto.createHash('sha256');
        fs.createReadStream(archivo).on('data', c => h.update(c)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
    });
}

/**
 * Baja el instalador y lo comprueba.
 *
 * Escribe a un archivo `.parcial` y recién al final lo renombra: si se corta la
 * conexión a mitad, lo que queda no es un `.pkg` a medias que el editor pueda
 * abrir por error. El tamaño se compara con el que GitHub publicó y, si el
 * release trae la huella, también el SHA-256.
 *
 * @param {object} params { url, destDir, nombre, tamanoBytes, huella, onProgress, signal, timeoutMs }
 * @returns {Promise<{ok: boolean, path?: string, error?: string}>}
 */
async function descargar(params) {
    const { url, destDir, onProgress, signal } = params;
    const nombre = params.nombre || 'Reviewer.pkg';
    const destino = path.join(destDir, nombre);
    const parcial = `${destino}.parcial`;
    const borrarParcial = () => { try { fs.unlinkSync(parcial); } catch (e) { /* no llegó a existir */ } };

    let respuesta;
    try {
        respuesta = await abrirFlujo(url, params);
    } catch (err) {
        return { ok: false, error: `No se pudo bajar: ${err.message}` };
    }

    const total = Number(respuesta.headers['content-length']) || params.tamanoBytes || 0;
    let bajado = 0;
    let ultimoPct = -1;

    try {
        fs.mkdirSync(destDir, { recursive: true });
        await new Promise((resolve, reject) => {
            const salida = fs.createWriteStream(parcial);
            const cortar = err => { respuesta.destroy(); salida.destroy(); reject(err); };
            if (signal) {
                if (signal.aborted) { cortar(new Error('cancelado')); return; }
                signal.addEventListener('abort', () => cortar(new Error('cancelado')), { once: true });
            }
            respuesta.on('data', trozo => {
                bajado += trozo.length;
                // Un aviso por punto porcentual y no por bloque: son miles de
                // mensajes a la ventana para 130 MB.
                const pct = total ? Math.floor(100 * bajado / total) : 0;
                if (onProgress && pct > ultimoPct) {
                    ultimoPct = pct;
                    onProgress({ pct, bajado, total });
                }
            });
            respuesta.on('error', cortar);
            salida.on('error', cortar);
            salida.on('finish', resolve);
            respuesta.pipe(salida);
        });
    } catch (err) {
        borrarParcial();
        return { ok: false, error: err.message === 'cancelado' ? 'Descarga cancelada.' : `No se pudo bajar: ${err.message}` };
    }

    const esperado = params.tamanoBytes || total;
    if (esperado && bajado !== esperado) {
        borrarParcial();
        return { ok: false, error: `El instalador llegó incompleto: ${bajado} de ${esperado} bytes.` };
    }
    if (params.huella && await sha256De(parcial) !== params.huella) {
        borrarParcial();
        return { ok: false, error: 'El instalador que llegó no es el que se publicó: no coincide su huella. Probá de nuevo.' };
    }

    try {
        fs.renameSync(parcial, destino);
    } catch (err) {
        borrarParcial();
        return { ok: false, error: `No se pudo guardar el instalador: ${err.message}` };
    }
    return { ok: true, path: destino };
}

module.exports = { DEFAULTS, comparar, instalador, huellaDe, buscar, descargar };
