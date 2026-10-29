'use strict';
/**
 * main.js — Proceso principal de Reviewer.
 *
 * Todo lo que toca el disco vive de este lado, en Node: escanear la carpeta, medir con
 * ffprobe, sacar cuadros, armar proxies, escribir el feedback y hablar con el
 * modelo. La ventana dibuja y pide; así abrir una carpeta de cuarenta renders
 * no congela el reproductor y el motor se puede probar sin abrir la app
 * (`node tests/run.js`).
 *
 * **Los canales no están acá: están en `main/`.** Este archivo llegó a 916
 * líneas y 56 `ipcMain.handle` porque cada función nueva colgaba su grupo al
 * final, y los trece separadores `// ─── … ───` que lo mantenían legible eran
 * el síntoma: los límites ya estaban dibujados, solo que en comentarios en vez
 * de en archivos. Ahora cada grupo es un módulo con un tema —`main/pantalla.js`
 * es la segunda pantalla, `main/carpeta.js` es la carpeta abierta,
 * `main/comentarios.js` son los comentarios de una versión y sus adjuntos,
 * `main/redaccion.js` es el modelo escribiendo, `main/ajustes.js` las
 * preferencias, `main/actualizaciones.js` la versión nueva, `main/sistema.js`
 * lo que se le pide a la máquina— y cada uno expone un `registrar(puente)`.
 *
 * Lo que queda acá es lo que no es de ningún grupo y es de todos: arrancar y
 * cerrar la app, la ventana de trabajo, el protocolo `reviewer://` con su
 * lista blanca, y los dos `process.on` que atrapan lo que nadie atrapó.
 *
 * **Ningún módulo de `main/` importa a este archivo ni a otro de `main/`.**
 * Todo lo que necesitan del resto —la ventana principal, `mandar`, `anotar`,
 * `permitir`— llega por el `registrar`. No es prolijidad: `permitir()` es
 * quien amplía la lista blanca del protocolo, y mientras se pase a mano se
 * puede leer de un vistazo quién puede ampliarla. Con un `require('../main')`
 * desde cada módulo eso dejaría de verse, y además sería un ciclo.
 * `tests/modulos.test.js` lo comprueba.
 */

const { app, BrowserWindow, protocol } = require('electron');
const fs = require('fs');
const path = require('path');

const dictado = require('./engine/dictado');
const mediaServer = require('./engine/media-server');
const registro = require('./engine/registro');

const actualizaciones = require('./main/actualizaciones');
const ajustes = require('./main/ajustes');
const carpeta = require('./main/carpeta');
const comentarios = require('./main/comentarios');
const pantalla = require('./main/pantalla');
const redaccion = require('./main/redaccion');
const sistema = require('./main/sistema');

let ventana = null;

/**
 * La ventana de trabajo, para quien la necesite.
 *
 * Se pasa como función y no como valor porque se reasigna: en macOS cerrar la
 * última ventana no cierra la app, y volver al Dock crea una nueva. Un módulo
 * que se hubiera guardado el `BrowserWindow` de antes abriría sus diálogos
 * contra una ventana destruida.
 */
function ventanaPrincipal() {
    return ventana;
}

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

/**
 * Habilita una ruta y devuelve la url con la que pedirla.
 *
 * Es la única forma de ampliar la lista blanca, y viaja a los módulos de
 * `main/` como dependencia del `registrar` en vez de importarse: quién puede
 * agrandarla tiene que poder leerse de un vistazo en el `whenReady` de abajo.
 */
function permitir(ruta) {
    const real = path.resolve(ruta);
    permitidas.add(real);
    return `reviewer://media/${encodeURIComponent(real)}`;
}

/**
 * Olvida todo lo habilitado. Lo llama `main/carpeta.js` al abrir otra carpeta.
 *
 * Que la lista no se acumule entre carpetas es lo que hace que cerrar una y
 * abrir otra deje de dar acceso a los renders de la anterior.
 */
function olvidarPermitidas() {
    permitidas.clear();
}

// ─── La ventana de trabajo ────────────────────────────────────────────

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

// ─── Que no se caiga en silencio ──────────────────────────────────────

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

    // Todos los canales, de una. Acá y no al cargar el archivo porque
    // `main/pantalla.js` le pregunta a `screen`, que antes de `whenReady` no
    // existe, y porque tener los siete `registrar` en una sola pantalla es lo
    // que permite leer de un vistazo quién recibe `permitir` —o sea, quién
    // puede ampliar la lista blanca del protocolo— sin abrir ningún módulo.
    //
    // `carpeta.contextoDe` y `comentarios.estadoDe` se pasan como dependencia y
    // no se importan entre módulos: las dos son funciones que dependen de
    // estado de su dueño, y un `require` cruzado entre dos archivos de `main/`
    // es la primera vuelta del ciclo que esta partición vino a evitar. El orden
    // de estas llamadas no importa: lo que se pasa son referencias que existen
    // desde que el módulo se cargó.
    sistema.registrar({ ventanaPrincipal, version: appVersion });
    ajustes.registrar({ anotar });
    actualizaciones.registrar({ anotar, version: appVersion });
    pantalla.registrar({ ventanaPrincipal, mandar, anotar });
    carpeta.registrar({ ventanaPrincipal, mandar, anotar, permitir, olvidarPermitidas });
    comentarios.registrar({ ventanaPrincipal, anotar, permitir, contextoDe: carpeta.contextoDe });
    redaccion.registrar({ anotar, contextoDe: carpeta.contextoDe, estadoDe: comentarios.estadoDe });

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

