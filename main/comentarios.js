'use strict';
/**
 * main/comentarios.js — Los comentarios de una versión y los archivos que se
 * les cuelgan.
 *
 * Es el grupo de canales más grande del puente y el más parejo: cada uno hace
 * un cambio en el disco con `engine/comentarios.js` y contesta con
 * `estadoDe()`, que es el estado ENTERO de la versión. Nunca un parche. La
 * ventana no tiene que saber qué tocó cada operación ni acordarse de pedir lo
 * que faltaba, y por eso agregar un campo a un comentario no obliga a repasar
 * trece handlers.
 *
 * Acá no hay estado propio a propósito: la carpeta abierta la tiene
 * `main/carpeta.js` y de ella llega solo `contextoDe`. Si este módulo se
 * guardara una copia de algo, sería la segunda fuente de verdad sobre un
 * árbol de archivos que se edita también con el Finder.
 */

const { dialog, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');

const adjuntosLib = require('../engine/adjuntos');
const comentariosLib = require('../engine/comentarios');
const frames = require('../engine/frames');
const referenciasLib = require('../engine/referencias');
const workspace = require('../engine/workspace');

/** Lo que este módulo necesita del resto del proceso principal. Lo pone `registrar`. */
let puente = {
    ventanaPrincipal: () => null,
    anotar: () => {},
    permitir: ruta => ruta,
    contextoDe: rutaVideo => ({ rutaVideo })
};

/** Lo que la ventana recibe después de cada cambio: el estado entero del disco. */
function estadoDe(rutaVideo, datos) {
    const carpeta = workspace.carpetaDeVersion(rutaVideo);
    const archivos = workspace.archivosDeVersion(rutaVideo);
    // Las miniaturas se piden por el mismo protocolo que el video, así que hay
    // que habilitarlas una por una: el PNG de un comentario recién hecho no
    // estaba en la lista cuando se abrió la carpeta.
    const conUrls = datos.comentarios.map(c => ({
        ...c,
        frameUrl: c.frame ? puente.permitir(path.join(carpeta, c.frame)) : null,
        dibujoUrl: c.dibujo ? puente.permitir(path.join(carpeta, c.dibujo)) : null,
        // El adjunto viaja con su ruta absoluta además de la relativa: la
        // relativa es la que se guarda —la carpeta se muda—, pero la ventana
        // la necesita entera para el «Mostrar en el Finder» y para el title.
        adjuntos: c.adjuntos.map(a => {
            const absoluta = path.join(carpeta, a.archivo);
            return {
                ...a,
                ruta: absoluta,
                // Miniatura solo si es una imagen. Un PDF servido por el
                // protocolo le daría un `<img>` roto a la tarjeta, que es peor
                // que un icono: parece que el archivo se perdió.
                url: a.tipo === 'imagen' ? puente.permitir(absoluta) : null
            };
        }),
        // La tira numerada: el cuadro, el dibujo y los adjuntos con su número
        // y su token. **La cuenta la hace el motor**, por lo mismo que
        // `referencias.listar` arma ahí el token: el badge que dibuja la
        // tarjeta y la referencia que resuelve el `feedback.md` tienen que
        // salir de la misma función o un día dicen cosas distintas.
        tira: adjuntosLib.tira(c, carpeta).map(i => ({
            ...i,
            url: !i.falta && i.tipo === 'imagen' ? puente.permitir(i.ruta) : null
        }))
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

/**
 * La miniatura de un archivo que TODAVÍA no se copió.
 *
 * Mientras se redacta el comentario no hay nada en el disco —esa es la regla—,
 * así que la vista previa tiene que salir del archivo donde está. Se habilita
 * su ruta de origen en la lista blanca del protocolo, que es lo mismo que se
 * hace con los PNG de los comentarios.
 *
 * **Acá no se verifica de dónde salió la ruta.** En la práctica la eligió el
 * editor en un diálogo del sistema o la soltó en la ventana, que es el mismo
 * gesto de consentimiento que abrir una carpeta, pero el handler no lo
 * comprueba: acepta la que le mande el renderer. Lo que de verdad la acota es
 * el filtro de imagen de acá abajo y que la ventana corre con
 * `default-src 'none'`, sin contenido remoto y sin Node —para abusar de esto
 * hay que tener ya ejecución en el renderer, y ahí leer un PNG del disco es el
 * menor de los problemas—. Se deja escrito porque el que lea `permitir()` no
 * tiene que creer que alguien valida.
 *
 * Solo para imágenes: de un PDF no hay miniatura que mostrar y habilitarlo
 * sería ampliar la lista blanca sin que nadie lo vaya a mirar.
 */
function ojear(ruta) {
    try {
        if (referenciasLib.claseDe(ruta) !== 'imagen') return { url: null };
        if (!fs.existsSync(ruta) || fs.statSync(ruta).isDirectory()) return { url: null };
        return { url: puente.permitir(ruta) };
    } catch (e) {
        return { url: null };
    }
}

function registrar(dependencias) {
    puente = { ...puente, ...dependencias };

    // ─── Comentarios ──────────────────────────────────────────────────

    ipcMain.handle('comentarios-leer', (e, ruta) => {
        const ctx = puente.contextoDe(ruta);
        return estadoDe(ruta, comentariosLib.leer(ruta, ctx.media));
    });

    ipcMain.handle('comentario-agregar', (e, { ruta, comentario } = {}) => {
        const ctx = puente.contextoDe(ruta);
        const { datos, id } = comentariosLib.agregar(ruta, comentario, ctx);
        puente.anotar('comentario.nuevo', { con: comentario.tHasta ? 'rango' : 'instante', total: datos.comentarios.length });
        return { ...estadoDe(ruta, datos), nuevo: id };
    });

    ipcMain.handle('comentario-editar', (e, { ruta, id, cambios } = {}) => {
        const ctx = puente.contextoDe(ruta);
        return estadoDe(ruta, comentariosLib.editar(ruta, id, cambios, ctx));
    });

    ipcMain.handle('comentario-borrar', (e, { ruta, id } = {}) => {
        const ctx = puente.contextoDe(ruta);
        puente.anotar('comentario.borra', {});
        return estadoDe(ruta, comentariosLib.borrar(ruta, id, ctx));
    });

    /**
     * Deja la versión como estaba en un momento anterior (o posterior). Es lo que
     * hay detrás de `Cmd+Z` y `Cmd+Shift+Z`.
     *
     * La ventana manda el JSON entero y no «qué deshacer» porque el motor ya sabe
     * escribir un estado completo —es lo que hace en cada guardado— y porque una
     * lista de operaciones inversas, una por acción, es una lista que se olvida de
     * la última que alguien agregó.
     */
    ipcMain.handle('comentarios-aplicar', (e, { ruta, datos } = {}) => {
        const ctx = puente.contextoDe(ruta);
        return estadoDe(ruta, comentariosLib.aplicar(ruta, datos, ctx));
    });

    // ─── Los adjuntos de un comentario ────────────────────────────────

    /** Los dos usos, tal como los escribió el motor. El selector se arma con esto. */
    ipcMain.handle('adjuntos-usos', () => adjuntosLib.USOS);

    ipcMain.handle('elegir-adjuntos', async () => {
        const r = await dialog.showOpenDialog(puente.ventanaPrincipal(), {
            properties: ['openFile', 'multiSelections'],
            buttonLabel: 'Adjuntar',
            message: 'Archivos para que Claude los mire, o para que los use tal cual'
        });
        if (r.canceled) return [];
        return r.filePaths.map(ruta => ({ ruta, nombre: path.basename(ruta), ...ojear(ruta) }));
    });

    ipcMain.handle('adjunto-ojear', (e, ruta) => (ruta ? ojear(ruta) : { url: null }));

    /**
     * Copia los archivos a la carpeta de la versión y se los cuelga al comentario.
     *
     * Vuelve con los que no se pudieron copiar en vez de tirar: cinco archivos
     * arrastrados de los cuales uno estaba en un disco desmontado son cuatro
     * adjuntos que ya son trabajo hecho.
     */
    ipcMain.handle('comentario-adjuntar', (e, { ruta, id, entradas } = {}) => {
        const ctx = puente.contextoDe(ruta);
        const limpias = (entradas || []).map(x => ({
            nombre: x.nombre,
            uso: x.uso,
            origen: x.origen || null,
            bytes: x.bytes ? Buffer.from(x.bytes) : null
        }));
        const r = comentariosLib.adjuntar(ruta, id, limpias, ctx);
        puente.anotar('adjunto.suma', { cuantos: r.puestos.length, fallados: r.fallados.length });
        return { ...r, estado: estadoDe(ruta, r.datos) };
    });

    ipcMain.handle('comentario-adjunto-quitar', (e, { ruta, id, archivo } = {}) => {
        const ctx = puente.contextoDe(ruta);
        puente.anotar('adjunto.quita', {});
        return estadoDe(ruta, comentariosLib.quitarAdjunto(ruta, id, archivo, ctx));
    });

    ipcMain.handle('comentario-adjunto-uso', (e, { ruta, id, archivo, uso } = {}) => {
        const ctx = puente.contextoDe(ruta);
        return estadoDe(ruta, comentariosLib.usarAdjunto(ruta, id, archivo, uso, ctx));
    });

    /** Tira la papelera de una versión: se llama al soltar su historial. */
    ipcMain.handle('papelera-vaciar', (e, ruta) => {
        if (ruta) workspace.vaciarPapelera(ruta);
        return { ok: true };
    });

    /**
     * Guarda el cuadro y, si vino, el dibujo de un comentario.
     *
     * Es un paso aparte de «agregar» porque sacar el cuadro con ffmpeg tarda medio
     * segundo y la tarjeta del comentario tiene que aparecer en el acto: primero se
     * escribe el texto, después aparece la miniatura.
     */
    ipcMain.handle('comentario-imagenes', async (e, { ruta, id, t, dibujo } = {}) => {
        const ctx = puente.contextoDe(ruta);
        const fps = (ctx.media && ctx.media.fps) || 25;
        const cambios = {};

        const cuadro = await frames.sacar(ruta, { id, t, fps });
        if (!cuadro.ok) {
            puente.anotar('cuadro.falla', { error: cuadro.error });
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
                puente.anotar('dibujo.falla', { error: err.message });
            }
        }

        return { ok: true, estado: estadoDe(ruta, comentariosLib.editar(ruta, id, cambios, ctx)) };
    });
}

module.exports = { registrar, estadoDe };
