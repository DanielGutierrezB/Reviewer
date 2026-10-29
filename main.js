'use strict';
/**
 * main.js — Proceso principal de Reviewer.
 *
 * Todo lo que toca el disco vive acá, en Node: escanear la carpeta, medir con
 * ffprobe, sacar cuadros, armar proxies, escribir el feedback y hablar con el
 * modelo. La ventana dibuja y pide; así abrir una carpeta de cuarenta renders
 * no congela el reproductor y el motor se puede probar sin abrir la app
 * (`node tests/run.js`).
 */

const { app, BrowserWindow, clipboard, dialog, ipcMain, protocol, shell } = require('electron');
const fs = require('fs');
const path = require('path');

const ajustesLib = require('./engine/ajustes');
const comentariosLib = require('./engine/comentarios');
const dictado = require('./engine/dictado');
const frames = require('./engine/frames');
const generalLib = require('./engine/general');
const llm = require('./engine/llm');
const mediaServer = require('./engine/media-server');
const paths = require('./engine/paths');
const prompts = require('./engine/prompts');
const proxy = require('./engine/proxy');
const referenciasLib = require('./engine/referencias');
const registro = require('./engine/registro');
const versiones = require('./engine/versiones');
const workspace = require('./engine/workspace');

let ventana = null;

/**
 * La carpeta abierta, con todo medido.
 *
 * Una sola y no varias: revisar es mirar los renders de UN curso, y la lista de
 * versiones solo tiene sentido dentro de una carpeta. Cambiar de carpeta es
 * reemplazar esto.
 */
let abierta = null;

function appVersion() {
    try {
        return JSON.parse(fs.readFileSync(path.join(__dirname, 'version.json'), 'utf8')).version;
    } catch (e) {
        return app.getVersion();
    }
}

function mandar(canal, carga) {
    if (ventana && !ventana.isDestroyed()) ventana.webContents.send(canal, carga);
}

function anotar(evento, datos) {
    registro.anotar('main', evento, datos);
}

// ─── El video, hasta la ventana ───────────────────────────────────────

/**
 * `reviewer://` — le sirve a la ventana los renders, sus proxies y los PNG.
 *
 * No se usa `file://` directo: la ventana corre con `sandbox` y aislamiento, y
 * apagar `webSecurity` para que pueda leer el disco le abriría la puerta a todo
 * lo demás. Con un protocolo propio la ventana solo alcanza lo que la lista de
 * abajo deja pasar.
 *
 * `stream: true` es lo que permite contestar de a pedazos; quién arma esos
 * pedazos está en `engine/media-server.js`.
 */
protocol.registerSchemesAsPrivileged([{
    scheme: 'reviewer',
    privileges: {
        standard: true,
        secure: true,
        stream: true,
        supportFetchAPI: true,
        corsEnabled: true
    }
}]);

const permitidas = new Set();

function permitir(ruta) {
    const real = path.resolve(ruta);
    permitidas.add(real);
    return `reviewer://media/${encodeURIComponent(real)}`;
}

function crearVentana() {
    ventana = new BrowserWindow({
        width: 1440,
        height: 900,
        minWidth: 1040,
        minHeight: 640,
        backgroundColor: '#101217',
        titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
        show: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true
        }
    });

    ventana.once('ready-to-show', () => ventana.show());
    ventana.loadFile('src/index.html');
}

// Un fallo suelto no puede dejar la app viva pero muda: se registra y sigue. Es
// justo la clase de cosa que el editor no ve y que explica por qué algo dejó de
// andar a mitad de una revisión.
process.on('uncaughtException', err => {
    anotar('error.no-atrapado', { mensaje: err && err.message });
    console.error('Excepción no atrapada:', err);
});
process.on('unhandledRejection', razon => {
    anotar('error.promesa', { mensaje: razon && razon.message ? razon.message : String(razon) });
    console.error('Promesa rechazada:', razon);
});

app.whenReady().then(() => {
    // Lo primero de todo, antes de anotar nada: el diario en disco. Si se
    // abriera después, las líneas del arranque —que son las que explican una app
    // que no llega ni a mostrar la ventana— quedarían solo en memoria.
    const diario = registro.abrirDiario(app.getPath('userData'));
    anotar('app.arranca', {
        version: appVersion(),
        electron: process.versions.electron,
        arch: process.arch,
        diario: diario.ok ? 'guardando' : `sin guardar: ${diario.error}`
    });

    protocol.handle('reviewer', request => mediaServer.responder(request, permitidas));
    crearVentana();
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) crearVentana();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
    // El modelo de dictado es un proceso aparte y no se entera de que la app
    // cerró: sin esto queda cargado ocupando medio giga hasta que alguien lo
    // mate a mano.
    dictado.apagar();
    anotar('app.cierra', {});
    registro.volcar();
});

