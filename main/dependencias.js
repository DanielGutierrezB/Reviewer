'use strict';
/**
 * dependencias.js — Instalar desde la app lo que falta en esta Mac.
 *
 * Qué falta y cómo se instala lo decide `engine/dependencias.js`; acá se hace:
 * bajar el modelo y verificarlo, correr `brew install`, abrir la Terminal con
 * el instalador de Homebrew, o abrir el instalador de las herramientas de
 * Apple. La ventana va viendo el avance por `dependencias-progreso`.
 *
 * Dos reglas que no se negocian:
 *
 * - **Nada que pida contraseña se hace por la persona.** Homebrew la pide, así
 *   que se abre la Terminal con su comando oficial y se le dice que siga ahí.
 *   Las herramientas de Apple abren su propio instalador. Lo que la app hace
 *   sola es solo lo que cabe en la carpeta del usuario.
 * - **Lo que se baja se verifica.** El modelo se compara contra el SHA-256 con
 *   el que se probó la app antes de moverlo a su lugar; si no coincide se
 *   borra y se dice. Un modelo distinto del que se midió no es un detalle.
 */

const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { ipcMain } = require('electron');

const dependenciasLib = require('../engine/dependencias');

let puente = { mandar: () => {}, anotar: () => {} };

/** clave → AbortController de lo que se está instalando. */
const enCurso = new Map();

/**
 * Baja un archivo siguiendo redirecciones, contando el avance.
 *
 * Hugging Face contesta con una redirección a su CDN; sin seguirla se bajaría
 * un HTML de 300 bytes que después no pasa la verificación, con un mensaje
 * que no dice qué pasó.
 */
function bajar(url, destino, { signal, alProgreso, saltos = 0 }) {
    return new Promise((resolve, reject) => {
        if (saltos > 5) return reject(new Error('Demasiadas redirecciones.'));
        const pedido = https.get(url, { signal, headers: { 'User-Agent': 'Reviewer' } }, res => {
            if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
                res.resume();
                return resolve(bajar(new URL(res.headers.location, url).href, destino, { signal, alProgreso, saltos: saltos + 1 }));
            }
            if (res.statusCode !== 200) {
                res.resume();
                return reject(new Error(`El servidor contestó ${res.statusCode}.`));
            }
            const total = Number(res.headers['content-length']) || 0;
            let bajado = 0;
            // Un aviso por trozo de red son treinta mil en una descarga de
            // quince segundos, todos cruzando a la ventana. Se avisa cuando
            // cambia el porcentaje o pasaron 300 ms, lo que venga primero.
            let ultimoPct = -1;
            let ultimoAviso = 0;
            const archivo = fs.createWriteStream(destino);
            res.on('data', trozo => {
                bajado += trozo.length;
                const pct = total ? Math.round(100 * bajado / total) : null;
                const ahora = Date.now();
                if (pct === ultimoPct && ahora - ultimoAviso < 300) return;
                ultimoPct = pct;
                ultimoAviso = ahora;
                alProgreso({ pct, texto: `${dependenciasLib.mega(bajado)} de ${dependenciasLib.mega(total)}` });
            });
            res.pipe(archivo);
            archivo.on('finish', () => archivo.close(() => resolve()));
            archivo.on('error', reject);
            res.on('error', reject);
        });
        pedido.on('error', reject);
    });
}

