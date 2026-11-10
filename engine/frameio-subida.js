'use strict';
/**
 * frameio-subida.js — Subir un render a Frame.io, por partes.
 *
 * Frame.io no recibe el archivo: reserva un hueco y devuelve una lista de URLs
 * firmadas de S3, una por parte. Subir es mandar cada parte a la suya y
 * después preguntar hasta que el archivo figure recibido.
 *
 * Tres cosas que no son opcionales, y que si faltan fallan de maneras que no se
 * entienden:
 *
 * 1. **El `Content-Type` de cada parte tiene que ser el mismo `media_type` que
 *    se declaró al reservar.** Está dentro de la firma: si no coincide, S3
 *    contesta 403 sin decir qué pasó.
 * 2. **`x-amz-acl: private` en cada parte.** También firmado.
 * 3. **Las partes van del tamaño que Frame.io dijo.** La respuesta trae el
 *    `size` de cada una; calcularlo a ojo dividiendo el archivo deja la última
 *    parte corta y el archivo llega roto, pero «subido».
 *
 * **Del disco se lee por rangos.** Un render de 600 MB no entra en memoria y no
 * tiene por qué: cada parte es un `createReadStream` con `start` y `end`. Lo
 * que hace que esto se pueda cortar y reintentar es que ninguna parte depende
 * de la anterior.
 *
 * Una parte que falla se reintenta; una subida que se corta se abandona entera
 * y se rehace desde cero la próxima vez. No se retoma a la mitad a propósito:
 * las URLs firmadas vencen, y un archivo a medio subir en Frame.io es peor que
 * uno que no está, porque parece que está.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

/** Cuántas veces se reintenta UNA parte antes de dar la subida por perdida. */
const REINTENTOS = 3;

/** Cada cuánto se pregunta si Frame.io ya lo recibió, y hasta cuándo. */
const ESPERA_ESTADO_MS = 2_000;
const ESPERA_ESTADO_TOPE = 150;

/** Lo que Frame.io considera recibido. `transcoded` es recibido y ya procesado. */
const RECIBIDO = ['uploaded', 'transcoded'];

const agente = url => (String(url).startsWith('https:') ? https : http);
const esperar = ms => new Promise(listo => setTimeout(listo, ms));

/** El `media_type` de un render por su extensión. Frame.io lo exige al reservar. */
function tipoDe(ruta) {
    const ext = path.extname(ruta).toLowerCase();
    return {
        '.mp4': 'video/mp4',
        '.m4v': 'video/x-m4v',
        '.mov': 'video/quicktime',
        '.mkv': 'video/x-matroska',
        '.webm': 'video/webm',
        '.avi': 'video/x-msvideo',
        '.mxf': 'application/mxf'
    }[ext] || 'application/octet-stream';
}

/**
 * De qué byte a qué byte va cada parte.
 *
 * Se usan los tamaños que mandó Frame.io. Solo si no vinieran se reparte en
 * partes iguales, que es lo que hace su propio ejemplo, y la última se estira
 * hasta el final para no dejar bytes afuera por el redondeo.
 */
function tramos(urls, bytes) {
    const declarados = urls.every(u => Number.isFinite(Number(u.size)) && Number(u.size) > 0);
    const salida = [];
    let desde = 0;
    for (let i = 0; i < urls.length; i++) {
        const largo = declarados
            ? Number(urls[i].size)
            : (i === urls.length - 1 ? bytes - desde : Math.ceil(bytes / urls.length));
        salida.push({ url: urls[i].url, desde, hasta: Math.min(desde + largo, bytes) - 1, bytes: Math.min(desde + largo, bytes) - desde });
        desde += largo;
    }
    return salida;
}

/** Manda un tramo del archivo a su URL firmada. */
function subirTramo(ruta, tramo, tipo, signal) {
    return new Promise((resolve, reject) => {
        if (signal && signal.aborted) return reject(new Error('cancelado'));

        const pedido = agente(tramo.url).request(tramo.url, {
            method: 'PUT',
            headers: {
                // Los tres van firmados; cambiar uno invalida la firma.
                'Content-Type': tipo,
                'x-amz-acl': 'private',
                'Content-Length': tramo.bytes
            }
        }, respuesta => {
            respuesta.resume();
            if (respuesta.statusCode === 200) resolve();
            else reject(new Error(`la parte contestó ${respuesta.statusCode}`));
        });

        pedido.on('error', reject);
        const lectura = fs.createReadStream(ruta, { start: tramo.desde, end: tramo.hasta });
        lectura.on('error', err => { pedido.destroy(); reject(err); });
        if (signal) {
            signal.addEventListener('abort', () => {
                lectura.destroy();
                pedido.destroy();
                reject(new Error('cancelado'));
            }, { once: true });
        }
        lectura.pipe(pedido);
    });
}

