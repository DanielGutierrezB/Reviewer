'use strict';
/**
 * main/frameio.js — Reviewer de intermediario entre Claude y Frame.io.
 *
 * Claude no habla con Frame.io: no puede, porque el plan de la empresa no le
 * deja usar conectores. Así que las dos mitades las hace Reviewer, y Claude
 * sigue leyendo y escribiendo la carpeta `Feedback/` de siempre.
 *
 *   De ida    una entrega de Claude se sube a la carpeta vinculada del curso y
 *             se apila como versión nueva de su clase.
 *   De vuelta los comentarios del equipo bajan a la versión local que les
 *             corresponde, salen en `Feedback/`, y lo que se resuelve acá
 *             —o lo que Claude marca como hecho— queda completado allá.
 *
 * **Tres colas y no una.** Cada cosa tiene su ritmo y su límite, y mezclarlas
 * haría que una subida de 600 MB tape los comentarios durante diez minutos:
 *
 *   subidas      de a una, porque van al mismo ancho de banda y porque el orden
 *                importa: la v2 tiene que estar antes de apilar la v3.
 *   comentarios  cada dos minutos, solo de la carpeta abierta. No hay webhooks
 *                —piden una URL pública y esto es una app de escritorio— así
 *                que se pregunta. El tope de la API es 100 llamadas por minuto
 *                y una vuelta son unas pocas.
 *   completar    con freno, porque editar un comentario son 10 por minuto.
 *
 * **La sincronización se arregla sola.** El empuje de lo resuelto no lleva una
 * libreta de qué se mandó: cada vuelta compara el estado de acá con el que
 * acaba de contestar Frame.io y manda la diferencia. Si una llamada falla, la
 * vuelta siguiente la vuelve a encontrar. Es lo que evita el modo de falla
 * clásico de estas integraciones —una libreta que se desincroniza y nadie sabe
 * cuál de los dos lados tiene razón—.
 */

const fs = require('fs');
const path = require('path');
const { app, ipcMain, safeStorage, shell } = require('electron');

const ajustesLib = require('../engine/ajustes');
const auth = require('../engine/frameio-auth');
const comentariosLib = require('../engine/comentarios');
const convertir = require('../engine/frameio-convertir');
const frameio = require('../engine/frameio');
const subida = require('../engine/frameio-subida');
const vinculo = require('../engine/frameio-vinculo');
const versiones = require('../engine/versiones');

/** Cada cuánto se pregunta por comentarios nuevos. */
const RONDA_MS = 2 * 60_000;

/** Entre dos ediciones de comentario, para no pasarse de 10 por minuto. */
const FRENO_COMPLETAR_MS = 6_500;

/** Cuánto antes de que venza el token se pide uno nuevo. */
const MARGEN_MS = 60_000;

/** El archivo del token, cifrado, en la carpeta de la app. */
const TOKEN = 'frameio.token';

let puente = {
    mandar: () => {},
    anotar: () => {},
    /** `{ raiz, clases }` de la carpeta abierta, o `null`. */
    carpetaAbierta: () => null,
    /** El contexto que `comentarios.js` necesita para reescribir el feedback. */
    contextoDe: () => ({})
};

/** La carpeta de renders que se está mirando, y lo que se sabe de ella. */
let abierta = null;

/** Las subidas: la que corre y las que esperan. */
const cola = [];
let subiendo = null;

/** El estado de Frame.io de cada comentario en la última vuelta: id → completado. */
const remotos = new Map();

/** Lo que falta mandar a Frame.io: id → completado. */
const porCompletar = new Map();
let completando = false;

let reloj = null;
let ultimaTraida = null;

// ─── La sesión ────────────────────────────────────────────────────────
//
// El token vive acá y no en `engine/frameio-auth.js` porque guardarlo pide el
// Llavero, y el Llavero es de Electron. Allá está lo que se puede probar sin
// ventana: el PKCE, las URLs y las llamadas a Adobe.

/** Lo que hay en memoria ahora: `{ acceso, refresco, vence, quien }` o `null`. */
let tokens = null;
let leido = false;
let refrescando = null;