function sha256De(archivo) {
    return new Promise((resolve, reject) => {
        const h = crypto.createHash('sha256');
        fs.createReadStream(archivo).on('data', c => h.update(c)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
    });
}

async function descargarModelo(d, alProgreso) {
    const m = dependenciasLib.MODELOS[d.modelo];
    const dir = path.join(dependenciasLib.CARPETA_USUARIO, 'models');
    fs.mkdirSync(dir, { recursive: true });
    const parcial = path.join(dir, `${d.modelo}.bajando`);
    const control = new AbortController();
    enCurso.set(d.clave, control);
    try {
        await bajar(m.url, parcial, { signal: control.signal, alProgreso });
        alProgreso({ pct: 100, texto: 'Verificando que llegó entero…' });
        if (await sha256De(parcial) !== m.sha256) {
            fs.rmSync(parcial, { force: true });
            return { ok: false, error: 'El archivo que llegó no es el modelo esperado: no coincide su huella. Probá de nuevo.' };
        }
        fs.renameSync(parcial, path.join(dir, d.modelo));
        return { ok: true };
    } catch (e) {
        fs.rmSync(parcial, { force: true });
        return { ok: false, error: e.name === 'AbortError' ? 'Descarga cancelada.' : `No se pudo bajar: ${e.message}` };
    } finally {
        enCurso.delete(d.clave);
    }
}

/** Corre un programa y va contando su última línea. */
function correr(bin, args, alProgreso, env = {}) {
    return new Promise(resolve => {
        const hijo = spawn(bin, args, { env: { ...process.env, ...env } });
        let ultima = '';
        const leer = d => {
            const lineas = String(d).split('\n').map(x => x.trim()).filter(Boolean);
            if (lineas.length) {
                ultima = lineas[lineas.length - 1];
                alProgreso({ texto: ultima.slice(0, 120) });
            }
        };
        hijo.stdout.on('data', leer);
        hijo.stderr.on('data', leer);
        hijo.on('error', err => resolve({ ok: false, error: err.message }));
        hijo.on('close', codigo => resolve(codigo === 0 ? { ok: true } : { ok: false, error: ultima || `terminó con ${codigo}` }));
    });
}

function abrirTerminalCon(comando) {
    const guion = `tell application "Terminal"\nactivate\ndo script ${JSON.stringify(comando)}\nend tell`;
    return correr('/usr/bin/osascript', ['-e', guion], () => {});
}

/**
 * Instala una dependencia.
 *
 * @returns {Promise<{ok: boolean, error?: string, mensaje?: string, sigue?: boolean}>}
 *   `sigue` es que la instalación siguió afuera —la Terminal, el instalador de
 *   Apple— y hay que volver a mirar cuando termine.
 */
async function instalar(clave, alProgreso) {
    const d = dependenciasLib.LISTA.find(x => x.clave === clave);
    if (!d) return { ok: false, error: `No sé instalar «${clave}».` };
    if (enCurso.has(clave)) return { ok: false, error: 'Ya se está instalando.' };

    const accion = dependenciasLib.accionDe(d);
    switch (accion.tipo) {
        case 'descargar':
            return descargarModelo(d, alProgreso);
        case 'brew': {
            alProgreso({ texto: `brew install ${d.brew}…` });
            const r = await correr(dependenciasLib.brew(), ['install', d.brew], alProgreso, {
                // Sin preguntar nada y sin ponerse a actualizar Homebrew entero.
                NONINTERACTIVE: '1', HOMEBREW_NO_AUTO_UPDATE: '1', HOMEBREW_NO_INSTALL_CLEANUP: '1'
            });
            return r.ok ? { ok: true } : { ok: false, error: `Homebrew no pudo: ${r.error}` };
        }
        case 'homebrew': {
            const r = await abrirTerminalCon('/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"');
            return r.ok
                ? { ok: true, sigue: true, mensaje: 'Seguí en la Terminal. Cuando Homebrew termine, volvé y apretá «Instalar con Homebrew».' }
                : { ok: false, error: 'No se pudo abrir la Terminal.' };
        }
        case 'xcode': {
            const r = await correr('/usr/bin/xcode-select', ['--install'], alProgreso);
            return {
                ok: true,
                sigue: true,
                mensaje: r.ok
                    ? 'Se abrió el instalador de Apple. Cuando termine, volvé acá.'
                    : 'Las herramientas de Apple ya parecen estar, o su instalador ya está abierto.'
            };
        }
        default:
            return { ok: false, error: accion.nota || 'Esto viene con el instalador completo de Reviewer.' };
    }
}

function registrar(dependencias) {
    puente = { ...puente, ...dependencias };

    ipcMain.handle('dependencias-estado', () => dependenciasLib.estado());

    ipcMain.handle('dependencias-instalar', async (e, clave) => {
        const empezo = Date.now();
        const r = await instalar(clave, avance => puente.mandar('dependencias-progreso', { clave, ...avance }));
        puente.anotar('dependencias.instalar', { clave, ok: r.ok, sigue: Boolean(r.sigue), ms: Date.now() - empezo, error: r.error || null });
        return r;
    });

    ipcMain.handle('dependencias-cancelar', (e, clave) => {
        const c = enCurso.get(clave);
        if (c) c.abort();
        return Boolean(c);
    });
}

module.exports = { registrar, instalar };
