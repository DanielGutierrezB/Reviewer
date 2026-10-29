'use strict';
/**
 * main/carpeta.js — La carpeta abierta y todo lo que se sabe de ella.
 *
 * Este módulo existe porque hay UN estado que varios canales leen —`abierta`,
 * la carpeta escaneada y medida— y un estado compartido necesita un dueño. Lo
 * que está acá es exactamente lo que lo toca: elegirla y escanearla, la lista
 * de recientes, dejar un video listo para reproducir, el comentario general
 * del curso y las referencias que lo acompañan.
 *
 * Los comentarios de una versión NO están acá aunque también necesiten saber
 * en qué carpeta estamos: lo que necesitan es `contextoDe`, que se exporta, y
 * nada más. Esa es la línea —quién escribe `abierta` contra quién la consulta—
 * y es la que mantiene a `main/comentarios.js` sin estado propio.
 */

const { dialog, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');

const ajustesLib = require('../engine/ajustes');
const exportarLib = require('../engine/exportar');
const generalLib = require('../engine/general');
const proxy = require('../engine/proxy');
const referenciasLib = require('../engine/referencias');
const versiones = require('../engine/versiones');
const vigia = require('../engine/vigia');
const workspace = require('../engine/workspace');

/**
 * La carpeta abierta, con todo medido.
 *
 * Una sola y no varias: revisar es mirar los renders de UN curso, y la lista de
 * versiones solo tiene sentido dentro de una carpeta. Cambiar de carpeta es
 * reemplazar esto.
 */
let abierta = null;

/** El vigía de la carpeta abierta, o `null` si no hay ninguna. */
let mirando = null;

/** Lo que este módulo necesita del resto del proceso principal. Lo pone `registrar`. */
let puente = {
    ventanaPrincipal: () => null,
    mandar: () => {},
    anotar: () => {},
    permitir: ruta => ruta,
    // Abrir otra carpeta vacía la lista blanca del protocolo. El que la
    // custodia es `main.js`, así que acá llega como dependencia: este módulo
    // puede pedir que se olvide todo, pero no sabe dónde está la lista.
    olvidarPermitidas: () => {}
};

/**
 * El contexto con el que se escribe el `feedback.md` de una versión.
 *
 * Se arma en cada guardado y no se cachea: el comentario general puede haber
 * cambiado en otra ventana o a mano con un editor de texto, y el markdown se
 * escribe con lo que el disco dice AHORA. Cuesta leer dos archivos chicos.
 *
 * Se exporta porque es la única parte de `abierta` que les hace falta a los
 * módulos de comentarios y de redacción. Dándoles esto en vez de la carpeta
 * entera, ninguno de los dos puede quedarse con una foto vieja ni cambiarla.
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
        comentarios: version.comentarios,
        archivada: version.archivada,
        media: version.media,
        proxy: proxy.haceFalta(version.media)
    };
}

/**
 * Empieza a mirar la carpeta abierta y a avisar lo que aparezca.
 *
 * El aviso viaja con el nombre de la clase ya resuelto y no con la ruta cruda:
 * saber que `03_Curso_p2 v4.mp4` es la cuarta versión de `03_Curso_p2` es
 * trabajo de `versiones.partir`, y hacerlo acá evita que la ventana tenga una
 * segunda copia de esa regla que se despegue de esta.
 */
function vigilar(raiz) {
    if (mirando) mirando.parar();

    mirando = vigia.mirar(
        raiz,
        () => (abierta ? versiones.rutasDe(abierta.clases) : []),
        ({ nuevas, movidas, faltantes }) => {
            puente.anotar('carpeta.novedades', {
                nuevas: nuevas.length,
                movidas: movidas.length,
                faltantes: faltantes.length
            });
            puente.mandar('carpeta-novedades', {
                clases: nuevas.map(ruta => {
                    const { clase, version } = versiones.partir(path.basename(ruta, path.extname(ruta)));
                    return { id: versiones.clave(clase), nombre: clase, n: version };
                }),
                movidas: movidas.length,
                faltantes: faltantes.length
            });
        }
    );
}

function claseParaVentana(clase) {
    return {
        id: clase.id,
        nombre: clase.nombre,
        versiones: clase.versiones.map(versionParaVentana)
    };
}

function registrar(dependencias) {
    puente = { ...puente, ...dependencias };

    // ─── Abrir una carpeta ────────────────────────────────────────────

    ipcMain.handle('elegir-carpeta', async () => {
        const r = await dialog.showOpenDialog(puente.ventanaPrincipal(), {
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
            puente.anotar('carpeta.error', { error: leido.error });
            return { ok: false, error: leido.error };
        }

        abierta = leido;
        puente.olvidarPermitidas();
        for (const ruta of versiones.rutasDe(leido.clases)) puente.permitir(ruta);
        ajustesLib.recordarCarpeta(raiz);
        vigilar(raiz);

        puente.anotar('carpeta.abierta', {
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
            return { ok: true, url: puente.permitir(ruta), proxy: false, media };
        }

        const hecho = proxy.yaHecho(ruta);
        if (hecho) return { ok: true, url: puente.permitir(hecho), proxy: true, reusado: true, media };

        puente.mandar('proxy-avance', { ruta, pct: 0, motivo: falta.motivo });
        puente.anotar('proxy.arma', { codec: media.codec, pixFmt: media.pixFmt });
        const r = await proxy.armar(ruta, media, pct => puente.mandar('proxy-avance', { ruta, pct, motivo: falta.motivo }));
        puente.mandar('proxy-avance', { ruta, pct: 1, motivo: falta.motivo, listo: true });

        if (!r.ok) {
            puente.anotar('proxy.falla', { error: r.error });
            return { ok: false, error: `No se pudo preparar el video: ${r.error}` };
        }
        return { ok: true, url: puente.permitir(r.ruta), proxy: true, reusado: false, media };
    });

    // ─── El comentario general y sus referencias ──────────────────────
    //
    // Van acá y no en `main/comentarios.js`, aunque se llamen parecido: estos
    // dos son de la CARPETA —valen para todas las versiones de todas las
    // clases y viven en la raíz— y los otros son de un render. Es la misma
    // línea que separa `engine/general.js` de `engine/comentarios.js`.

    ipcMain.handle('general-leer', () => (abierta ? generalLib.leer(abierta.raiz) : null));

    ipcMain.handle('general-guardar', (e, texto) => {
        if (!abierta) return null;
        const r = generalLib.guardar(abierta.raiz, texto);
        puente.anotar('general.guarda', { vacio: !r.texto, rehechos: r.rehechos });
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
        return lista.map(r => ({ ...r, url: r.falta ? null : puente.permitir(r.ruta) }));
    });

    ipcMain.handle('referencias-quitar', (e, file) => {
        if (!abierta) return null;
        const lista = referenciasLib.quitar(abierta.raiz, file);
        generalLib.rehacerFeedbacks(abierta.raiz);
        return lista.map(r => ({ ...r, url: r.falta ? null : puente.permitir(r.ruta) }));
    });

    /**
     * Junta todo el feedback por hacer en `Feedback/`, listo para entregar.
     *
     * Se relee el disco en vez de usar lo que la ventana tiene cargado: entre
     * que se abrió la carpeta y se exporta pueden haber pasado dos horas de
     * trabajo, y lo que se entrega tiene que ser lo que está escrito ahora.
     */
    ipcMain.handle('exportar-feedback', (e, { clase } = {}) => {
        if (!abierta) return { ok: false, error: 'No hay ninguna carpeta abierta.' };

        const empezo = Date.now();
        const r = exportarLib.exportar(abierta.raiz, abierta.clases, { soloClase: clase || null });
        puente.anotar('feedback.exportado', {
            ok: r.ok,
            clases: r.clases || 0,
            comentarios: r.comentarios || 0,
            archivos: r.archivos || 0,
            ms: Date.now() - empezo
        });
        return r;
    });

    ipcMain.handle('referencias-listar', () => {
        if (!abierta) return [];
        return referenciasLib.listar(abierta.raiz).map(r => ({ ...r, url: r.falta ? null : puente.permitir(r.ruta) }));
    });

    ipcMain.handle('elegir-referencias', async () => {
        const r = await dialog.showOpenDialog(puente.ventanaPrincipal(), {
            properties: ['openFile', 'multiSelections'],
            buttonLabel: 'Adjuntar',
            message: 'Imágenes, PDF o notas que Claude tenga que mirar'
        });
        return r.canceled ? [] : r.filePaths;
    });
}

module.exports = { registrar, contextoDe };