function rutaDelToken() {
    return path.join(app.getPath('userData'), TOKEN);
}

/**
 * Guarda el token cifrado con el Llavero.
 *
 * Si el Llavero no está disponible —pasa en una sesión sin interfaz— **no se
 * guarda en claro**: se pierde al cerrar la app y hay que volver a conectar. Un
 * token de Frame.io en un archivo legible es acceso a los videos y a los
 * comentarios de un curso entero, y eso no se cambia por la comodidad de no
 * volver a apretar un botón.
 */
function guardarToken() {
    try {
        if (!tokens) {
            fs.rmSync(rutaDelToken(), { force: true });
            return true;
        }
        if (!safeStorage.isEncryptionAvailable()) return false;
        fs.writeFileSync(rutaDelToken(), safeStorage.encryptString(JSON.stringify(tokens)), { mode: 0o600 });
        return true;
    } catch (e) {
        return false;
    }
}

function tokenGuardado() {
    if (leido) return tokens;
    leido = true;
    try {
        if (safeStorage.isEncryptionAvailable()) {
            tokens = JSON.parse(safeStorage.decryptString(fs.readFileSync(rutaDelToken())));
        }
    } catch (e) {
        tokens = null;
    }
    return tokens;
}

function clientId() {
    return ajustesLib.leer().frameio.clientId;
}

/**
 * Un token de acceso que sirva ahora, renovándolo si está por vencer.
 *
 * Las llamadas en curso comparten el mismo refresco: sin eso, seis subidas a la
 * vez con el token por vencer dispararían seis refrescos, y Adobe invalida el
 * token de refresco anterior en cada uno — o sea que cinco de los seis
 * quedarían con un token muerto.
 */
async function token() {
    const t = tokenGuardado();
    if (!t || !t.acceso) return null;
    if (Date.now() < t.vence - MARGEN_MS) return t.acceso;
    if (!t.refresco) return null;
    if (!refrescando) {
        refrescando = auth.refrescar({ clientId: clientId(), refresco: t.refresco, previos: t })
            .then(nuevos => {
                tokens = nuevos;
                guardarToken();
                return nuevos.acceso;
            })
            .catch(err => {
                // El de refresco también vence. Se borra para que la ventana
                // diga «volvé a conectar» en vez de fallar en cada llamada.
                puente.anotar('frameio.refresco', { ok: false, error: err.message });
                tokens = null;
                guardarToken();
                return null;
            })
            .finally(() => { refrescando = null; });
    }
    return refrescando;
}

const conectado = () => Boolean(tokenGuardado() && tokenGuardado().acceso);

/** Lo que Ajustes muestra: si hay sesión, de quién, y dónde registrar el regreso. */
function estadoDeLaSesion() {
    const t = tokenGuardado();
    return {
        configurada: Boolean(clientId()),
        conectado: Boolean(t && t.acceso),
        quien: (t && t.quien) || null,
        redirect: auth.REDIRECT,
        guardaElToken: safeStorage.isEncryptionAvailable()
    };
}

async function conectar() {
    const id = clientId();
    if (!id) return { ok: false, error: 'Falta el identificador de la app de Adobe. Pegalo acá abajo.' };

    const { verificador, desafio, estado } = auth.pkce();
    let retorno;
    try {
        retorno = await auth.abrirRetorno(estado);
    } catch (err) {
        return { ok: false, error: err.message };
    }

    await shell.openExternal(auth.urlDeAutorizacion({ clientId: id, desafio, estado }));

    let codigo;
    try {
        codigo = await retorno.codigo;
    } catch (err) {
        retorno.cerrar();
        puente.anotar('frameio.conectar', { ok: false, error: err.message });
        return { ok: false, error: err.message };
    }

    try {
        tokens = await auth.canjear({ clientId: id, codigo, verificador });
        leido = true;
    } catch (err) {
        puente.anotar('frameio.conectar', { ok: false, error: err.message });
        return { ok: false, error: `No se pudo completar la conexión: ${err.message}` };
    }

    // Sin token de refresco habría que volver a conectar cada hora. Casi
    // siempre es que a la credencial le falta el permiso `offline_access`, y es
    // mejor decirlo ahora que dentro de una hora.
    const sinRefresco = !tokens.refresco;
    try {
        const yo = await api().yo();
        tokens.quien = yo.name || yo.email || null;
    } catch (e) { /* el nombre es un adorno; la sesión ya sirve */ }
    guardarToken();
    puente.anotar('frameio.conectar', { ok: true, sinRefresco });

    return {
        ok: true,
        aviso: sinRefresco
            ? 'Conectado, pero la sesión se va a cortar en una hora: a la credencial de Adobe le falta el permiso offline_access.'
            : null
    };
}

