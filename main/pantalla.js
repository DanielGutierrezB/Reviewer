'use strict';
/**
 * main/pantalla.js — La segunda pantalla: la ventana que se manda al otro
 * monitor, o al iPad por Sidecar.
 *
 * Esto salió de `main.js` y no por tamaño: es lo único de todo el proceso
 * principal que NO es puente. Los demás módulos de `main/` traducen un pedido
 * de la ventana en una llamada al motor y contestan; acá hay una ventana con
 * ciclo de vida propio, estado propio (`segunda`, `segundaEnId`), reglas de
 * `workArea` medidas en el iPad y un escuchador de los eventos de `screen` que
 * se dispara sin que nadie haya pedido nada. `main.js` no tiene nada que decir
 * sobre eso.
 *
 * Del resto del proceso principal necesita tres cosas y nada más —la ventana
 * de trabajo para devolverle el foco, `mandar()` y `anotar()`—, y por eso
 * llegan por `registrar()` en vez de importarse: un `require('../main')` desde
 * acá sería un ciclo, y además dejaría de ser evidente qué parte del proceso
 * principal toca este archivo.
 *
 * Es solo el video: ni mandos ni panel, negro alrededor y a pantalla completa.
 * La idea es mirar el render en grande o con el iPad en la mano, y seguir
 * comentando y dibujando en la Mac. El cabezal lo manda la ventana principal;
 * esta nunca decide nada, solo muestra.
 *
 * `fullscreen` no: con él macOS le da al monitor un Espacio propio y el iPad
 * queda con su barra de Sidecar encima. Una ventana sin marco del tamaño exacto
 * de la pantalla hace lo mismo y deja el resto del sistema en paz.
 */

const { BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');

/** El mismo preload que la ventana principal, un nivel más arriba que este archivo. */
const PRELOAD = path.join(__dirname, '..', 'preload.js');

let segunda = null;

/**
 * En qué display está la ventana secundaria.
 *
 * Se guarda acá y no se le pregunta a la ventana, porque la pregunta que hay
 * que contestar es «¿se desenchufó LA pantalla donde estaba?». Cuando un
 * display se va, macOS no destruye la ventana: le reacomoda los bounds dentro
 * de la que quedó, así que preguntarle dónde está contestaría «acá» y el
 * desenchufe pasaría sin que nadie se entere.
 */
let segundaEnId = null;

/** Lo que este módulo necesita del resto del proceso principal. Lo pone `registrar`. */
let puente = {
    ventanaPrincipal: () => null,
    mandar: () => {},
    anotar: () => {}
};

/** El display donde está la ventana de trabajo. Ahí no se manda el render. */
function laDeLaApp() {
    const ventana = puente.ventanaPrincipal();
    const caja = ventana && !ventana.isDestroyed() ? ventana.getBounds() : null;
    return caja ? screen.getDisplayMatching(caja) : screen.getPrimaryDisplay();
}

/**
 * Cómo se llama una pantalla en el desplegable.
 *
 * `label` es el nombre que da macOS y alcanza: trae «Odyssey G81SF» para el
 * monitor y «Sidecar Display (AirPlay)» para el iPad. Lo de Sidecar se
 * reescribe porque es el caso de uso de toda esta función y nadie llama a su
 * iPad «Sidecar Display (AirPlay)»; el resto se deja tal cual, aunque sea un
 * código de panel como «J560T09», porque es lo que está escrito en la caja y
 * la medida de al lado termina de identificarlo.
 *
 * Lo que NO sirve para reconocer al iPad, probado con los tres monitores
 * enchufados: `touchSupport` y `accelerometerSupport` vienen en `'unknown'`
 * para los tres —también para el de Sidecar—, e `internal` viene en `false`
 * hasta para la pantalla del propio Mac cuando la principal es externa. El
 * nombre es el único campo que distingue.
 */
function nombreDePantalla(d) {
    const medida = `${d.size.width} × ${d.size.height}`;
    if (/sidecar/i.test(d.label || '')) return `Sidecar · iPad (${medida})`;
    return d.label ? `${d.label} (${medida})` : `Pantalla ${d.id} (${medida})`;
}

function pantallasDisponibles() {
    const mia = laDeLaApp();
    return screen.getAllDisplays().map(d => ({
        id: d.id,
        nombre: nombreDePantalla(d),
        // El nombre crudo, que es lo que se guarda en ajustes: el `id` cambia
        // al reconectar y no sirve para recordar nada (ver `engine/ajustes.js`).
        etiqueta: d.label || '',
        esDeLaApp: d.id === mia.id
    }));
}

/**
 * Se enchufó o se desenchufó una pantalla mientras la app corría.
 *
 * Lo primero es cerrar la ventana secundaria si se fue la pantalla donde
 * estaba. Dejarla viva es lo peor que puede pasar: macOS le reacomoda los
 * bounds dentro de la pantalla que quedó, y como va sin marco y por encima de
 * todo, el render aparece de golpe tapando la ventana de trabajo y tapando
 * justo el desplegable que la apagaría. No hay de dónde agarrarla.
 */
function revisarPantallas() {
    const sigue = segundaEnId != null && screen.getAllDisplays().some(d => d.id === segundaEnId);
    let seFue = false;
    if (segunda && !segunda.isDestroyed() && !sigue) {
        puente.anotar('pantalla.se-fue', { id: segundaEnId });
        segunda.close();
        segundaEnId = null;
        seFue = true;
    }
    puente.mandar('pantalla-pantallas', { pantallas: pantallasDisponibles(), seFue });
}

/**
 * Cablea los canales y empieza a mirar los displays.
 *
 * Se llama una sola vez, desde `app.whenReady()`: antes de eso `screen` no
 * existe todavía y `ipcMain.handle` del mismo canal dos veces tira.
 */
function registrar(dependencias) {
    puente = { ...puente, ...dependencias };

    ipcMain.handle('pantallas', () => ({
        pantallas: pantallasDisponibles(),
        abierta: Boolean(segunda && !segunda.isDestroyed()),
        enId: segunda && !segunda.isDestroyed() ? segundaEnId : null
    }));

    ipcMain.handle('pantalla-abrir', (e, id) => {
        const mia = laDeLaApp();
        const todas = screen.getAllDisplays().filter(d => d.id !== mia.id);
        const destino = todas.find(d => d.id === id) || todas[0];
        if (!destino) return { ok: false, error: 'No hay otra pantalla donde mandarlo.' };

        // Ya está abierta y el editor eligió otra pantalla: se MUDA en vez de
        // cerrarla y abrirla de nuevo. Cerrarla haría que la ventana nueva vuelva a
        // saludar, vuelva a pedir el video y vuelva a cargarlo desde cero —medio
        // segundo de negro y el cabezal perdido— para algo que es mover una
        // ventana. Del otro lado el `resize` recoloca la pizarra y la paleta solos.
        if (segunda && !segunda.isDestroyed()) {
            if (segundaEnId !== destino.id) {
                segunda.setBounds(destino.workArea);
                segundaEnId = destino.id;
                puente.anotar('pantalla.muda', { a: destino.label });
            }
            return { ok: true, id: destino.id, yaEstaba: true };
        }

        // `workArea` y no `bounds`, y esto se midió en el iPad con Sidecar puesto:
        // pedir los bounds enteros no da la pantalla entera. macOS no deja que una
        // ventana con marco apagado se meta abajo de la barra de menú y la reubica
        // sola, así que una ventana pedida de 1194×834 termina siendo de 1194×804
        // puesta 30 px más abajo. Pedir el workArea hace que el código diga lo que
        // de verdad va a pasar: la paleta de la segunda pantalla calcula dónde
        // ponerse a partir del alto REAL de la ventana, y con los 30 px de
        // diferencia la franja negra de un 16:9 pasaba de 81 px a 66 y la paleta se
        // iba encima del video. De paso, en un monitor con el Dock al costado la
        // ventana ya no queda abajo del Dock.
        segunda = new BrowserWindow({
            ...destino.workArea,
            frame: false,
            backgroundColor: '#000000',
            show: false,
            webPreferences: {
                preload: PRELOAD,
                contextIsolation: true,
                nodeIntegration: false,
                sandbox: true
            }
        });
        segunda.setAlwaysOnTop(true, 'floating');
        segunda.once('ready-to-show', () => {
            segunda.show();
            // El foco vuelve enseguida a la Mac: el teclado es de la ventana donde
            // se comenta, y una ventana nueva que se roba el foco deja el próximo
            // espacio o la próxima M sin dueño.
            const ventana = puente.ventanaPrincipal();
            if (ventana && !ventana.isDestroyed()) ventana.focus();
        });
        segunda.on('closed', () => {
            segunda = null;
            segundaEnId = null;
            puente.mandar('pantalla-estado', { abierta: false });
        });
        segunda.loadFile('src/pantalla.html');
        segundaEnId = destino.id;
        puente.anotar('pantalla.abre', { a: destino.label, tamano: `${destino.size.width}x${destino.size.height}` });
        return { ok: true, id: destino.id };
    });

    ipcMain.handle('pantalla-cerrar', () => {
        if (segunda && !segunda.isDestroyed()) segunda.close();
        return { ok: true };
    });

    /** Lo que la ventana principal le cuenta a la segunda: qué video y dónde va. */
    ipcMain.handle('pantalla-decir', (e, carga) => {
        if (segunda && !segunda.isDestroyed()) segunda.webContents.send('pantalla-dice', carga);
        return { ok: true };
    });

    /** Y lo que vuelve: un trazo hecho con el Pencil sobre el iPad. */
    ipcMain.handle('pantalla-trazo', (e, trazo) => {
        puente.mandar('pantalla-trazo-llega', trazo);
        return { ok: true };
    });

    /**
     * Lo otro que vuelve: lo que apretó la paleta del iPad —qué forma dibujar,
     * deshacer, rehacer—.
     *
     * Canal aparte del trazo, y no un trazo con una marca rara adentro, porque no
     * es un trazo: el que recibe trazos los mete en la pizarra y los guarda, y
     * tendría que aprender a mirar si lo que llegó era en realidad una orden. Un
     * canal por clase de mensaje es lo que hace que ninguno de los dos lados tenga
     * que adivinar qué le llegó.
     */
    ipcMain.handle('pantalla-mando', (e, mando) => {
        puente.mandar('pantalla-mando-llega', mando);
        return { ok: true };
    });

    /**
     * «Ya estoy»: lo dice la segunda ventana cuando terminó de cargar.
     *
     * Sin esto hay una carrera que se pierde siempre. `pantalla-abrir` vuelve en
     * cuanto el `BrowserWindow` existe, que es bastante antes de que su JavaScript
     * haya corrido; la ventana principal le mandaba el video en ese hueco y del
     * otro lado todavía no había nadie escuchando. La segunda pantalla quedaba en
     * negro con el «Esperando a Reviewer…» para siempre.
     *
     * Que el saludo lo dé el que llega —y no que el que manda adivine cuándo
     * esperar— también arregla recargar la segunda ventana: vuelve a saludar y
     * vuelve a recibir todo.
     */
    ipcMain.handle('pantalla-lista', () => {
        puente.mandar('pantalla-pide', {});
        return { ok: true };
    });

    // Las pantallas van y vienen mientras la app corre: Sidecar se prende, el
    // iPad se duerme, el monitor se desenchufa. El desplegable se entera solo y
    // no cuando alguien aprieta «volver a buscar», porque el momento que
    // importa —el iPad que acaba de entrar— es justo cuando el editor está
    // mirando el render y no esta barra. El botón queda igual, para cuando el
    // evento no llega: con Sidecar y AirPlay de por medio no siempre llega.
    //
    // `display-metrics-changed` también, y no por prolijidad: al conectar
    // Sidecar macOS reacomoda las otras pantallas y lo que cambia ahí son los
    // bounds, no la lista. Si la ventana secundaria está en una que se movió,
    // sus bounds quedaron viejos.
    for (const evento of ['display-added', 'display-removed', 'display-metrics-changed']) {
        screen.on(evento, () => revisarPantallas());
    }
}

module.exports = { registrar };
