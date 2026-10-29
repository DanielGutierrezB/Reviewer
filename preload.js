'use strict';
/**
 * preload.js — La única puerta entre la ventana y el sistema.
 *
 * La ventana no tiene Node: pide cosas por acá y el proceso principal decide.
 * La ruta de una carpeta arrastrada se obtiene con `webUtils.getPathForFile`,
 * porque desde Electron 32 el `File.path` de siempre ya no existe y el drop
 * quedaba sin ruta y sin error.
 */

const { contextBridge, ipcRenderer, webUtils } = require('electron');

/**
 * Un escuchador de un canal que el proceso principal manda sin que nadie pida.
 *
 * Esto eran siete bloques de cuatro líneas idénticas cambiando solo el nombre
 * del canal. Acá está la única línea que pensaba alguna de las siete:
 * `removeAllListeners` antes de cada registro, porque la ventana vuelve a
 * cablear todo al recargarse y dos escuchadores del mismo canal pintarían dos
 * veces.
 *
 * El `fn(carga)` cubre también a los canales que no mandan nada —`fn(undefined)`
 * es lo mismo que `fn()` para quien los usa—, así que no hace falta una
 * variante.
 */
const escuchar = canal => fn => {
    ipcRenderer.removeAllListeners(canal);
    ipcRenderer.on(canal, (e, carga) => fn(carga));
};