async function desconectar() {
    const t = tokenGuardado();
    const id = clientId();
    if (t && id) await auth.revocar({ clientId: id, acceso: t.acceso, refresco: t.refresco });
    tokens = null;
    leido = true;
    guardarToken();
    puente.anotar('frameio.desconectar', {});
    return { ok: true };
}

/** El cliente de la API, atado a la cuenta de la carpeta vinculada. */
function api(cuenta) {
    return frameio.cliente({ token, cuenta: cuenta || null });
}

/** Lo que se sabe del vínculo de la carpeta abierta. Sin carpeta, nada. */
function estadoDelVinculo() {
    if (!abierta) return null;
    const v = vinculo.leer(abierta.raiz);
    return {
        ruta: v.ruta,
        camino: vinculo.caminoDe(v.ruta),
        subirSolo: v.subirSolo,
        renders: v.renders
    };
}

/**
 * Le cuenta a la ventana cómo está todo.
 *
 * Una sola forma para los tres lugares que lo muestran —Ajustes, la columna de
 * clases y la pestaña Render— porque son la misma información dicha tres veces,
 * y repintarlos por separado es cómo se llega a que una diga «subiendo» y otra
 * «listo».
 */
function todo() {
    return {
        ...estadoDeLaSesion(),
        vinculo: estadoDelVinculo(),
        subiendo: subiendo ? { archivo: subiendo.version.archivo, pct: subiendo.pct } : null,
        enCola: cola.map(t => t.version.archivo),
        ultimaTraida
    };
}

function avisar() {
    puente.mandar('frameio-estado', todo());
}

// ─── Subir y apilar ───────────────────────────────────────────────────

/**
 * Pone una versión en la fila para subir.
 *
 * No se encola dos veces lo mismo ni lo que ya está arriba: `plan` lo decide
 * mirando el vínculo, que es la única fuente de «esto ya está en Frame.io».
 */
function encolar(raiz, clase, version, porQue) {
    if (cola.some(t => t.version.archivo === version.archivo)) return false;
    if (subiendo && subiendo.version.archivo === version.archivo) return false;
    const estado = vinculo.leer(raiz);
    if (!estado.ruta) return false;
    const plan = vinculo.plan(estado, clase, version);
    if (!plan.subir) return false;
    cola.push({ raiz, clase, version, porQue });
    puente.anotar('frameio.encola', { archivo: version.archivo, porQue });
    return true;
}

/**
 * Sube lo que haya en la fila, de a una.
 *
 * El plan de apilado se recalcula justo antes de subir y no al encolar: entre
 * que se encoló y le toca el turno pueden haber subido dos hermanas, y la pila
 * ya no es la que era.
 */
