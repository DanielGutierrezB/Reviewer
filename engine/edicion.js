'use strict';
/**
 * edicion.js — Leer una carpeta de edición y decidir si se puede reproducir.
 *
 * Claude exporta la clase montada sin renderizarla: un `edit.json` con los
 * cortes, los layouts y la geometría, más los medios en proxy al lado. La
 * ventana la compone en vivo sobre un canvas. Revisar deja de costar el render.
 *
 * Lo único que hace este archivo es convertir ese JSON en algo de lo que la
 * ventana se pueda fiar:
 *
 * 1. **Resuelve las rutas.** Todas cuelgan de la carpeta de la edición, también
 *    las que apuntan al curso: `reference_render` y los `original` de cada
 *    medio llevan el `../` escrito adentro. Resolverlas contra la carpeta del
 *    curso «porque son del curso» sube un nivel de más y apuntan a nada.
 * 2. **Comprueba que los archivos estén, ANTES de abrir.** Un `edit.json` que
 *    nombra una escena que no está tiene que fallar diciendo cuál falta, no
 *    quedarse negro a los tres minutos de reproducción. Pero falta un archivo y
 *    falta un archivo no es lo mismo: sin `mix.m4a` no hay reloj y no hay nada
 *    que mirar; sin un `hl/*.png` falta un subrayado amarillo en un cuadro. Los
 *    primeros son `esenciales` y cierran la puerta; los segundos son `adornos`
 *    y solo se avisan.
 * 3. **Comprueba que los shots cubran la línea entera.** El modelo de tiempo
 *    busca el shot que contiene al cuadro `f`; si hay un hueco, ese cuadro no
 *    tiene shot y la pantalla se va a negro sin que nadie sepa por qué. Es más
 *    barato descubrirlo acá, con el número del cuadro en la mano.
 * 4. **Dice lo que el preview no sabe componer.** Un cuadro de otro tamaño o
 *    de otro fps no se rechaza a mitad de camino con una imagen deformada:
 *    se rechaza acá, con los números.
 *
 * Lo que NO hace: escribir. La carpeta de edición es de Claude y se lee entera
 * de solo lectura; lo que el editor deja vive aparte, en `feedback/` (ver
 * `workspace.carpetaDeVersion`).
 */

const fs = require('fs');
const path = require('path');

const nombres = require('./nombres');
const workspace = require('./workspace');

/** El archivo que convierte una carpeta cualquiera en una carpeta de edición. */
const ARCHIVO = workspace.EDICION_ARCHIVO;

/** Lo que tiene que decir `format` para que esto sea nuestro. */
const FORMATO = 'claude-edit-preview';

/**
 * ¿Esta carpeta es una edición?
 *
 * Se lee el archivo en vez de confiar en que exista: una carpeta con un
 * `edit.json` de otra cosa —hay mil programas que usan ese nombre— no es una
 * edición de Claude, y abrirla como si lo fuera daría un error incomprensible
 * cincuenta líneas más adelante.
 */
function es(carpeta) {
    const archivo = path.join(carpeta, ARCHIVO);
    try {
        if (!fs.statSync(archivo).isFile()) return false;
    } catch (e) {
        return false;
    }
    try {
        const crudo = JSON.parse(fs.readFileSync(archivo, 'utf8'));
        return crudo && crudo.format === FORMATO;
    } catch (e) {
        // Un JSON roto no es una edición. El que la abra a propósito va a ver
        // el error de `leer`; en un escaneo de veintiocho carpetas, esto es
        // solo «esta no».
        return false;
    }
}

/**
 * Las subcarpetas visibles de una raíz: ni ocultas ni con `_` adelante.
 *
 * Es la regla de qué carpeta puede ser una edición, y la usan los dos que la
 * necesitan —buscarlas y vigilarlas—, para que no se despeguen.
 */
function subcarpetas(raiz) {
    let entradas;
    try {
        entradas = fs.readdirSync(raiz, { withFileTypes: true });
    } catch (e) {
        return [];
    }
    return entradas
        .filter(e => e.isDirectory() && !e.name.startsWith('.') && !e.name.startsWith('_'))
        .map(e => path.join(raiz, e.name));
}

/** Las subcarpetas de una raíz que son ediciones. */
function buscarEn(raiz) {
    return subcarpetas(raiz)
        .filter(es)
        .sort((a, b) => path.basename(a).localeCompare(path.basename(b), 'es', { numeric: true }));
}

/** Las ediciones de una raíz, incluida la raíz misma. */
function todasEn(raiz) {
    // Abrir directamente la carpeta de una clase tiene que funcionar: es lo
    // que uno hace cuando Claude le pasa una sola.
    const dentro = buscarEn(raiz);
    return es(raiz) ? [raiz, ...dentro] : dentro;
}

