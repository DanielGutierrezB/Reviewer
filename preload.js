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

contextBridge.exposeInMainWorld('rv', {
    appInfo: () => ipcRenderer.invoke('app-info'),
    doctor: () => ipcRenderer.invoke('doctor'),
    anotar: (evento, datos) => ipcRenderer.invoke('registro-anotar', { evento, datos }),
    registroTexto: () => ipcRenderer.invoke('registro-texto'),

    ajustesLeer: () => ipcRenderer.invoke('ajustes-leer'),
    ajustesGuardar: datos => ipcRenderer.invoke('ajustes-guardar', datos),
    llmModelos: config => ipcRenderer.invoke('llm-modelos', config),
    llmProbar: config => ipcRenderer.invoke('llm-probar', config),
    cacheVaciar: () => ipcRenderer.invoke('cache-vaciar'),

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

    alAvanzarProxy: fn => {
        ipcRenderer.removeAllListeners('proxy-avance');
        ipcRenderer.on('proxy-avance', (e, carga) => fn(carga));
    }
});