async function atenderCola() {
    if (subiendo || !cola.length) return;
    const tarea = cola.shift();
    const { raiz, clase, version } = tarea;
    const estado = vinculo.leer(raiz);
    if (!estado.ruta) return;

    const plan = vinculo.plan(estado, clase, version);
    if (!plan.subir) { setImmediate(atenderCola); return; }

    subiendo = { ...tarea, pct: 0 };
    avisar();
    const cliente = api(estado.ruta.cuenta);

    const r = await subida.subir(cliente, estado.ruta.carpeta, version.ruta, {
        nombre: version.archivo,
        alAvanzar: a => {
            subiendo.pct = a.pct;
            puente.mandar('frameio-avanza', { archivo: version.archivo, pct: a.pct, bytes: a.bytes, total: a.total });
        }
    });

    if (!r.ok) {
        vinculo.anotarRender(raiz, version.archivo, { estado: 'error', error: r.error });
        puente.anotar('frameio.sube', { archivo: version.archivo, ok: false, error: r.error });
        subiendo = null;
        avisar();
        setImmediate(atenderCola);
        return;
    }

    vinculo.anotarRender(raiz, version.archivo, {
        fileId: r.archivo.id,
        vista: r.archivo.view_url || null,
        estado: 'subido',
        error: null,
        subido: new Date().toISOString()
    });

    // Y recién ahora se apila: hasta que Frame.io no lo da por recibido, el
    // archivo no existe para el resto de la API.
    try {
        if (plan.apilar && plan.apilar.tipo === 'mover') {
            await cliente.mover(r.archivo.id, plan.apilar.pilaId);
            vinculo.anotarRender(raiz, version.archivo, { pilaId: plan.apilar.pilaId });
        } else if (plan.apilar && plan.apilar.tipo === 'crear') {
            const pila = await cliente.crearPila(estado.ruta.carpeta, [...plan.apilar.fileIds, r.archivo.id]);
            // La pila es de todas: las hermanas también pasan a vivir adentro.
            for (const archivo of [...plan.apilar.archivos, version.archivo]) {
                vinculo.anotarRender(raiz, archivo, { pilaId: pila.id });
            }
        }
        puente.anotar('frameio.sube', { archivo: version.archivo, ok: true, apilado: plan.apilar && plan.apilar.tipo });
    } catch (err) {
        // El archivo ya está arriba; lo que falló es el apilado. Se anota el
        // motivo y se sigue: queda suelto en la carpeta, visible, y la próxima
        // entrega lo junta con las demás.
        vinculo.anotarRender(raiz, version.archivo, { error: `Subió, pero no se pudo apilar: ${err.message}` });
        puente.anotar('frameio.apila', { archivo: version.archivo, ok: false, error: err.message });
    }

    subiendo = null;
    avisar();
    setImmediate(atenderCola);
}

/**
 * Las clases de una carpeta, recién leídas del disco.
 *
 * Se escanea en vez de usar lo que la ventana tenga cargado, y es a propósito:
 * un render que acaba de aparecer todavía no está en esa lista —la ventana se
 * relee cuando el editor aprieta Recargar—, y el apilado depende justamente de
 * saber qué hermanas tiene. Sin esto, la primera entrega después de abrir la
 * carpeta subiría suelta en vez de arriba de la v anterior.
 */
async function clasesDe(raiz) {
    // Cinco segundos de memoria: alcanzan para que tres entregas seguidas del
    // mismo curso no escaneen tres veces, y son pocos para que el render que
    // llegó hace un minuto no se pierda.
    if (abierta && abierta.raiz === raiz && Date.now() - abierta.leidasEn < 5_000) return abierta.clases;
    const leido = await versiones.escanear(raiz);
    if (leido.error) {
        puente.anotar('frameio.escanea', { ok: false, error: leido.error });
        return [];
    }
    if (abierta && abierta.raiz === raiz) {
        abierta.clases = leido.clases;
        abierta.leidasEn = Date.now();
    }
    return leido.clases;
}

/**
 * Sube lo que falte de una carpeta vinculada que tenga la subida automática
 * prendida.
 *
 * Es el único camino de las dos entradas —la entrega del taller y el render
 * nuevo que ve el vigía— porque las dos piden lo mismo: mirá qué falta y
 * subilo. Qué falta lo dice el vínculo, no quién avisó.
 */
async function subirLoQueFalte(raiz, porQue) {
    const estado = vinculo.leer(raiz);
    if (!estado.ruta || !estado.subirSolo) return;
    if (!conectado()) return;
    const clases = await clasesDe(raiz);
    let alguna = false;
    for (const { clase, version } of vinculo.faltan(estado, clases)) {
        if (encolar(raiz, clase, version, porQue)) alguna = true;
    }
    if (alguna) atenderCola();
}