/**
 * De qué clase y qué versión es una edición: las del render que propone
 * reemplazar, que dice `based_on`.
 *
 * Sin `based_on` queda el nombre de la carpeta, que es lo único que hay.
 *
 * @param {object|null} identidad la de `leer`, que existe aunque la edición no
 *   se pueda abrir
 * @param {Set<string>} [marcas] las de la carpeta, para leer el nombre como
 *   lo lee el escaneo (ver `nombres.partirEntre`)
 */
function nombreDe(carpeta, identidad, marcas = new Set()) {
    const basadoEn = identidad && identidad.basadoEn;
    const base = basadoEn ? path.basename(basadoEn, path.extname(basadoEn)) : path.basename(carpeta);
    return nombres.partirEntre(base, marcas);
}

/**
 * Juntador de archivos: cada uno con su rol y de dónde salió.
 *
 * Existe para que la comprobación de existencia sea una sola pasada al final y
 * no un `if (fs.existsSync(...))` repetido veinte veces entre medio de la
 * lectura, que es como se cuela el que falta.
 */
function censo(carpeta) {
    const porRuta = new Map();

    /**
     * @param {string} relativa  tal como viene en el JSON
     * @param {string} rol       para el mensaje de error: «la escena tools»
     * @param {object} como
     * @param {boolean} como.esencial si sin esto no se puede reproducir
     * @param {boolean} como.imagen   si lo carga el compositor como imagen fija
     */
    function anotar(relativa, rol, { esencial = false, imagen = false } = {}) {
        if (!relativa) return null;
        const ruta = path.resolve(carpeta, relativa);
        // El mismo archivo nombrado dos veces —una máscara que comparten dos
        // layouts— se cuenta una sola vez, pero gana el rol esencial: si uno de
        // los dos usos no puede faltar, el archivo no puede faltar.
        const antes = porRuta.get(ruta);
        if (antes) {
            antes.esencial = antes.esencial || esencial;
        } else {
            porRuta.set(ruta, { ruta, relativa, rol, esencial, imagen, existe: fs.existsSync(ruta) });
        }
        return ruta;
    }

    return { anotar, lista: () => [...porRuta.values()] };
}

/**
 * Qué papel tiene cada medio que el JSON puede declarar.
 *
 * Sin `mix` no hay reloj y no hay nada que mirar; sin cámara, pantalla o fondo
 * faltan capas enteras. El logo es un adorno: sin él la clase se revisa igual.
 * Lo que no está acá —`livemix`, por ejemplo, que es para el render final— no
 * lo usa el preview, así que ni se exige ni se habilita en el protocolo.
 */
const MEDIOS = {
    mix: { esencial: true },
    cam: { esencial: true },
    screen: { esencial: true },
    bg_loop: { esencial: true },
    logo: { esencial: false, imagen: true }
};

/**
 * Lo único que este preview sabe componer.
 *
 * El compositor dibuja en un lienzo de 1920x1080, el zoom razona en 16:9 y los
 * pares A/B cuentan cuadros a 30 por segundo. Aceptar otra cosa y componerla
 * igual sería mostrar una imagen deformada sin decir por qué; rechazarla acá
 * dice exactamente qué es lo que no se soporta todavía.
 */
const FORMATO_DE_CUADRO = { ancho: 1920, alto: 1080, fps: 30 };

/**
 * Los shots, comprobados contra el modelo de tiempo que los va a buscar.
 *
 * @returns {string|null} el error, o `null` si cubren la línea entera
 */
function revisarShots(shots, cuadros) {
    if (!Array.isArray(shots) || !shots.length) return 'El edit.json no tiene shots.';

    let siguiente = 0;
    for (const shot of shots) {
        if (!Number.isInteger(shot.f0) || !Number.isInteger(shot.nf) || shot.nf <= 0) {
            return `El shot ${shot.i} no dice en qué cuadro empieza ni cuántos dura.`;
        }
        if (shot.f0 !== siguiente) {
            return shot.f0 > siguiente
                ? `Falta la imagen entre los cuadros ${siguiente} y ${shot.f0} (antes del shot ${shot.i}).`
                : `El shot ${shot.i} empieza en el cuadro ${shot.f0}, que ya lo cubre el shot anterior.`;
        }
        siguiente += shot.nf;
    }

    if (Number.isInteger(cuadros) && siguiente !== cuadros) {
        return `Los shots cubren ${siguiente} cuadros y el edit.json declara ${cuadros}.`;
    }
    return null;
}

/**
 * Lee una carpeta de edición.
 *
 * Devuelve siempre la misma forma: `{ok, error, identidad, faltan, edicion}`.
 * Cuando `ok` es falso, `error` ya está escrito para mostrárselo a una
 * persona. `faltan` puede traer cosas aunque `ok` sea verdadero: son los
 * adornos.
 *
 * `identidad` —el título y de qué render sale— viene en cuanto el JSON se
 * pudo leer, aunque después algo falle. Es lo que deja mostrar una edición
 * rota en el renglón de SU clase, con el motivo, en vez de en una clase
 * fantasma con el nombre de la carpeta.
 */