// ─── Lo que se sabe de la carpeta abierta ─────────────────────────────

/**
 * El contexto con el que se escribe el `feedback.md` de una versión.
 *
 * Se arma en cada guardado y no se cachea: el comentario general puede haber
 * cambiado en otra ventana o a mano con un editor de texto, y el markdown se
 * escribe con lo que el disco dice AHORA. Cuesta leer dos archivos chicos.
 */
function contextoDe(rutaVideo) {
    if (!abierta) return { rutaVideo };
    const encontrado = versiones.buscarVersion(abierta.clases, rutaVideo);
    const general = generalLib.leer(abierta.raiz);
    return {
        rutaVideo,
        media: encontrado ? encontrado.version.media : null,
        clase: encontrado ? encontrado.clase.nombre : null,
        numeroVersion: encontrado ? encontrado.version.n : 1,
        general: { texto: general.texto, ruta: general.ruta },
        referencias: referenciasLib.paraFeedback(abierta.raiz)
    };
}

/** Una versión → lo que la ventana necesita para pintarla. */
function versionParaVentana(version) {
    return {
        n: version.n,
        ruta: version.ruta,
        archivo: version.archivo,
        carpeta: version.carpeta,
        tieneComentarios: workspace.tieneComentarios(version.ruta),
        media: version.media,
        proxy: proxy.haceFalta(version.media)
    };
}

function claseParaVentana(clase) {
    return {
        id: clase.id,
        nombre: clase.nombre,
        versiones: clase.versiones.map(versionParaVentana)
    };
}

// ─── Puente con la ventana ────────────────────────────────────────────

ipcMain.handle('app-info', () => ({
    version: appVersion(),
    arch: process.arch,
    electron: process.versions.electron,
    platform: process.platform
}));

ipcMain.handle('doctor', () => ({
    ...paths.doctor(),
    cache: proxy.peso()
}));

ipcMain.handle('registro-anotar', (evento, { evento: nombre, datos } = {}) => {
    registro.anotar('ventana', nombre, datos);
    return true;
});

ipcMain.handle('registro-texto', () => registro.texto());

// ─── Ajustes ──────────────────────────────────────────────────────────

ipcMain.handle('ajustes-leer', () => ajustesLib.leer());
ipcMain.handle('ajustes-guardar', (e, datos) => ajustesLib.guardar(datos));
ipcMain.handle('llm-modelos', async (e, config) => {
    try {
        return { ok: true, modelos: await llm.modelos(config) };
    } catch (err) {
        return { ok: false, error: err.message, modelos: [] };
    }
});
ipcMain.handle('llm-probar', (e, config) => llm.probar(config));
ipcMain.handle('cache-vaciar', () => ({ ...proxy.vaciar(), peso: proxy.peso() }));

// ─── Abrir una carpeta ────────────────────────────────────────────────