/**
 * Claude entregó algo: si su curso está vinculado, se sube.
 *
 * Llega desde `main/taller.js` por el puente, con la ruta de la entrega en
 * `Clases_Finales/`. Puede no haber ninguna carpeta abierta —el render corre
 * igual— así que la carpeta sale de la ruta de la entrega y no de la ventana.
 */
function alEntregar(entregas) {
    const carpetas = new Set((entregas || []).filter(e => e && e.ruta).map(e => path.dirname(e.ruta)));
    for (const raiz of carpetas) {
        subirLoQueFalte(raiz, 'entrega').catch(err => puente.anotar('frameio.entrega', { ok: false, error: err.message }));
    }
}

/** Un render nuevo en la carpeta abierta, visto por el vigía. */
function alLlegarRenders() {
    if (!abierta) return;
    subirLoQueFalte(abierta.raiz, 'vigia').catch(err => puente.anotar('frameio.vigia', { ok: false, error: err.message }));
}

// ─── Traer los comentarios ────────────────────────────────────────────

/**
 * Una vuelta: lee los comentarios de cada versión vinculada, los mete en su
 * `comentarios.json` y manda a Frame.io lo que se resolvió acá.
 *
 * Todo lo de una versión pasa o no pasa junto: si la lectura falla a la mitad,
 * no se fusiona nada de esa versión. Una fusión parcial borraría los
 * comentarios que no llegaron a leerse, porque «no está en la lista» es cómo se
 * reconoce lo que alguien borró en Frame.io.
 */
async function traer({ aMano = false } = {}) {
    if (!abierta) return { ok: false, error: 'No hay ninguna carpeta abierta.' };
    const estado = vinculo.leer(abierta.raiz);
    if (!estado.ruta) return { ok: false, error: 'Esta carpeta no está vinculada a Frame.io.' };
    if (!conectado()) return { ok: false, error: 'Conectate a Frame.io desde Ajustes.' };

    const cliente = api(estado.ruta.cuenta);
    const objetivos = vinculo.paraTraer(estado, abierta.clases);
    let agregados = 0;
    let actualizados = 0;
    let borrados = 0;
    const fallos = [];

    for (const { version, fileId } of objetivos) {
        let crudos;
        try {
            crudos = await cliente.comentarios(fileId);
        } catch (err) {
            // Un 404 es que el archivo ya no está en Frame.io. No se borran los
            // comentarios: lo que se rompió es el vínculo, y borrar trabajo del
            // editor porque alguien movió un archivo allá sería el peor
            // intercambio posible.
            fallos.push(`${version.archivo}: ${err.message}`);
            continue;
        }

        const entrantes = convertir.comentarios(crudos, { fps: (version.media && version.media.fps) || 30, fileId });
        for (const c of crudos) remotos.set(c.id, Boolean(c.completed_at));

        const r = comentariosLib.fusionarDeFrameio(
            version.ruta, fileId, entrantes, puente.contextoDe(version.ruta)
        );
        agregados += r.agregados;
        actualizados += r.actualizados;
        borrados += r.borrados;

        // Lo que acá está resuelto y allá no —o al revés— se manda. Se compara
        // contra lo que Frame.io acaba de contestar, así que esto se corrige
        // solo aunque una vuelta anterior haya fallado.
        for (const { id, hecho } of comentariosLib.paraCompletarEnFrameio(r.datos)) {
            if (remotos.has(id) && remotos.get(id) !== hecho) porCompletar.set(id, hecho);
        }
    }

    ultimaTraida = new Date().toISOString();
    if (agregados || actualizados || borrados) {
        puente.mandar('frameio-trajo', { agregados, actualizados, borrados });
    }
    puente.anotar('frameio.trae', { archivos: objetivos.length, agregados, actualizados, borrados, fallos: fallos.length, aMano });
    avisar();
    atenderCompletar();

    return {
        ok: !fallos.length || agregados + actualizados + borrados > 0,
        agregados,
        actualizados,
        borrados,
        error: fallos.length ? `No se pudo leer: ${fallos.slice(0, 2).join('; ')}` : null
    };
}

/**
 * Manda las casillas pendientes, de a una y con freno.
 *
 * Editar un comentario está limitado a 10 por minuto, y una ronda en la que
 * Claude marcó veinte ajustes los pasa fácil. Lo que no se alcanza a mandar
 * queda para la vuelta siguiente, que lo vuelve a detectar.
 */
