'use strict';
/**
 * main/actualizaciones.js — Buscar la versión nueva, bajarla y abrir su
 * instalador.
 *
 * La consulta a GitHub, la descarga y el porqué de que no haya actualización
 * silenciosa están en `engine/actualizaciones.js`. Acá vive el estado, y está
 * de este lado del puente a propósito: la url del `.pkg` y la ruta donde quedó
 * bajado nunca viajan a la ventana para volver. `shell.openPath` abre lo que
 * se le dé, y aceptar una ruta o una url que viene del renderer sería aceptar
 * cualquiera. Con las de acá, «Bajar» baja lo último que GitHub contestó e
 * «Instalar» abre lo último que se bajó y comprobó, o nada.
 */

const fs = require('fs');
const { app, ipcMain, shell } = require('electron');

const actualizaciones = require('../engine/actualizaciones');

/** El último release que se encontró, con su url. */
let releaseEncontrado = null;
/** El instalador ya bajado y comprobado, listo para abrir. */
let instaladorListo = null;
/** La descarga en curso, para poder cancelarla. */
let descargaEnCurso = null;

/** Lo que este módulo necesita del resto del proceso principal. Lo pone `registrar`. */
let puente = { anotar: () => {}, mandar: () => {}, version: () => '0.0.0' };

function registrar(dependencias) {
    puente = { ...puente, ...dependencias };

    ipcMain.handle('actualizacion-buscar', async () => {
        const versionActual = puente.version();
        const r = await actualizaciones.buscar({ versionActual });
        releaseEncontrado = r.hay ? r : null;
        puente.anotar('update.busca', { hay: Boolean(r.hay), version: r.version || null, motivo: r.motivo || null });
        // La url se queda acá. La ventana recibe lo que tiene que mostrar: la
        // versión que corre vuelve junto con la respuesta para que Ajustes
        // pueda decir «estás en la 0.1.4 y hay la 0.2.0» de una sola consulta.
        const { url, huella, ...paraLaVentana } = r;
        return { ...paraLaVentana, versionActual, lista: Boolean(instaladorListo && instaladorListo.version === r.version) };
    });

    /**
     * Baja el instalador de lo último que se encontró.
     *
     * A Descargas y no a una carpeta temporal: si algo sale mal a mitad de la
     * instalación, el editor todavía tiene el `.pkg` a mano para abrirlo él.
     */
    ipcMain.handle('actualizacion-descargar', async () => {
        if (!releaseEncontrado) return { ok: false, error: 'Buscá primero si hay una versión nueva.' };
        if (!releaseEncontrado.url) return { ok: false, error: 'El release está publicado pero todavía no tiene el .pkg subido.' };
        if (descargaEnCurso) return { ok: false, error: 'Ya se está bajando.' };

        const control = new AbortController();
        descargaEnCurso = control;
        const empezo = Date.now();
        try {
            const r = await actualizaciones.descargar({
                url: releaseEncontrado.url,
                nombre: releaseEncontrado.nombre,
                tamanoBytes: releaseEncontrado.tamanoBytes,
                huella: releaseEncontrado.huella,
                destDir: app.getPath('downloads'),
                signal: control.signal,
                onProgress: avance => puente.mandar('actualizacion-avanza', avance)
            });
            puente.anotar('update.descarga', { ok: r.ok, version: releaseEncontrado.version, ms: Date.now() - empezo, error: r.error || null });
            if (r.ok) instaladorListo = { ruta: r.path, version: releaseEncontrado.version };
            return r.ok ? { ok: true, version: releaseEncontrado.version } : r;
        } finally {
            descargaEnCurso = null;
        }
    });

    ipcMain.handle('actualizacion-cancelar', () => {
        if (descargaEnCurso) descargaEnCurso.abort();
        return { ok: true };
    });

    /**
     * Abre el instalador y cierra la app.
     *
     * Se abre en vez de instalarlo solo: sin Developer ID el instalador
     * silencioso de macOS valida firmas que no tenemos. Abrir el `.pkg` deja
     * al editor a un clic de Continuar. Y la app se cierra porque el instalador
     * reemplaza este mismo `.app`: seguir abiertos sería correr una app cuyos
     * archivos en disco ya no son los suyos.
     */
    ipcMain.handle('actualizacion-instalar', async () => {
        if (!instaladorListo || !fs.existsSync(instaladorListo.ruta)) {
            instaladorListo = null;
            return { ok: false, error: 'El instalador ya no está donde se bajó. Bajalo de nuevo.' };
        }
        puente.anotar('update.instala', { version: instaladorListo.version });
        const error = await shell.openPath(instaladorListo.ruta);
        if (error) return { ok: false, error };
        setTimeout(() => app.quit(), 1500);
        return { ok: true, cerrando: true };
    });
}

module.exports = { registrar };
