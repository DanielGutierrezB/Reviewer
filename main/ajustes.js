'use strict';
/**
 * main/ajustes.js — Las preferencias del editor, el transporte del modelo y la
 * cuenta de Claude.
 *
 * Los tres juntos porque son una sola pantalla y una sola pregunta —«con qué
 * va a trabajar esta Mac»—: el desplegable de proveedores, la lista de modelos
 * que ese proveedor tiene y el cartel que dice con qué cuenta está conectado
 * el CLI se pintan de una vez y se guardan en el mismo archivo. Vaciar el
 * caché de proxies entra en el mismo panel por lo mismo.
 *
 * Lo que el modelo HACE con el texto está en `main/redaccion.js`.
 *
 * **La ventana no escribe el documento de ajustes entero.** Solo puede
 * parchear: ver el comentario de `ajustes-parchear`.
 */

const { ipcMain } = require('electron');

const ajustesLib = require('../engine/ajustes');
const claude = require('../engine/claude');
const llm = require('../engine/llm');
const proxy = require('../engine/proxy');

/** Lo que este módulo necesita del resto del proceso principal. Lo pone `registrar`. */
let puente = { anotar: () => {} };

function registrar(dependencias) {
    puente = { ...puente, ...dependencias };

    ipcMain.handle('ajustes-leer', () => ajustesLib.leer());

    /**
     * Cambia unas pocas claves y devuelve el documento entero ya saneado.
     *
     * Es el ÚNICO canal de escritura de ajustes, y que sea el único es el
     * punto. Antes había un `ajustes-guardar` que recibía el documento
     * completo, y los cinco módulos de la ventana que guardan algo lo armaban
     * cada uno por su lado a partir de su copia cacheada
     * (`{...estado.ajustes, miClave: ...}`). Dos problemas que esto borra de
     * raíz en vez de acomodar:
     *
     * - Dos de los cinco preservaban los hermanos del sub-objeto y los otros
     *   tres lo reemplazaban entero. Daba igual mientras esos sub-objetos
     *   tuvieran una sola clave; el día que `paneles` ganara una tercera,
     *   plegar una columna se llevaba puesta la nueva.
     * - Cada escritura mandaba un documento armado sobre una foto que podía
     *   estar vieja. Plegar un panel y elegir una pantalla con dos escrituras
     *   en vuelo perdía una de las dos, y el síntoma —«guardé una cosa y se me
     *   borró otra»— no deja rastro en ningún lado.
     *
     * El merge se hace contra lo que el DISCO dice ahora, que es la fuente de
     * verdad, y no contra lo que el renderer creía. Así ninguno de los
     * llamadores vuelve a ver el documento completo y no hay nada que
     * coordinar entre ellos.
     */
    ipcMain.handle('ajustes-parchear', (e, parcial) => ajustesLib.parchear(parcial));

    ipcMain.handle('llm-modelos', async (e, config) => {
        try {
            return { ok: true, modelos: await llm.modelos(config) };
        } catch (err) {
            return { ok: false, error: err.message, modelos: [] };
        }
    });
    ipcMain.handle('llm-probar', (e, config) => llm.probar(config));

    /**
     * La sesión de Claude, para el cartel de Ajustes.
     *
     * Va por el proceso principal como todo lo demás, y acá no es solo por la
     * costumbre: esto lanza un proceso hijo. La ventana corre con `sandbox: true`,
     * así que ni podría, y está bien que no pueda.
     *
     * Al registro va el estado y nada más. La cuenta de Claude es el mail del
     * editor y el diario se manda por chat para pedir ayuda: la pantalla lo muestra
     * porque se pidió ver quién está conectado, el archivo no lo necesita.
     */
    ipcMain.handle('claude-sesion', async () => {
        const s = await claude.sesion();
        puente.anotar('claude.sesion', { estado: s.estado });
        // La lista de modelos viaja acá y no en su propia llamada: la pantalla
        // necesita las dos cosas para dibujarse una vez, y pedirlas por separado
        // dejaba el desplegable vacío un instante antes de llenarse. Van con su
        // nombre largo, que `llm.modelos` no tiene: esa devuelve ids porque es lo
        // que entienden los otros dos transportes.
        return { ...s, modelos: claude.MODELOS };
    });

    ipcMain.handle('claude-salir', async () => {
        const r = await claude.salir();
        puente.anotar('claude.salir', { ok: r.ok });
        return r;
    });

    ipcMain.handle('cache-vaciar', () => ({ ...proxy.vaciar(), peso: proxy.peso() }));
}

module.exports = { registrar };