async function atenderCompletar() {
    if (completando || !porCompletar.size || !abierta) return;
    const estado = vinculo.leer(abierta.raiz);
    if (!estado.ruta) return;

    completando = true;
    const cliente = api(estado.ruta.cuenta);
    try {
        for (const [id, hecho] of [...porCompletar]) {
            try {
                await cliente.completar(id, hecho);
                porCompletar.delete(id);
                remotos.set(id, hecho);
                puente.anotar('frameio.completa', { ok: true, hecho });
            } catch (err) {
                // Un 404 es un comentario borrado en Frame.io: se saca de la
                // fila, porque insistir no lo va a resucitar.
                if (err.estado === 404) porCompletar.delete(id);
                puente.anotar('frameio.completa', { ok: false, error: err.message });
                break;
            }
            await new Promise(listo => setTimeout(listo, FRENO_COMPLETAR_MS));
        }
    } finally {
        completando = false;
    }
}

/**
 * Cambió algo en los comentarios de una versión: si alguno vino de Frame.io y
 * ahora está distinto, se manda.
 *
 * Es una comodidad, no la garantía: resolver un comentario y verlo tildado en
 * Frame.io diez segundos después se siente bien. Quien garantiza que los dos
 * lados terminen iguales es la vuelta de `traer`.
 */
function alCambiarComentarios(rutaVideo, datos) {
    if (!abierta || !datos || !datos.comentarios) return;
    let alguno = false;
    for (const { id, hecho } of comentariosLib.paraCompletarEnFrameio(datos)) {
        if (remotos.has(id) && remotos.get(id) !== hecho) {
            porCompletar.set(id, hecho);
            alguno = true;
        }
    }
    if (alguno) atenderCompletar();
}

/**
 * Claude marcó ajustes como hechos en `Feedback/`.
 *
 * Eso se escribe desde `engine/entrega.js`, sin pasar por los canales de
 * comentarios, así que el aviso llega por separado y los comentarios se releen
 * acá. Es el camino por el que un `[x]` de Claude termina tildando la casilla
 * en Frame.io, que es la mitad del trato con quien comentó.
 */
function alResolverClaude(rutas) {
    if (!abierta) return;
    for (const ruta of rutas || []) {
        alCambiarComentarios(ruta, comentariosLib.leer(ruta));
    }
}

// ─── Abrir y cerrar una carpeta ───────────────────────────────────────

/**
 * La ventana abrió una carpeta de renders.
 *
 * Si está vinculada: se traen los comentarios y se sube lo que falte. Las dos
 * cosas sin esperar a que terminen, porque abrir una carpeta no puede quedarse
 * esperando a que conteste internet.
 */
function abrir(raiz, clases) {
    abierta = { raiz, clases: clases || [], leidasEn: Date.now() };
    remotos.clear();
    porCompletar.clear();
    clearInterval(reloj);
    reloj = null;
    ultimaTraida = null;

    const estado = vinculo.leer(raiz);
    avisar();
    if (!estado.ruta || !conectado()) return;

    reloj = setInterval(() => { traer().catch(() => {}); }, RONDA_MS);
    if (reloj.unref) reloj.unref();
    traer().catch(() => {});
    subirLoQueFalte(raiz, 'al abrir').catch(() => {});
}

function cerrar() {
    clearInterval(reloj);
    reloj = null;
    abierta = null;
    remotos.clear();
    porCompletar.clear();
}

// ─── El navegador de rutas ────────────────────────────────────────────

/**
 * Un nivel del árbol de Frame.io, para elegir dónde van los renders.
 *
 * Se pide por nivel y no de una: una cuenta grande tiene cientos de proyectos y
 * miles de carpetas, y traerlos todos para que alguien elija uno es hacer
 * esperar por lo que no se va a mirar.
 */
