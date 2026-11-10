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
const edicionLib = require('../engine/edicion');
const entregaLib = require('../engine/entrega');
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
    olvidarPermitidas: () => {},
    // Quién más quiere enterarse de que se abrió una carpeta. Hoy es el worker
    // de render, que busca ahí el taller de Claude.
    alAbrirCarpeta: () => {},
    // Lo mismo, pero con las clases ya escaneadas: Frame.io las necesita para
    // saber qué render de acá es qué archivo de allá. Va aparte de
    // `alAbrirCarpeta` porque al worker de render las clases no le importan.
    alAbrirConClases: () => {},
    // Llegaron renders nuevos, vistos por el vigía.
    alLlegarRenders: () => {},
    // Claude marcó ajustes como hechos en `Feedback/` y se resolvieron acá.
    alResolverClaude: () => {}
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
        etiqueta: encontrado ? encontrado.version.etiqueta : 'v1',
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
        edicion: Boolean(version.edicion),
        etiqueta: version.etiqueta,
        media: version.media,
        // Una edición no es un archivo que reproducir sino una receta para
        // componer uno, así que la pregunta «¿el reproductor abre este codec?»
        // no se le puede hacer: contestaría que no para un codec que no existe.
        proxy: version.edicion ? { hace: false, motivo: null } : proxy.haceFalta(version.media)
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
                    const { clase, n } = versiones.claseDeRuta(ruta, abierta ? abierta.clases : []);
                    return { id: versiones.clave(clase), nombre: clase, n };
                }),
                movidas: movidas.length,
                faltantes: faltantes.length
            });
            // Lo que apareció también se sube a Frame.io, si la carpeta está
            // vinculada. Va por el puente y con las rutas crudas: quien lo
            // escucha relee el disco, porque `abierta.clases` todavía no
            // conoce estos archivos —la ventana se relee cuando el editor
            // aprieta Recargar, no acá—.
            if (nuevas.length) puente.alLlegarRenders(nuevas);
        }
    );
}

/** El vigía de `Feedback/`, o `null` si la carpeta abierta todavía no tiene. */
let mirandoEntrega = null;

/**
 * Resuelve lo que Claude marcó como hecho en los documentos y se lo cuenta a
 * la ventana, que repinta si es la versión que está abierta.
 */
function recogerHechos(raiz) {
    const { resueltos } = entregaLib.aplicarHechos(raiz, contextoDe);
    if (resueltos.length) {
        puente.anotar('claude.hizo', { cuantos: resueltos.length });
        puente.mandar('claude-hizo', {
            cuantos: resueltos.length,
            rutas: [...new Set(resueltos.map(r => r.ruta))]
        });
        // Esto escribe los comentarios sin pasar por `main/comentarios.js`, así
        // que el aviso de «algo cambió» hay que darlo acá: si no, un ajuste que
        // Claude marcó como hecho nunca le llegaría a Frame.io.
        puente.alResolverClaude([...new Set(resueltos.map(r => r.ruta))]);
    }
    return resueltos;
}

/**
 * Mira `Feedback/` para enterarse en cuanto Claude marca algo como hecho.
 *
 * Aparte del vigía de renders, que ignora esa carpeta a propósito: lo que
 * cambia ahí no es una entrega nueva sino una casilla en un documento. Y sin
 * esperar al próximo export: el editor que tiene Reviewer abierto mientras
 * Claude trabaja tiene que ver los comentarios irse resolviendo.
 *
 * Se arma al abrir la carpeta y otra vez después de cada export, porque la
 * primera vez `Feedback/` todavía no existe.
 */