ipcMain.handle('elegir-carpeta', async () => {
    const r = await dialog.showOpenDialog(ventana, {
        properties: ['openDirectory'],
        buttonLabel: 'Revisar',
        message: 'Elegí la carpeta donde Claude deja los renders'
    });
    return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('carpetas-recientes', () => {
    const { carpetasRecientes } = ajustesLib.leer();
    return carpetasRecientes.map(ruta => ({ ruta, existe: fs.existsSync(ruta) }));
});

ipcMain.handle('olvidar-carpeta', (e, ruta) => ajustesLib.olvidarCarpeta(ruta).carpetasRecientes);

ipcMain.handle('abrir-carpeta', async (e, raiz) => {
    const empezo = Date.now();
    const leido = await versiones.escanear(raiz);
    if (leido.error) {
        anotar('carpeta.error', { error: leido.error });
        return { ok: false, error: leido.error };
    }

    abierta = leido;
    permitidas.clear();
    for (const ruta of versiones.rutasDe(leido.clases)) permitir(ruta);
    ajustesLib.recordarCarpeta(raiz);

    anotar('carpeta.abierta', {
        clases: leido.clases.length,
        versiones: leido.clases.reduce((n, c) => n + c.versiones.length, 0),
        ms: Date.now() - empezo
    });

    return {
        ok: true,
        raiz,
        clases: leido.clases.map(claseParaVentana),
        general: generalLib.leer(raiz)
    };
});

/**
 * Deja un video listo para reproducir y devuelve la url con la que pedirlo.
 *
 * Si hace falta proxy se arma acá y el avance viaja por `proxy-avance`: la
 * ventana lo muestra en el lugar del video, porque una espera de tres minutos
 * sin nada en pantalla se lee como una app colgada.
 */
ipcMain.handle('preparar-video', async (e, ruta) => {
    const encontrado = abierta && versiones.buscarVersion(abierta.clases, ruta);
    if (!encontrado) return { ok: false, error: 'Ese video no es de la carpeta abierta.' };

    const media = encontrado.version.media;
    if (!media.ok) return { ok: false, error: media.error };

    const falta = proxy.haceFalta(media);
    if (!falta.hace) {
        return { ok: true, url: permitir(ruta), proxy: false, media };
    }

    const hecho = proxy.yaHecho(ruta);
    if (hecho) return { ok: true, url: permitir(hecho), proxy: true, reusado: true, media };

    mandar('proxy-avance', { ruta, pct: 0, motivo: falta.motivo });
    anotar('proxy.arma', { codec: media.codec, pixFmt: media.pixFmt });
    const r = await proxy.armar(ruta, media, pct => mandar('proxy-avance', { ruta, pct, motivo: falta.motivo }));
    mandar('proxy-avance', { ruta, pct: 1, motivo: falta.motivo, listo: true });

    if (!r.ok) {
        anotar('proxy.falla', { error: r.error });
        return { ok: false, error: `No se pudo preparar el video: ${r.error}` };
    }
    return { ok: true, url: permitir(r.ruta), proxy: true, reusado: false, media };
});

// ─── Comentarios ──────────────────────────────────────────────────────

/** Lo que la ventana recibe después de cada cambio: el estado entero del disco. */
function estadoDe(rutaVideo, datos) {
    const carpeta = workspace.carpetaDeVersion(rutaVideo);
    const archivos = workspace.archivosDeVersion(rutaVideo);
    // Las miniaturas se piden por el mismo protocolo que el video, así que hay
    // que habilitarlas una por una: el PNG de un comentario recién hecho no
    // estaba en la lista cuando se abrió la carpeta.
    const conUrls = datos.comentarios.map(c => ({
        ...c,
        frameUrl: c.frame ? permitir(path.join(carpeta, c.frame)) : null,
        dibujoUrl: c.dibujo ? permitir(path.join(carpeta, c.dibujo)) : null
    }));
    return {
        ...datos,
        comentarios: conUrls,
        carpeta,
        rutaFeedback: archivos.feedback,
        existeFeedback: fs.existsSync(archivos.feedback),
        cuenta: comentariosLib.cuenta(datos)
    };
}

ipcMain.handle('comentarios-leer', (e, ruta) => {
    const ctx = contextoDe(ruta);
    return estadoDe(ruta, comentariosLib.leer(ruta, ctx.media));
});

ipcMain.handle('comentario-agregar', (e, { ruta, comentario } = {}) => {
    const ctx = contextoDe(ruta);
    const { datos, id } = comentariosLib.agregar(ruta, comentario, ctx);
    anotar('comentario.nuevo', { con: comentario.tHasta ? 'rango' : 'instante', total: datos.comentarios.length });
    return { ...estadoDe(ruta, datos), nuevo: id };
});

ipcMain.handle('comentario-editar', (e, { ruta, id, cambios } = {}) => {
    const ctx = contextoDe(ruta);
    return estadoDe(ruta, comentariosLib.editar(ruta, id, cambios, ctx));
});

ipcMain.handle('comentario-borrar', (e, { ruta, id } = {}) => {
    const ctx = contextoDe(ruta);
    anotar('comentario.borra', {});
    return estadoDe(ruta, comentariosLib.borrar(ruta, id, ctx));
});

/**
 * Guarda el cuadro y, si vino, el dibujo de un comentario.
 *
 * Es un paso aparte de «agregar» porque sacar el cuadro con ffmpeg tarda medio
 * segundo y la tarjeta del comentario tiene que aparecer en el acto: primero se
 * escribe el texto, después aparece la miniatura.
 */
ipcMain.handle('comentario-imagenes', async (e, { ruta, id, t, dibujo } = {}) => {
    const ctx = contextoDe(ruta);
    const fps = (ctx.media && ctx.media.fps) || 25;
    const cambios = {};

    const cuadro = await frames.sacar(ruta, { id, t, fps });
    if (!cuadro.ok) {
        anotar('cuadro.falla', { error: cuadro.error });
        return { ok: false, error: cuadro.error, estado: estadoDe(ruta, comentariosLib.leer(ruta, ctx.media)) };
    }
    cambios.frame = cuadro.relativa;

    if (dibujo) {
        try {
            const compuesto = await frames.guardarDibujo(
                ruta, { id, t, fps }, Buffer.from(dibujo), cuadro.absoluta
            );
            cambios.dibujo = compuesto.relativa;
        } catch (err) {
            anotar('dibujo.falla', { error: err.message });
        }
    }

    return { ok: true, estado: estadoDe(ruta, comentariosLib.editar(ruta, id, cambios, ctx)) };
});

// ─── El comentario general y sus referencias ──────────────────────────

ipcMain.handle('general-leer', () => (abierta ? generalLib.leer(abierta.raiz) : null));

ipcMain.handle('general-guardar', (e, texto) => {
    if (!abierta) return null;
    const r = generalLib.guardar(abierta.raiz, texto);
    anotar('general.guarda', { vacio: !r.texto, rehechos: r.rehechos });
    return r;
});

ipcMain.handle('referencias-agregar', async (e, { nombre, bytes, origen } = {}) => {
    if (!abierta) return null;
    const lista = referenciasLib.agregar(abierta.raiz, {
        nombre,
        bytes: bytes ? Buffer.from(bytes) : null,
        origen
    });
    generalLib.rehacerFeedbacks(abierta.raiz);
    return lista.map(r => ({ ...r, url: r.falta ? null : permitir(r.ruta) }));
});

ipcMain.handle('referencias-quitar', (e, file) => {
    if (!abierta) return null;
    const lista = referenciasLib.quitar(abierta.raiz, file);
    generalLib.rehacerFeedbacks(abierta.raiz);
    return lista.map(r => ({ ...r, url: r.falta ? null : permitir(r.ruta) }));
});

ipcMain.handle('referencias-listar', () => {
    if (!abierta) return [];
    return referenciasLib.listar(abierta.raiz).map(r => ({ ...r, url: r.falta ? null : permitir(r.ruta) }));
});

ipcMain.handle('elegir-referencias', async () => {
    const r = await dialog.showOpenDialog(ventana, {
        properties: ['openFile', 'multiSelections'],
        buttonLabel: 'Adjuntar',
        message: 'Imágenes, PDF o notas que Claude tenga que mirar'
    });
    return r.canceled ? [] : r.filePaths;
});

// ─── El modelo local ──────────────────────────────────────────────────

ipcMain.handle('refinar', async (e, entrada) => {
    const config = ajustesLib.llmActivo();
    if (!config.modelo) {
        return { ok: false, texto: entrada.texto || '', motivo: 'Elegí un modelo en Ajustes.' };
    }
    const r = await prompts.refinar(config, entrada);
    anotar('refina', { ok: r.ok, ms: r.ms || null, motivo: r.ok ? null : r.motivo });
    return r;
});

ipcMain.handle('instruccion-preparar', async (e, ruta) => {
    const config = ajustesLib.llmActivo();
    if (!config.modelo) return { ok: false, motivo: 'Elegí un modelo en Ajustes.' };

    const ctx = contextoDe(ruta);
    const datos = comentariosLib.leer(ruta, ctx.media);
    const r = await prompts.prepararInstruccion(config, datos, {
        clase: ctx.clase,
        numeroVersion: ctx.numeroVersion,
        general: ctx.general && ctx.general.texto
    });
    anotar('instruccion', { ok: r.ok, ms: r.ms || null, motivo: r.ok ? null : r.motivo });
    if (!r.ok) return r;

    return {
        ...r,
        estado: estadoDe(ruta, comentariosLib.guardarInstruccion(ruta, r.texto, r.modelo, ctx))
    };
});

ipcMain.handle('instruccion-borrar', (e, ruta) => {
    const ctx = contextoDe(ruta);
    return estadoDe(ruta, comentariosLib.guardarInstruccion(ruta, '', null, ctx));
});

// ─── Dictado ──────────────────────────────────────────────────────────

ipcMain.handle('dictado-estado', () => ({ ...dictado.disponible(), listo: dictado.listo() }));
ipcMain.handle('dictado-empezar', () => dictado.empezar());
ipcMain.handle('dictado-trozo', (e, bytes) => dictado.trozo(Buffer.from(bytes)));
ipcMain.handle('dictado-leer', () => dictado.transcribir(ajustesLib.leer().dictado.idioma));
ipcMain.handle('dictado-cerrar', () => dictado.cerrar());

// ─── Salidas al sistema ───────────────────────────────────────────────

ipcMain.handle('abrir-en-finder', (e, ruta) => {
    if (!ruta) return false;
    if (fs.existsSync(ruta) && fs.statSync(ruta).isDirectory()) shell.openPath(ruta);
    else shell.showItemInFolder(ruta);
    return true;
});

ipcMain.handle('abrir-archivo', (e, ruta) => shell.openPath(ruta));

ipcMain.handle('copiar', (e, texto) => {
    clipboard.writeText(String(texto || ''));
    return true;
});

ipcMain.handle('confirmar', async (e, { titulo, detalle, aceptar } = {}) => {
    const r = await dialog.showMessageBox(ventana, {
        type: 'warning',
        buttons: [aceptar || 'Borrar', 'Cancelar'],
        defaultId: 1,
        cancelId: 1,
        message: titulo || '¿Seguro?',
        detail: detalle || ''
    });
    return r.response === 0;
});