async function explorar({ cuenta, workspace, proyecto, carpeta } = {}) {
    if (!conectado()) return { ok: false, error: 'Conectate a Frame.io desde Ajustes.' };
    try {
        if (!cuenta) {
            const cuentas = await api().cuentas();
            return { ok: true, nivel: 'cuenta', items: cuentas.map(c => ({ id: c.id, nombre: c.display_name || c.name || c.id })) };
        }
        const cliente = api(cuenta);
        if (!workspace) {
            const ws = await cliente.workspaces();
            return { ok: true, nivel: 'workspace', items: ws.map(w => ({ id: w.id, nombre: w.name })) };
        }
        if (!proyecto) {
            const ps = await cliente.proyectos(workspace);
            return { ok: true, nivel: 'proyecto', items: ps.map(p => ({ id: p.id, nombre: p.name, carpetaRaiz: p.root_folder_id })) };
        }
        // Dentro de un proyecto se navega por carpetas. La raíz del proyecto es
        // una carpeta más, y es donde casi siempre van los renders.
        const dentroDe = carpeta || (await cliente.proyecto(proyecto)).root_folder_id;
        const hijos = await cliente.hijos(dentroDe);
        return {
            ok: true,
            nivel: 'carpeta',
            carpeta: dentroDe,
            items: hijos.filter(h => h.type === 'folder').map(h => ({ id: h.id, nombre: h.name }))
        };
    } catch (err) {
        return { ok: false, error: err.message };
    }
}

/**
 * Lo que ya está en la carpeta vinculada, aplanado: archivos sueltos y los de
 * adentro de cada pila.
 *
 * Es lo que deja emparejar por nombre lo que se subió a mano antes de vincular.
 */
async function enFrameio(cliente, carpetaId) {
    const plano = [];
    for (const hijo of await cliente.hijos(carpetaId)) {
        if (hijo.type === 'file') {
            plano.push({ id: hijo.id, nombre: hijo.name, pilaId: null, vista: hijo.view_url || null });
        } else if (hijo.type === 'version_stack') {
            for (const v of await cliente.versionesDe(hijo.id)) {
                plano.push({ id: v.id, nombre: v.name, pilaId: hijo.id, vista: v.view_url || null });
            }
        }
    }
    return plano;
}

// ─── El puente con la ventana ─────────────────────────────────────────