contextBridge.exposeInMainWorld('rv', {
    appInfo: () => ipcRenderer.invoke('app-info'),
    doctor: () => ipcRenderer.invoke('doctor'),
    anotar: (evento, datos) => ipcRenderer.invoke('registro-anotar', { evento, datos }),
    registroTexto: () => ipcRenderer.invoke('registro-texto'),

    ajustesLeer: () => ipcRenderer.invoke('ajustes-leer'),
    // Parchear y no guardar: la ventana manda SOLO las claves que cambió y el
    // motor las funde contra lo que el disco dice ahora. No hay forma de
    // escribir el documento entero desde acá, y es deliberado — con la de
    // antes, cinco módulos lo armaban cada uno sobre su copia cacheada y dos
    // guardados casi simultáneos se pisaban. Ver `engine/ajustes.parchear`.
    ajustesParchear: parcial => ipcRenderer.invoke('ajustes-parchear', parcial),
    llmModelos: config => ipcRenderer.invoke('llm-modelos', config),
    llmProbar: config => ipcRenderer.invoke('llm-probar', config),
    // La sesión de Claude la tiene el CLI, y al CLI lo invoca el main: acá no
    // viaja ningún token porque no hay ninguno que guardar.
    claudeSesion: () => ipcRenderer.invoke('claude-sesion'),
    claudeSalir: () => ipcRenderer.invoke('claude-salir'),
    cacheVaciar: () => ipcRenderer.invoke('cache-vaciar'),

    // La consulta a GitHub vive en el proceso principal, como todo lo que sale a
    // la red: la ventana tiene `connect-src 'self'` y no podría ni intentarlo.
    // `actualizacionAbrir` va sin argumentos porque la página la recuerda el
    // main; mandarle una url desde acá sería poder abrir cualquiera.
    actualizacionBuscar: () => ipcRenderer.invoke('actualizacion-buscar'),
    actualizacionAbrir: () => ipcRenderer.invoke('actualizacion-abrir'),

    elegirCarpeta: () => ipcRenderer.invoke('elegir-carpeta'),
    carpetasRecientes: () => ipcRenderer.invoke('carpetas-recientes'),
    olvidarCarpeta: ruta => ipcRenderer.invoke('olvidar-carpeta', ruta),
    abrirCarpeta: raiz => ipcRenderer.invoke('abrir-carpeta', raiz),
    prepararVideo: ruta => ipcRenderer.invoke('preparar-video', ruta),

    comentariosLeer: ruta => ipcRenderer.invoke('comentarios-leer', ruta),
    comentarioAgregar: (ruta, comentario) => ipcRenderer.invoke('comentario-agregar', { ruta, comentario }),
    comentarioEditar: (ruta, id, cambios) => ipcRenderer.invoke('comentario-editar', { ruta, id, cambios }),
    comentarioBorrar: (ruta, id) => ipcRenderer.invoke('comentario-borrar', { ruta, id }),
    comentarioImagenes: (ruta, id, t, dibujo) => ipcRenderer.invoke('comentario-imagenes', { ruta, id, t, dibujo }),
    comentariosAplicar: (ruta, datos) => ipcRenderer.invoke('comentarios-aplicar', { ruta, datos }),

    // Los archivos que se le cuelgan a UN comentario. `adjuntosUsos` trae la
    // tabla con la que se arma el selector: los dos rótulos los escribe el
    // motor, que es el mismo que después escribe la frase en el `feedback.md`.
    adjuntosUsos: () => ipcRenderer.invoke('adjuntos-usos'),
    elegirAdjuntos: () => ipcRenderer.invoke('elegir-adjuntos'),
    adjuntoOjear: ruta => ipcRenderer.invoke('adjunto-ojear', ruta),
    comentarioAdjuntar: (ruta, id, entradas) => ipcRenderer.invoke('comentario-adjuntar', { ruta, id, entradas }),
    comentarioAdjuntoQuitar: (ruta, id, archivo) => ipcRenderer.invoke('comentario-adjunto-quitar', { ruta, id, archivo }),
    comentarioAdjuntoUso: (ruta, id, archivo, uso) => ipcRenderer.invoke('comentario-adjunto-uso', { ruta, id, archivo, uso }),
    papeleraVaciar: ruta => ipcRenderer.invoke('papelera-vaciar', ruta),

    generalLeer: () => ipcRenderer.invoke('general-leer'),
    generalGuardar: texto => ipcRenderer.invoke('general-guardar', texto),
    referenciasListar: () => ipcRenderer.invoke('referencias-listar'),
    referenciasAgregar: entrada => ipcRenderer.invoke('referencias-agregar', entrada),
    referenciasQuitar: file => ipcRenderer.invoke('referencias-quitar', file),
    elegirReferencias: () => ipcRenderer.invoke('elegir-referencias'),

    refinar: entrada => ipcRenderer.invoke('refinar', entrada),
    instruccionPreparar: ruta => ipcRenderer.invoke('instruccion-preparar', ruta),
    instruccionBorrar: ruta => ipcRenderer.invoke('instruccion-borrar', ruta),

    dictadoEstado: () => ipcRenderer.invoke('dictado-estado'),
    dictadoEmpezar: () => ipcRenderer.invoke('dictado-empezar'),
    dictadoTrozo: bytes => ipcRenderer.invoke('dictado-trozo', bytes),
    dictadoLeer: () => ipcRenderer.invoke('dictado-leer'),
    dictadoCerrar: () => ipcRenderer.invoke('dictado-cerrar'),

    abrirEnFinder: ruta => ipcRenderer.invoke('abrir-en-finder', ruta),
    abrirArchivo: ruta => ipcRenderer.invoke('abrir-archivo', ruta),
    copiar: texto => ipcRenderer.invoke('copiar', texto),
    confirmar: carga => ipcRenderer.invoke('confirmar', carga),

    // La ruta de lo que se suelta en la ventana. Es lo único que el renderer no
    // puede averiguar solo.
    rutaDe: file => {
        try {
            return webUtils.getPathForFile(file);
        } catch (e) {
            return null;
        }
    },

    // La segunda pantalla. `decir` va de la ventana principal a la de mirar, y
    // `trazo` vuelve: lo que se dibuja con el Pencil en el iPad entra a la
    // misma pizarra que lo que se dibuja con el mouse en la Mac.
    pantallas: () => ipcRenderer.invoke('pantallas'),
    // Con el id de la pantalla: con un monitor vertical y el iPad enchufados a
    // la vez, «la otra» no existe y había que poder decir cuál.
    pantallaAbrir: id => ipcRenderer.invoke('pantalla-abrir', id),
    pantallaCerrar: () => ipcRenderer.invoke('pantalla-cerrar'),
    pantallaDecir: carga => ipcRenderer.invoke('pantalla-decir', carga),
    pantallaTrazo: trazo => ipcRenderer.invoke('pantalla-trazo', trazo),
    pantallaMando: mando => ipcRenderer.invoke('pantalla-mando', mando),
    pantallaLista: () => ipcRenderer.invoke('pantalla-lista'),

    alAvanzarProxy: escuchar('proxy-avance'),
    alLlegarRenders: escuchar('carpeta-novedades'),
    alDecirPantalla: escuchar('pantalla-dice'),
    alEstadoPantalla: escuchar('pantalla-estado'),
    alTrazoDePantalla: escuchar('pantalla-trazo-llega'),
    alMandoDePantalla: escuchar('pantalla-mando-llega'),
    alPedirPantalla: escuchar('pantalla-pide'),
    alCambiarPantallas: escuchar('pantalla-pantallas')
});
