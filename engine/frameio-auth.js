'use strict';
/**
 * frameio-auth.js — El OAuth de Adobe, que es con lo que entra Frame.io.
 *
 * **Reviewer nunca ve la contraseña.** Abre el navegador en la página de Adobe,
 * la persona entra ahí con su usuario, y lo único que vuelve a la app es un
 * código de un solo uso que se cambia por un token.
 *
 * **PKCE y no un secreto de cliente.** Una app de escritorio no puede guardar un
 * secreto: está adentro del `.app` que cualquiera puede abrir. PKCE (RFC 7636)
 * resuelve justo eso: la app inventa un verificador al azar, manda su hash al
 * pedir la autorización, y al canjear el código manda el verificador. Sin él,
 * el código no sirve ni aunque alguien lo intercepte.
 *
 * **La vuelta entra por 127.0.0.1 y no por un esquema propio.** Las dos cosas
 * funcionan, pero el servidor local es lo que recomienda la RFC 8252 para apps
 * de escritorio, y acá además evita un problema concreto: un esquema
 * `adobe+<hash>://` hay que declararlo en `package.json` al compilar, y ese
 * hash lo asigna Adobe al crear la credencial. Con loopback, la app anda igual
 * en desarrollo y empaquetada, y no hay nada que registrar en el sistema.
 *
 * Acá no se guarda nada ni se abre ningún navegador: esto arma URLs, escucha la
 * vuelta y habla con Adobe. Quién abre el navegador y dónde se guarda el token
 * —cifrado con el Llavero— es `main/frameio.js`, que es el que puede tocar el
 * sistema. Esa separación es la que deja probar el canje y el refresco contra
 * un Adobe de juguete, sin ventana.
 */

const crypto = require('crypto');
const http = require('http');
const https = require('https');

/** Dónde vive el OAuth de Adobe. Las pruebas lo apuntan a un servidor local. */
const IMS = process.env.REVIEWER_IMS_BASE || 'https://ims-na1.adobelogin.com';

/**
 * Lo que se le pide a la cuenta.
 *
 * `offline_access` es el que hace que Adobe devuelva un token de refresco: sin
 * él habría que volver a iniciar sesión cada hora, que es lo que dura el de
 * acceso.
 */
const PERMISOS = 'openid, email, profile, offline_access, additional_info.roles';

/**
 * El puerto donde se escucha la vuelta del navegador.
 *
 * Uno fijo y no «el primero libre»: Adobe compara el `redirect_uri` del pedido
 * contra los patrones registrados en la credencial, carácter por carácter. Si
 * la app se mudara de puerto porque el primero estaba ocupado, el regreso
 * dejaría de coincidir y Adobe mandaría a la persona a otro lado sin decir por
 * qué. Es mejor fallar diciendo que el puerto está ocupado.
 */
const PUERTO = 43110;

/** A dónde vuelve el navegador. Es lo que hay que registrar en Adobe. */
const REDIRECT = `http://127.0.0.1:${PUERTO}/callback`;

const base64url = b => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** El par del PKCE y el `state`, todo al azar y de un solo uso. */
function pkce() {
    const verificador = base64url(crypto.randomBytes(48));
    return {
        verificador,
        desafio: base64url(crypto.createHash('sha256').update(verificador).digest()),
        // Contra un código inyectado desde afuera: si la vuelta no trae este
        // mismo valor, no es la respuesta a nuestro pedido.
        estado: base64url(crypto.randomBytes(16))
    };
}

/** La página de Adobe a la que se manda a la persona. */
function urlDeAutorizacion({ clientId, desafio, estado, redirect = REDIRECT, ims = IMS }) {
    const url = new URL(`${ims}/ims/authorize/v2`);
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirect);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', PERMISOS);
    url.searchParams.set('code_challenge', desafio);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('state', estado);
    return url.href;
}

const agente = url => (String(url).startsWith('https:') ? https : http);

/** Un POST con cuerpo de formulario, que es lo que come IMS. */
function postForm(url, campos) {
    const cuerpo = new URLSearchParams(campos).toString();
    return new Promise((resolve, reject) => {
        const pedido = agente(url).request(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(cuerpo),
                'User-Agent': 'Reviewer'
            },
            timeout: 20_000
        }, respuesta => {
            let texto = '';
            respuesta.setEncoding('utf8');
            respuesta.on('data', t => { texto += t; });
            respuesta.on('error', reject);
            respuesta.on('end', () => {
                let datos = null;
                try { datos = JSON.parse(texto); } catch (e) { /* IMS a veces contesta texto pelado */ }
                if (respuesta.statusCode >= 400) {
                    const detalle = (datos && (datos.error_description || datos.error)) || texto.slice(0, 200);
                    reject(new Error(`Adobe contestó ${respuesta.statusCode}: ${detalle}`));
                    return;
                }
                resolve(datos || {});
            });
        });
        pedido.on('timeout', () => pedido.destroy(new Error('Adobe no contestó a tiempo')));
        pedido.on('error', reject);
        pedido.write(cuerpo);
        pedido.end();
    });
}

