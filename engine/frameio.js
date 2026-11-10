'use strict';
/**
 * frameio.js — Hablarle a la API de Frame.io: carpetas, archivos, versiones y
 * comentarios.
 *
 * Es el único archivo que sabe cómo se llaman los endpoints y qué forma tiene
 * lo que contestan. Todo lo demás del motor trabaja con objetos nuestros: la
 * traducción de un comentario vive en `frameio-convertir.js`, el estado de qué
 * render es qué archivo en `frameio-vinculo.js`, y el token y las colas en
 * `main/frameio.js`, que es el que puede tocar el disco y el sistema.
 *
 * **Nada de acá guarda un secreto.** Recibe el token y lo manda en la cabecera.
 * Quién lo consigue, lo renueva y lo guarda es `main/frameio.js`, y lo guarda
 * cifrado con el Llavero. Acá el token puede ser una función: así una llamada
 * que arranca con el token por vencer lo pide de nuevo antes de salir, en vez
 * de fallar con un 401 que el llamador tendría que interpretar.
 *
 * **Los errores vienen escritos, no lanzados a medias.** Un 401, un 403 y un
 * 404 significan cosas muy distintas para el editor —tu sesión venció, no
 * tenés permiso en esa carpeta, ese archivo ya no está— y los tres llegan como
 * un `Error` con `estado` y un `mensaje` en castellano, armado con el `detail`
 * que manda Frame.io. Un 429 no llega nunca: se espera lo que diga
 * `Retry-After` y se reintenta, porque los límites de esta API son bajos —10
 * llamadas por minuto para editar un comentario o armar una pila— y toparse
 * con ellos es parte del uso normal, no una falla.
 */

const https = require('https');
const http = require('http');

const DEFAULTS = {
    // Las pruebas lo apuntan a un servidor local, para recorrer el camino de
    // verdad —cabeceras, paginado, 429, errores— sin tocar una cuenta real.
    _base: process.env.REVIEWER_FRAMEIO_BASE || 'https://api.frame.io',
    timeoutMs: 20_000,
    // Cuántas veces se vuelve a intentar un 429 o una caída de red antes de
    // rendirse. Tres son unos minutos en el peor caso, que es menos de lo que
    // tarda en subir un render.
    reintentos: 3
};

/** http o https según la url, que en las pruebas no es la de Frame.io. */
const agente = url => (String(url).startsWith('https:') ? https : http);

const esperar = ms => new Promise(listo => setTimeout(listo, ms));

/**
 * Un error de la API, ya escrito para mostrárselo a una persona.
 *
 * `estado` se conserva aparte del texto porque hay dos que el llamador trata
 * distinto: el 401 manda a reconectar y el 404 significa que algo se borró del
 * otro lado, que no es una avería sino un cambio que hay que reflejar.
 */
function fallo(estado, detalle) {
    const textos = {
        401: 'La sesión de Frame.io venció. Volvé a conectar desde Ajustes.',
        403: 'Tu cuenta de Frame.io no tiene permiso para eso.',
        404: 'Eso ya no está en Frame.io.',
        422: 'Frame.io rechazó el pedido.'
    };
    const e = new Error(detalle ? `${textos[estado] || `Frame.io contestó ${estado}`} ${detalle}`.trim() : (textos[estado] || `Frame.io contestó ${estado}`));
    e.estado = estado;
    return e;
}

/** El `detail` del cuerpo de error, que es lo único que de verdad explica qué pasó. */
function detalleDe(cuerpo) {
    try {
        const d = JSON.parse(cuerpo);
        const uno = (d.errors || [])[0] || {};
        return [uno.title, uno.detail].filter(Boolean).join(': ');
    } catch (e) {
        return '';
    }
}

/**
 * Una llamada, con su cuerpo leído entero.
 *
 * Devuelve `{ estado, cabeceras, texto }` sin interpretar nada: quién decide
 * si eso es un error es `pedir`, que es también el que reintenta.
 */
function llamar(url, { metodo, cabeceras, cuerpo, timeoutMs }) {
    return new Promise((resolve, reject) => {
        let reloj = null;
        const terminar = fn => (valor => { clearTimeout(reloj); fn(valor); });
        const listo = terminar(resolve);
        const fallar = terminar(reject);

        const pedido = agente(url).request(url, { method: metodo, headers: cabeceras, timeout: timeoutMs }, respuesta => {
            let texto = '';
            respuesta.setEncoding('utf8');
            respuesta.on('data', t => { texto += t; });
            respuesta.on('error', fallar);
            respuesta.on('end', () => listo({ estado: respuesta.statusCode, cabeceras: respuesta.headers, texto }));
        });

        // Dos topes y no uno: el `timeout` del pedido mide el socket quieto, y
        // un servidor que manda un byte cada diez segundos no lo dispara nunca.
        reloj = setTimeout(() => pedido.destroy(new Error('Frame.io no contestó a tiempo')), timeoutMs);
        pedido.on('timeout', () => pedido.destroy(new Error('Frame.io no contestó a tiempo')));
        pedido.on('error', fallar);
        if (cuerpo) pedido.write(cuerpo);
        pedido.end();
    });
}