function leer(carpeta) {
    const archivo = path.join(carpeta, ARCHIVO);
    const fallo = (error, identidad = null, faltan = []) => ({ ok: false, error, identidad, faltan });

    let crudo;
    try {
        crudo = JSON.parse(fs.readFileSync(archivo, 'utf8'));
    } catch (e) {
        return fallo(e.code === 'ENOENT' ? 'Esa carpeta no tiene un edit.json.' : `El edit.json no se pudo leer: ${e.message}`);
    }

    if (crudo.format !== FORMATO) {
        return fallo(`Ese edit.json dice ser «${crudo.format || 'nada'}» y no una edición de Claude.`);
    }

    const identidad = { titulo: crudo.title || path.basename(carpeta), basadoEn: crudo.based_on || null };

    const { ancho, alto, fps } = FORMATO_DE_CUADRO;
    if (crudo.width !== ancho || crudo.height !== alto || crudo.fps !== fps) {
        return fallo(`Esta versión de Reviewer compone ediciones de ${ancho}x${alto} a ${fps} fps, `
            + `y esta es de ${crudo.width}x${crudo.height} a ${crudo.fps} fps.`, identidad);
    }
    if (!crudo.media || !crudo.media.mix) {
        return fallo('El edit.json no declara el audio mezclado (media.mix), que es el reloj del preview.', identidad);
    }

    const malos = revisarShots(crudo.shots, crudo.duration_frames);
    if (malos) return fallo(malos, identidad);

    const { anotar, lista } = censo(carpeta);

    const medios = {};
    for (const [nombre, m] of Object.entries(crudo.media)) {
        const papel = MEDIOS[nombre];
        if (!papel) continue;
        medios[nombre] = {
            ...m,
            ruta: anotar(m.file, `el medio ${nombre}`, papel),
            // El original es de otra carpeta y hoy no se reproduce: se guarda
            // para cuando el export use la fuente en vez del proxy. No se
            // cuenta en el censo porque no estar no impide revisar.
            original: m.original ? path.resolve(carpeta, m.original) : null
        };
    }

    const escenas = {};
    for (const [nombre, e] of Object.entries(crudo.scenes || {})) {
        escenas[nombre] = { ...e, ruta: anotar(e.file, `la escena ${nombre}`, { esencial: true }) };
    }

    const overlays = (crudo.overlays || []).map((o, i) => ({
        ...o,
        ruta: anotar(o.file, `el overlay ${i + 1}`, { esencial: true })
    }));

    // Máscaras, aros y subrayados: adornos. Que falte uno deja un cuadro peor,
    // no una clase sin revisar. Las rutas se escriben sobre el mismo objeto
    // recién leído: es una copia del disco que no comparte nadie.
    const adorno = { imagen: true };
    const geometria = crudo.geometry || {};
    for (const parte of ['box', 'pip', 'side', 'split_screen']) {
        const g = geometria[parte];
        if (!g) continue;
        g.rutaMascara = anotar(g.mask, `la máscara de ${parte}`, adorno);
        g.rutaAro = anotar(g.ring, `el aro de ${parte}`, adorno);
    }
    for (const shot of crudo.shots) {
        for (const hl of (shot.screen && shot.screen.highlights) || []) {
            hl.ruta = anotar(hl.file, `un subrayado del shot ${shot.i}`, adorno);
        }
    }

    const censados = lista();
    const faltan = censados.filter(a => !a.existe).map(a => a.relativa);
    const rotos = censados.filter(a => !a.existe && a.esencial);
    if (rotos.length) {
        const nombres = rotos.slice(0, 3).map(a => `${a.relativa} (${a.rol})`).join(', ');
        const resto = rotos.length > 3 ? ` y ${rotos.length - 3} más` : '';
        return fallo(`Faltan archivos que la edición necesita: ${nombres}${resto}.`, identidad, faltan);
    }

    const presentes = censados.filter(a => a.existe);
    const referencia = crudo.reference_render ? path.resolve(carpeta, crudo.reference_render) : null;

    return {
        ok: true,
        error: null,
        identidad,
        faltan,
        edicion: {
            carpeta,
            archivo,
            ...identidad,
            fps,
            ancho,
            alto,
            cuadros: crudo.duration_frames,
            duracion: crudo.duration,
            medios,
            escenas,
            overlays,
            geometria,
            shots: crudo.shots,
            bloques: crudo.blocks || [],
            audio: crudo.audio || [],
            referencia: referencia && fs.existsSync(referencia) ? referencia : null,
            // Lo que de verdad existe en disco, para la lista blanca del
            // protocolo: pedirle al protocolo que habilite un archivo que no
            // está es pedirle que guarde una ruta muerta.
            archivos: presentes.map(a => a.ruta),
            // Las que el compositor carga como imagen fija antes de empezar.
            imagenes: presentes.filter(a => a.imagen).map(a => a.ruta)
        }
    };
}

module.exports = {
    ARCHIVO,
    es,
    subcarpetas,
    todasEn,
    nombreDe,
    leer
};
