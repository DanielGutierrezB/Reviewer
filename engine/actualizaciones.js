'use strict';
/**
 * actualizaciones.js — Si hay una versión publicada más nueva que la que corre.
 *
 * Pregunta y nada más: no baja ni instala nada. Es una decisión, no una etapa a
 * medio hacer, y conviene entender por qué antes de "completarla".
 *
 * `electron-updater` —que es lo que todo el mundo usa— queda descartado por dos
 * motivos independientes, y cualquiera de los dos alcanza:
 *
 *   1. En macOS se apoya en Squirrel.Mac, que antes de reemplazar el bundle
 *      comprueba que la firma del build nuevo case con la del que está
 *      corriendo. Acá la firma es ad-hoc (ver `tools/build-pkg.sh`: `codesign
 *      --sign -`, porque no hay Developer ID de Apple), y su identificador
 *      cambia en cada compilación. La validación falla SIEMPRE, y falla tarde:
 *      después de bajar los 130 MB, con un error que no dice nada de esto.
 *   2. Squirrel.Mac se actualiza desde un `.zip` con el `.app` adentro. Reviewer
 *      se distribuye como `.pkg` de dos componentes porque el modelo de Whisper
 *      pesa 465 MB y no puede viajar dentro del `.app` —reemplazarlo lo
 *      borraría—. Para usar `electron-updater` habría que tirar ese esquema.
 *
 * Así que esto avisa y abre la página del release en el navegador, donde está el
 * `.pkg` y las notas. Un clic más que la actualización automática, pero funciona
 * hoy y no promete nada que no pueda cumplir. Tampoco ejecuta nada bajado por su
 * cuenta: el único que descarga es el navegador, y el único que instala es el
 * Instalador de macOS, con el editor mirando.
 *
 * Para pasar a la instalación de verdad hacen falta, en este orden: un Developer
 * ID, notarizar el build, cambiar el target a `zip` + `dmg`, y resolver qué pasa
 * con el modelo. Hasta entonces, media función honesta es mejor que una entera
 * que falla al final.
 *
 * Nada de acá puede tumbar la app: sin internet, con GitHub caído o con un repo
 * sin releases, devuelve "no hay nada nuevo" y la app sigue andando.
 */

const http = require('http');
const https = require('https');

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
 * El `.pkg` de actualización de un release.
 *
 * Se prefiere el que termina en `-update.pkg` —solo la app, ~130 MB— sobre el
 * completo, que arrastra el modelo de Whisper de nuevo (ver `build-pkg.sh`). Si
 * solo está el completo sirve igual, pero son 600 MB para cambiar código.
 */
function instalador(release) {
    const assets = (release && release.assets) || [];
    return assets.find(a => /-update\.pkg$/i.test(a.name || ''))
        || assets.find(a => /\.pkg$/i.test(a.name || ''))
        || null;
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
        // La página del release y no la url del `.pkg`: ahí están las notas al
        // lado del archivo, y bajar es un clic del editor en su navegador. Darle
        // el enlace directo se parece más a una descarga automática de lo que
        // esta app puede garantizar.
        pagina: release.html_url || `https://github.com/${opt(params, 'owner')}/${opt(params, 'repo')}/releases/latest`,
        nombre: pkg ? pkg.name : null,
        tamanoBytes: pkg ? (pkg.size || 0) : 0,
        // Publicar el tag sin subir el `.pkg` es el olvido clásico de
        // `publicar-release.sh`. Se avisa igual —hay algo nuevo— pero diciendo
        // que no hay nada que bajar todavía.
        sinInstalador: !pkg
    };
}

module.exports = { DEFAULTS, comparar, instalador, buscar };