/**
 * Cuánto esperar antes de reintentar un 429.
 *
 * `Retry-After` llega en segundos. Si no viene, se espera de a más cada vez:
 * los límites de esta API se recargan de a poco —es un «balde que gotea», no
 * una ventana que se abre de golpe— así que insistir enseguida vuelve a fallar.
 */
function esperaDe(cabeceras, intento) {
    const dice = parseInt((cabeceras || {})['retry-after'], 10);
    if (Number.isFinite(dice) && dice > 0) return Math.min(dice, 60) * 1000;
    return Math.min(2 ** intento, 30) * 1000;
}

/**
 * Un cliente atado a un token y, casi siempre, a una cuenta.
 *
 * Es una fábrica y no funciones sueltas porque el token y el `account_id` van
 * en TODAS las llamadas: pasarlos de parámetro en cada una sería repetirlos
 * cincuenta veces y dejar que una se olvide.
 *
 * @param {object} opciones
 * @param {string|(() => Promise<string>)} opciones.token  el Bearer, o cómo conseguirlo
 * @param {string} [opciones.cuenta]  el `account_id`; va en casi todas las rutas
 */
function cliente(opciones = {}) {
    const base = opciones._base || DEFAULTS._base;
    const timeoutMs = opciones.timeoutMs || DEFAULTS.timeoutMs;
    const reintentos = Number.isFinite(opciones.reintentos) ? opciones.reintentos : DEFAULTS.reintentos;
    const dameToken = typeof opciones.token === 'function' ? opciones.token : () => opciones.token;
    const cuenta = opciones.cuenta || null;

    /** Dónde está una ruta de la cuenta. Sin cuenta, no hay nada que pedir. */
    function enLaCuenta(ruta) {
        if (!cuenta) throw new Error('Falta saber de qué cuenta de Frame.io es esto.');
        return `/v4/accounts/${encodeURIComponent(cuenta)}${ruta}`;
    }

    async function pedir(ruta, { metodo = 'GET', datos = null, query = null } = {}) {
        const token = await dameToken();
        if (!token) throw fallo(401, '');

        const url = new URL(ruta.startsWith('http') ? ruta : `${base}${ruta}`);
        for (const [k, v] of Object.entries(query || {})) {
            if (v !== null && v !== undefined && v !== '') url.searchParams.set(k, String(v));
        }
        const cuerpo = datos ? JSON.stringify({ data: datos }) : null;
        const cabeceras = {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
            // Sin User-Agent algunos intermediarios contestan 403 sin explicar.
            'User-Agent': 'Reviewer',
            ...(cuerpo ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(cuerpo) } : {})
        };

        for (let intento = 0; ; intento++) {
            let r;
            try {
                r = await llamar(url.href, { metodo, cabeceras, cuerpo, timeoutMs });
            } catch (err) {
                // Una caída de red se reintenta igual que un 429: el Wi-Fi que
                // se cae medio segundo no tiene por qué cortar una subida.
                if (intento >= reintentos) throw err;
                await esperar(esperaDe(null, intento));
                continue;
            }

            if (r.estado === 429 && intento < reintentos) {
                await esperar(esperaDe(r.cabeceras, intento));
                continue;
            }
            if (r.estado === 204 || !r.texto) {
                if (r.estado >= 400) throw fallo(r.estado, '');
                return null;
            }
            if (r.estado >= 400) throw fallo(r.estado, detalleDe(r.texto));

            try {
                return JSON.parse(r.texto).data;
            } catch (e) {
                throw new Error('Frame.io contestó algo que no se entiende.');
            }
        }
    }

    /**
     * Una lista entera, siguiendo el cursor.
     *
     * **El `links.next` de Frame.io solo lleva el `after`.** El resto de los
     * parámetros —`include`, `sort`, `page_size`— no viajan en ese enlace y hay
     * que volver a ponerlos en cada pedido: seguirlo tal cual trae la segunda
     * página sin las respuestas ni el autor, que es justo lo que se había
     * pedido. Por eso acá se saca solo el cursor y se rearma la consulta.
     */
    async function todas(ruta, query = {}) {
        const juntas = [];
        let after = null;
        // Tope de páginas por si un cursor se repite: mil comentarios en un
        // archivo ya es muchísimo, y un lazo infinito contra una API con
        // límites deja la app pidiendo para siempre.
        for (let pagina = 0; pagina < 50; pagina++) {
            const token = await dameToken();
            if (!token) throw fallo(401, '');
            const url = new URL(`${base}${ruta}`);
            for (const [k, v] of Object.entries({ ...query, after })) {
                if (v !== null && v !== undefined && v !== '') url.searchParams.set(k, String(v));
            }
            const r = await llamar(url.href, {
                metodo: 'GET',
                cabeceras: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'User-Agent': 'Reviewer' },
                cuerpo: null,
                timeoutMs
            });
            if (r.estado === 429) {
                await esperar(esperaDe(r.cabeceras, pagina));
                pagina--;
                continue;
            }
            if (r.estado >= 400) throw fallo(r.estado, detalleDe(r.texto));

            let cuerpo;
            try { cuerpo = JSON.parse(r.texto); } catch (e) { throw new Error('Frame.io contestó algo que no se entiende.'); }
            juntas.push(...(cuerpo.data || []));

            const siguiente = cuerpo.links && cuerpo.links.next;
            if (!siguiente) break;
            const cursor = new URL(siguiente, base).searchParams.get('after');
            if (!cursor || cursor === after) break;
            after = cursor;
        }
        return juntas;
    }

    return {
        cuenta,

        /** Quién sos, para mostrarlo en Ajustes y comprobar que el token sirve. */
        yo: () => pedir('/v4/me'),

        // ── La ruta: dónde se guardan los renders ─────────────────────
        cuentas: () => todas('/v4/accounts'),
        workspaces: () => todas(enLaCuenta('/workspaces')),
        proyectos: workspaceId => todas(enLaCuenta(`/workspaces/${encodeURIComponent(workspaceId)}/projects`)),
        proyecto: proyectoId => pedir(enLaCuenta(`/projects/${encodeURIComponent(proyectoId)}`)),
        /** Lo que hay dentro de una carpeta: archivos, carpetas y pilas de versiones. */
        hijos: carpetaId => todas(enLaCuenta(`/folders/${encodeURIComponent(carpetaId)}/children`)),
        /** Las versiones de una pila, de la más vieja a la más nueva. */
        versionesDe: pilaId => todas(enLaCuenta(`/version_stacks/${encodeURIComponent(pilaId)}/children`)),

        // ── Subir ─────────────────────────────────────────────────────
        /**
         * Reserva el archivo y devuelve las URLs firmadas donde subirlo.
         *
         * El `media_type` que se declara acá es el que después hay que mandar
         * como `Content-Type` en cada parte: si no coinciden, S3 rechaza la
         * firma y la subida falla sin decir por qué.
         */
        crearArchivoLocal: (carpetaId, { nombre, bytes, tipo }) => pedir(
            enLaCuenta(`/folders/${encodeURIComponent(carpetaId)}/files/local_upload`),
            { metodo: 'POST', datos: { name: nombre, file_size: bytes, media_type: tipo } }
        ),
        /** Si Frame.io ya recibió y transcodificó el archivo. */
        estadoDeSubida: fileId => pedir(enLaCuenta(`/files/${encodeURIComponent(fileId)}/status`)),
        archivo: fileId => pedir(enLaCuenta(`/files/${encodeURIComponent(fileId)}`)),

        // ── Versionar ─────────────────────────────────────────────────
        /** Apila dos a diez archivos de la MISMA carpeta, del más viejo al más nuevo. */
        crearPila: (carpetaId, fileIds) => pedir(
            enLaCuenta(`/folders/${encodeURIComponent(carpetaId)}/version_stacks`),
            { metodo: 'POST', datos: { file_ids: fileIds } }
        ),
        /** Mueve un archivo a una carpeta o, que es para lo que se usa, a una pila. */
        mover: (fileId, padreId) => pedir(
            enLaCuenta(`/files/${encodeURIComponent(fileId)}/move`),
            { metodo: 'PATCH', datos: { parent_id: padreId } }
        ),

        // ── Comentarios ───────────────────────────────────────────────
        /**
         * Los comentarios de un archivo, con sus respuestas y su autor.
         *
         * `timestamp_as_timecode=false` a propósito: así el instante llega como
         * número de cuadro, que es lo que Reviewer necesita para convertirlo
         * con los fps que midió ffprobe. En timecode habría que parsearlo y
         * adivinar si es drop frame.
         */
        comentarios: fileId => todas(enLaCuenta(`/files/${encodeURIComponent(fileId)}/comments`), {
            include: 'replies,owner',
            timestamp_as_timecode: 'false',
            page_size: 100
        }),
        /** Marca un comentario como hecho, o lo reabre. */
        completar: (comentarioId, hecho) => pedir(
            enLaCuenta(`/comments/${encodeURIComponent(comentarioId)}`),
            { metodo: 'PATCH', datos: { completed: Boolean(hecho) } }
        ),

        // Para `frameio-subida.js`, que necesita pedir algo que no es JSON.
        _pedir: pedir,
        _todas: todas
    };
}

module.exports = { DEFAULTS, cliente };
