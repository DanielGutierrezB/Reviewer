'use strict';
/**
 * vigia.js — Mira la carpeta de renders mientras la app está abierta y avisa
 * cuando Claude dejó algo nuevo.
 *
 * Sin esto, enterarse de que llegó la v3 es acordarse de recargar. Con Claude
 * entregando de a tandas mientras el editor revisa otra cosa, «acordarse» es
 * exactamente lo que no pasa: el render está hace cuarenta minutos en el disco
 * y la ventana sigue mostrando la lista de cuando se abrió.
 *
 * Lo que NO hace es recargar solo. La lista de clases es desde dónde se navega:
 * si se reordenara sola mientras el editor está leyendo un renglón, el clic
 * caería en otra clase. Acá se avisa y el editor decide cuándo.
 *
 * Tres cosas que parecen de más y no lo son:
 *
 * 1. **Se espera a que el archivo deje de crecer.** `fs.watch` avisa cuando el
 *    archivo se crea, no cuando se terminó de escribir. Un render de 500 MB
 *    recién empezado se mide corto o directamente no se mide, y esa duración
 *    equivocada se queda en la lista hasta la próxima recarga a mano.
 * 2. **Mover no es entregar.** Archivar la v2 en `Pre versions/` es una ruta
 *    que aparece y otra que desaparece, con el mismo nombre de archivo. Hay
 *    que recargar igual, pero esa clase no tiene nada nuevo para mirar y no
 *    se pinta como si lo tuviera.
 * 3. **Los eventos vienen en ráfaga.** Copiar un archivo dispara varios, y
 *    cada uno nos haría leer la carpeta entera.
 */

const fs = require('fs');
const path = require('path');

const versiones = require('./versiones');
const workspace = require('./workspace');

/** Lo que se espera a que termine la ráfaga de eventos del sistema. */
const ESPERA = 700;

/** Cada cuánto se vuelve a mirar un archivo que todavía está creciendo. */
const REINTENTO = 1500;

/**
 * Qué cambió entre dos listas de rutas.
 *
 * `movidas` son las que están en las dos con el mismo nombre de archivo y
 * distinta carpeta. Se separan de `nuevas` porque significan otra cosa para el
 * que mira la pantalla: hay que releer la carpeta, pero no hay render nuevo.
 *
 * @returns {{nuevas: string[], movidas: Array<{de: string, a: string}>, faltantes: string[]}}
 */
function comparar(antes, ahora) {
    const habia = new Set(antes);
    const hay = new Set(ahora);

    const aparecieron = ahora.filter(r => !habia.has(r));
    const sefueron = antes.filter(r => !hay.has(r));

    const porNombre = new Map(sefueron.map(r => [path.basename(r), r]));
    const movidas = [];
    const nuevas = [];
    for (const ruta of aparecieron) {
        const de = porNombre.get(path.basename(ruta));
        if (de) {
            movidas.push({ de, a: ruta });
            porNombre.delete(path.basename(ruta));
        } else {
            nuevas.push(ruta);
        }
    }

    return { nuevas, movidas, faltantes: [...porNombre.values()] };
}

/**
 * De las rutas recién aparecidas, las que ya terminaron de escribirse.
 *
 * Una está quieta cuando pesa lo mismo que la última vez que se la miró. La
 * primera vez nunca lo está —no hay con qué comparar—, así que un archivo
 * nuevo se reporta recién en la segunda pasada, y por eso quien llama vuelve a
 * preguntar mientras queden creciendo.
 *
 * @returns {{quietas: string[], creciendo: boolean, tamanos: Map<string, number>}}
 */
function asentadas(rutas, previos) {
    const tamanos = new Map();
    const quietas = [];
    let creciendo = false;

    for (const ruta of rutas) {
        let bytes;
        try {
            bytes = fs.statSync(ruta).size;
        } catch (e) {
            continue; // se fue entre el readdir y el stat: no existe, no es nueva
        }
        tamanos.set(ruta, bytes);
        if (bytes > 0 && previos.get(ruta) === bytes) quietas.push(ruta);
        else creciendo = true;
    }

    return { quietas, creciendo, tamanos };
}

/**
 * Empieza a mirar una carpeta. Devuelve con qué dejar de mirarla.
 *
 * `conocidas()` lo pone quien llama y devuelve las rutas que la ventana ya
 * tiene cargadas. Es una función y no una lista porque esa verdad cambia: al
 * recargar, lo que era nuevo deja de serlo, y el vigía tiene que comparar
 * contra lo de ahora y no contra lo de cuando arrancó.
 *
 * `alCambiar` puede llamarse varias veces con lo mismo si el editor no recarga;
 * no se repite el aviso idéntico, pero sí se vuelve a mandar cuando la lista de
 * novedades crece.
 */
function mirar(raiz, conocidas, alCambiar) {
    let vigilantes = [];
    let temporizador = null;
    let tamanos = new Map();
    let ultimoAviso = '';
    let vivo = true;

    function carpetas() {
        const previas = workspace.carpetaPrevias(raiz);
        return previas ? [raiz, previas] : [raiz];
    }

    function escuchar() {
        for (const v of vigilantes) v.close();
        vigilantes = [];
        for (const carpeta of carpetas()) {
            try {
                const v = fs.watch(carpeta, { persistent: false }, () => programar(ESPERA));
                // Un disco externo que se desmonta tira acá. No es algo que
                // haya que contarle a nadie: la carpeta tampoco se puede leer,
                // y de eso ya se entera el que intente abrirla.
                v.on('error', () => {});
                vigilantes.push(v);
            } catch (e) { /* la carpeta ya no está */ }
        }
    }

    function programar(ms) {
        if (!vivo || temporizador) return;
        temporizador = setTimeout(() => {
            temporizador = null;
            revisar();
        }, ms);
        if (temporizador.unref) temporizador.unref();
    }

    function revisar() {
        if (!vivo) return;

        // `Pre versions/` puede haberse creado recién, con la primera versión
        // que Claude archiva. Sin esto, esa carpeta no la miraría nadie hasta
        // que se reabra el curso.
        escuchar();

        const enDisco = versiones.rutasEnDisco(raiz);
        const { nuevas, movidas, faltantes } = comparar(conocidas(), enDisco);

        const asentado = asentadas(nuevas, tamanos);
        tamanos = asentado.tamanos;
        if (asentado.creciendo) programar(REINTENTO);

        if (!asentado.quietas.length && !movidas.length && !faltantes.length) return;

        const firma = JSON.stringify([asentado.quietas, movidas.map(m => m.a), faltantes]);
        if (firma === ultimoAviso) return;
        ultimoAviso = firma;

        alCambiar({ nuevas: asentado.quietas, movidas, faltantes });
    }

    escuchar();

    return {
        /** Para forzar una revisión sin esperar al disco. Para los tests. */
        revisar,
        parar() {
            vivo = false;
            if (temporizador) clearTimeout(temporizador);
            temporizador = null;
            for (const v of vigilantes) v.close();
            vigilantes = [];
        }
    };
}

module.exports = { ESPERA, REINTENTO, comparar, asentadas, mirar };