/**
 * Sube un render y devuelve el archivo de Frame.io.
 *
 * @param {object} api         un `frameio.cliente(...)`
 * @param {string} carpetaId   dónde va
 * @param {string} ruta        el render en el disco
 * @param {object} [opciones]
 * @param {string} [opciones.nombre]      con qué nombre se guarda; por defecto el del archivo
 * @param {(a: {pct: number, bytes: number, total: number}) => void} [opciones.alAvanzar]
 * @param {AbortSignal} [opciones.signal]
 * @returns {Promise<{ok: boolean, archivo?: object, error?: string, cancelado?: boolean}>}
 */
async function subir(api, carpetaId, ruta, opciones = {}) {
    const { alAvanzar = () => {}, signal } = opciones;
    const nombre = opciones.nombre || path.basename(ruta);

    let bytes;
    try {
        bytes = fs.statSync(ruta).size;
    } catch (e) {
        return { ok: false, error: `Ese render ya no está en el disco: ${nombre}` };
    }
    if (!bytes) return { ok: false, error: `Ese render está vacío: ${nombre}` };

    const tipo = tipoDe(ruta);
    let creado;
    try {
        creado = await api.crearArchivoLocal(carpetaId, { nombre, bytes, tipo });
    } catch (err) {
        return { ok: false, error: `No se pudo reservar el archivo en Frame.io: ${err.message}` };
    }

    const urls = creado.upload_urls || [];
    if (!urls.length) return { ok: false, error: 'Frame.io no devolvió dónde subir el archivo.' };

    // El `media_type` que Frame.io registró manda sobre el que pedimos: es el
    // que quedó dentro de la firma de cada parte.
    const tipoFirmado = creado.media_type || tipo;
    const partes = tramos(urls, bytes);
    let subidos = 0;
    alAvanzar({ pct: 0, bytes: 0, total: bytes });

    for (const tramo of partes) {
        let ultimo = null;
        for (let intento = 0; intento <= REINTENTOS; intento++) {
            if (signal && signal.aborted) return { ok: false, cancelado: true, error: 'Subida cancelada.' };
            try {
                await subirTramo(ruta, tramo, tipoFirmado, signal);
                ultimo = null;
                break;
            } catch (err) {
                if (err.message === 'cancelado') return { ok: false, cancelado: true, error: 'Subida cancelada.' };
                ultimo = err;
                if (intento < REINTENTOS) await esperar(Math.min(2 ** intento, 8) * 1000);
            }
        }
        if (ultimo) return { ok: false, error: `No se pudo subir una parte de ${nombre}: ${ultimo.message}` };
        subidos += tramo.bytes;
        alAvanzar({ pct: Math.floor(100 * subidos / bytes), bytes: subidos, total: bytes });
    }

    // Recién cuando Frame.io lo da por recibido se puede apilar o comentar: un
    // archivo en `created` todavía no existe para el resto de la API.
    for (let vuelta = 0; vuelta < ESPERA_ESTADO_TOPE; vuelta++) {
        if (signal && signal.aborted) return { ok: false, cancelado: true, error: 'Subida cancelada.' };
        let estado;
        try {
            estado = await api.estadoDeSubida(creado.id);
        } catch (err) {
            // Un 404 recién subido es el índice que todavía no lo ve; se
            // vuelve a preguntar. Cualquier otra cosa sí es un problema.
            if (err.estado !== 404) return { ok: false, error: `No se pudo comprobar la subida: ${err.message}` };
            estado = null;
        }
        if (estado && RECIBIDO.includes(estado.status)) {
            return { ok: true, archivo: { ...creado, ...estado, id: creado.id } };
        }
        await esperar(ESPERA_ESTADO_MS);
    }
    return { ok: false, error: `${nombre} se subió pero Frame.io no terminó de procesarlo. Miralo en la web.` };
}

module.exports = { subir, tipoDe, tramos };