/**
 * Levanta el servidor que recibe la vuelta del navegador.
 *
 * Escucha ANTES de que nadie abra nada, y por eso devuelve una promesa de dos
 * tiempos: primero queda escuchando, después llega el código. Si se abriera el
 * navegador antes de estar escuchando, una vuelta rápida —una sesión de Adobe
 * ya iniciada vuelve en menos de un segundo— se perdería.
 *
 * Tiene plazo: si alguien abre el navegador y se va a almorzar, el servidor no
 * se queda escuchando el resto de la sesión.
 */
async function abrirRetorno(estado, { puerto = PUERTO, plazoMs = 5 * 60_000 } = {}) {
    const servidor = http.createServer();
    let resolver;
    let rechazar;
    const codigo = new Promise((si, no) => { resolver = si; rechazar = no; });
    // Un rechazo sin nadie esperando tumba el proceso entero, y acá puede pasar:
    // esta promesa se devuelve y recién después alguien la espera, mientras el
    // navegador ya podría haber vuelto con un error. Este `catch` vacío la deja
    // siempre atendida; quien la espera de verdad sigue recibiendo el error.
    codigo.catch(() => {});
    let reloj = null;
    const cerrar = () => {
        clearTimeout(reloj);
        try { servidor.close(); } catch (e) { /* ya estaba */ }
    };

    servidor.on('request', (req, res) => {
        const url = new URL(req.url, `http://127.0.0.1:${puerto}`);
        if (!url.pathname.startsWith('/callback')) {
            res.writeHead(404).end();
            return;
        }
        const code = url.searchParams.get('code');
        const devuelto = url.searchParams.get('state');
        const error = url.searchParams.get('error_description') || url.searchParams.get('error');

        // Al navegador se le contesta algo: sin esto queda mostrando un error de
        // conexión y parece que falló, justo cuando salió bien.
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<!doctype html><meta charset="utf-8"><title>Reviewer</title>'
            + '<body style="font:15px -apple-system,sans-serif;padding:3rem;text-align:center;color:#222"><p>'
            + (error ? 'No se pudo conectar con Frame.io.' : 'Listo. Ya podés cerrar esta pestaña y volver a Reviewer.')
            + '</p>');

        cerrar();
        if (error) rechazar(new Error(error));
        else if (devuelto !== estado) rechazar(new Error('La respuesta de Adobe no corresponde a este pedido.'));
        else if (!code) rechazar(new Error('Adobe no devolvió el código.'));
        else resolver(code);
    });

    await new Promise((listo, falla) => {
        servidor.once('error', err => falla(err.code === 'EADDRINUSE'
            ? new Error(`El puerto ${puerto} está ocupado por otro programa. Cerralo y probá de nuevo.`)
            : err));
        servidor.listen(puerto, '127.0.0.1', listo);
    });
    reloj = setTimeout(() => { cerrar(); rechazar(new Error('Se agotó el tiempo esperando a Adobe.')); }, plazoMs);
    if (reloj.unref) reloj.unref();

    return { codigo, cerrar, puerto };
}

/** Lo que se guarda de una respuesta de Adobe, con el vencimiento ya resuelto. */
function tokensDe(respuesta, previos) {
    return {
        acceso: respuesta.access_token || null,
        // Al refrescar, Adobe no siempre manda uno nuevo: el anterior sigue
        // valiendo, y tirarlo obligaría a volver a iniciar sesión a la hora.
        refresco: respuesta.refresh_token || (previos && previos.refresco) || null,
        vence: Date.now() + (Number(respuesta.expires_in) || 3600) * 1000,
        quien: (previos && previos.quien) || null
    };
}

/** Cambia el código de un solo uso por los tokens. */
async function canjear({ clientId, codigo, verificador, redirect = REDIRECT, ims = IMS }) {
    return tokensDe(await postForm(`${ims}/ims/token/v3`, {
        grant_type: 'authorization_code',
        client_id: clientId,
        code: codigo,
        code_verifier: verificador,
        redirect_uri: redirect
    }));
}

/** Pide uno de acceso nuevo con el de refresco. */
async function refrescar({ clientId, refresco, previos, ims = IMS }) {
    return tokensDe(await postForm(`${ims}/ims/token/v3`, {
        grant_type: 'refresh_token',
        client_id: clientId,
        refresh_token: refresco
    }), previos);
}

/**
 * Invalida los tokens del lado de Adobe.
 *
 * Los dos a la vez y sin que importe si falla: lo que no puede quedar es el
 * token guardado en el disco, y de eso se encarga quien llama.
 */
async function revocar({ clientId, acceso, refresco, ims = IMS }) {
    const url = `${ims}/ims/revoke?client_id=${encodeURIComponent(clientId)}`;
    await Promise.allSettled([
        acceso && postForm(url, { token: acceso, token_type_hint: 'access_token' }),
        refresco && postForm(url, { token: refresco, token_type_hint: 'refresh_token' })
    ].filter(Boolean));
}

module.exports = { REDIRECT, pkce, urlDeAutorizacion, abrirRetorno, canjear, refrescar, revocar };