function registrar(dependencias) {
    puente = { ...puente, ...dependencias };

    ipcMain.handle('frameio-estado', () => todo());

    ipcMain.handle('frameio-conectar', async () => {
        const r = await conectar();
        // Con sesión nueva se vuelve a abrir la carpeta: es lo que arranca la
        // ronda de comentarios y sube lo que faltaba.
        if (r.ok && abierta) abrir(abierta.raiz, abierta.clases);
        avisar();
        return r;
    });

    ipcMain.handle('frameio-desconectar', async () => {
        const r = await desconectar();
        clearInterval(reloj);
        reloj = null;
        avisar();
        return r;
    });

    ipcMain.handle('frameio-explorar', (e, donde) => explorar(donde || {}));

    ipcMain.handle('frameio-vincular', (e, ruta) => {
        if (!abierta) return { ok: false, error: 'No hay ninguna carpeta abierta.' };
        try {
            vinculo.vincular(abierta.raiz, ruta);
        } catch (err) {
            return { ok: false, error: err.message };
        }
        puente.anotar('frameio.vincula', { carpeta: ruta && ruta.carpeta });
        abrir(abierta.raiz, abierta.clases);
        return { ok: true, vinculo: estadoDelVinculo() };
    });

    ipcMain.handle('frameio-desvincular', () => {
        if (!abierta) return { ok: false, error: 'No hay ninguna carpeta abierta.' };
        vinculo.desvincular(abierta.raiz);
        clearInterval(reloj);
        reloj = null;
        avisar();
        return { ok: true };
    });

    ipcMain.handle('frameio-subir-solo', (e, si) => {
        if (!abierta) return { ok: false, error: 'No hay ninguna carpeta abierta.' };
        vinculo.subirSolo(abierta.raiz, si);
        avisar();
        return { ok: true };
    });

    /** Sube una versión, o todas las que falten si no se dice cuál. */
    ipcMain.handle('frameio-subir', (e, { archivo } = {}) => {
        if (!abierta) return { ok: false, error: 'No hay ninguna carpeta abierta.' };
        const estado = vinculo.leer(abierta.raiz);
        if (!estado.ruta) return { ok: false, error: 'Esta carpeta no está vinculada a Frame.io.' };
        if (!conectado()) return { ok: false, error: 'Conectate a Frame.io desde Ajustes.' };

        const candidatas = vinculo.faltan(estado, abierta.clases)
            .filter(x => !archivo || x.version.archivo === archivo);
        if (!candidatas.length) return { ok: false, error: 'No hay nada para subir: ya está todo en Frame.io.' };
        let cuantas = 0;
        for (const { clase, version } of candidatas) {
            if (encolar(abierta.raiz, clase, version, 'a mano')) cuantas++;
        }
        atenderCola();
        avisar();
        return { ok: true, cuantas };
    });

    ipcMain.handle('frameio-traer', () => traer({ aMano: true }));

    /**
     * Busca en la carpeta vinculada lo que coincida por nombre con los renders
     * de acá, y lo vincula.
     *
     * Devuelve también lo que NO coincidió de los dos lados, que es lo único
     * que después hay que resolver a mano.
     */
    ipcMain.handle('frameio-emparejar', async () => {
        if (!abierta) return { ok: false, error: 'No hay ninguna carpeta abierta.' };
        const estado = vinculo.leer(abierta.raiz);
        if (!estado.ruta) return { ok: false, error: 'Esta carpeta no está vinculada a Frame.io.' };
        try {
            const cliente = api(estado.ruta.cuenta);
            const plano = await enFrameio(cliente, estado.ruta.carpeta);
            const r = vinculo.emparejar(estado, abierta.clases, plano);
            if (r.emparejados.length) vinculo.aplicarEmparejados(abierta.raiz, r.emparejados);
            puente.anotar('frameio.empareja', { emparejados: r.emparejados.length, sinEmparejar: r.sinEmparejar.length });
            avisar();
            if (r.emparejados.length) traer().catch(() => {});
            return { ok: true, ...r };
        } catch (err) {
            return { ok: false, error: err.message };
        }
    });

    /** Vincular a mano un render con un archivo de Frame.io. */
    ipcMain.handle('frameio-vincular-archivo', (e, { archivo, fileId } = {}) => {
        if (!abierta) return { ok: false, error: 'No hay ninguna carpeta abierta.' };
        if (!archivo || !fileId) return { ok: false, error: 'Falta decir qué render y qué archivo.' };
        vinculo.anotarRender(abierta.raiz, archivo, { fileId, estado: 'subido', error: null });
        avisar();
        traer().catch(() => {});
        return { ok: true };
    });

    /**
     * Abre en el navegador la página de Frame.io de un render.
     *
     * Se recibe el NOMBRE del render y no la url: la url la tiene este lado, en
     * el vínculo. Aceptar una url que viene de la ventana sería aceptar
     * cualquier url, y `shell.openExternal` abre lo que se le dé.
     */
    ipcMain.handle('frameio-abrir', (e, archivo) => {
        if (!abierta) return { ok: false };
        const enlace = vinculo.leer(abierta.raiz).renders[archivo];
        if (!enlace || !enlace.vista) return { ok: false };
        shell.openExternal(enlace.vista);
        return { ok: true };
    });

    /** Lo que hay en la carpeta vinculada, para el selector de emparejado. */
    ipcMain.handle('frameio-listar', async () => {
        if (!abierta) return { ok: false, error: 'No hay ninguna carpeta abierta.' };
        const estado = vinculo.leer(abierta.raiz);
        if (!estado.ruta) return { ok: false, error: 'Esta carpeta no está vinculada a Frame.io.' };
        try {
            return { ok: true, items: await enFrameio(api(estado.ruta.cuenta), estado.ruta.carpeta) };
        } catch (err) {
            return { ok: false, error: err.message };
        }
    });
}

module.exports = {
    RONDA_MS,
    registrar,
    abrir,
    cerrar,
    alEntregar,
    alLlegarRenders,
    alCambiarComentarios,
    alResolverClaude
};