function vigilarEntrega(raiz) {
    if (mirandoEntrega) mirandoEntrega.close();
    mirandoEntrega = null;
    const carpeta = entregaLib.carpetaDe(raiz);
    if (!fs.existsSync(carpeta)) return;

    let reloj = null;
    try {
        mirandoEntrega = fs.watch(carpeta, { persistent: false }, (evento, archivo) => {
            if (archivo && !String(archivo).endsWith('.md')) return;
            // Un editor de texto guarda en dos o tres escrituras seguidas.
            clearTimeout(reloj);
            reloj = setTimeout(() => {
                if (abierta && abierta.raiz === raiz) recogerHechos(raiz);
            }, 800);
        });
    } catch (e) {
        // Un disco que se desmonta tira acá. Las marcas se leen igual al
        // próximo export o al volver a abrir la carpeta.
        mirandoEntrega = null;
    }
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
        // Primero, la ruta de los documentos de `Feedback/` con la de esta
        // máquina: la carpeta pudo haberse abierto antes en otra computadora,
        // o haberse movido, y todo lo que viene después la usa.
        const corregidos = entregaLib.corregirBase(raiz);
        if (corregidos) puente.anotar('feedback.ruta', { corregidos });
        // Lo que Claude marcó mientras la carpeta estaba cerrada.
        recogerHechos(raiz);
        vigilarEntrega(raiz);
        puente.alAbrirCarpeta(raiz);
        puente.alAbrirConClases(raiz, leido.clases);

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

    /**
     * Entrega una edición lista para componer: el JSON leído y sus urls.
     *
     * Las urls se arman acá y no en la ventana porque habilitar una ruta en el
     * protocolo es un permiso, y los permisos se dan de este lado. Van en un
     * mapa aparte —ruta absoluta → url— en vez de metidas adentro de la
     * edición: las rutas que la ventana recibe son las del disco, y las urls
     * dependen de esta sesión del protocolo.
     *
     * Se relee del disco en cada apertura. Claude puede haber reescrito el
     * `edit.json` mientras la carpeta estaba abierta —es justamente lo que
     * pasa cuando rehace un tramo que el editor pidió cambiar— y abrir una foto
     * vieja mostraría el montaje de antes.
     */
    ipcMain.handle('abrir-edicion', (e, ruta) => {
        const encontrado = abierta && versiones.buscarVersion(abierta.clases, ruta);
        if (!encontrado) return { ok: false, error: 'Esa edición no es de la carpeta abierta.' };

        const empezo = Date.now();
        const leido = edicionLib.leer(path.dirname(ruta));
        if (!leido.ok) {
            puente.anotar('edicion.error', { error: leido.error });
            return { ok: false, error: leido.error };
        }

        const urls = {};
        for (const archivo of leido.edicion.archivos) urls[archivo] = puente.permitir(archivo);

        puente.anotar('edicion.abierta', {
            shots: leido.edicion.shots.length,
            escenas: Object.keys(leido.edicion.escenas).length,
            faltan: leido.faltan.length,
            ms: Date.now() - empezo
        });

        return { ok: true, edicion: leido.edicion, urls, faltan: leido.faltan };
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
     *
     * Primero se ponen al día los encargos, con el modelo que esté elegido en
     * este momento, y la ventana se va enterando de por cuál va: con un curso
     * entero son varios segundos por clase y sin aviso parecería colgado.
     */
    ipcMain.handle('exportar-feedback', async (e, { clase } = {}) => {
        if (!abierta) return { ok: false, error: 'No hay ninguna carpeta abierta.' };

        const empezo = Date.now();
        const soloClase = clase || null;
        // Primero lo que Claude ya hizo: se resuelve, y no se le arma un
        // encargo ni entra al documento.
        const hechos = recogerHechos(abierta.raiz);
        const encargos = await exportarLib.encargosAlDia(abierta.raiz, abierta.clases, {
            soloClase,
            config: ajustesLib.llmActivo(),
            contextoDe,
            alAvanzar: avance => puente.mandar('exportar-avanza', avance)
        });
        const r = exportarLib.exportar(abierta.raiz, abierta.clases, { soloClase, contextoDe });
        vigilarEntrega(abierta.raiz);
        puente.anotar('feedback.exportado', {
            ok: r.ok,
            clases: r.clases || 0,
            comentarios: r.comentarios || 0,
            archivos: r.archivos || 0,
            encargosHechos: encargos.hechos,
            encargosFallados: encargos.fallados.length,
            ms: Date.now() - empezo
        });
        return { ...r, encargos, hechos: hechos.length };
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

/** La carpeta que se está mirando, con sus clases ya escaneadas, o `null`. */
function carpetaAbierta() {
    return abierta ? { raiz: abierta.raiz, clases: abierta.clases } : null;
}

module.exports = { registrar, contextoDe, carpetaAbierta };
