'use strict';
/**
 * versiones.js — La carpeta de renders leída como una lista de clases, cada una
 * con sus versiones.
 *
 * Claude renombra lo que entrega poniéndole el número de versión al final, así
 * que en la carpeta hay esto:
 *
 *   Clase 03 - Hooks.mp4
 *   Clase 03 - Hooks v2.mp4
 *   Clase 03 - Hooks v3.mp4
 *   Clase 04 - Estado_v2.mov
 *
 * y lo que el editor quiere ver son DOS filas, no cuatro. Agrupar es lo único
 * que hace este archivo, y hay tres decisiones adentro:
 *
 * 1. **Sin sufijo es la v1.** El primer render que entrega Claude no suele
 *    llevar número, y tratarlo como una clase aparte partía en dos la historia
 *    de la misma secuencia justo donde empieza.
 * 2. **Los tres separadores valen** (` v2`, `_v2`, `-v2`), porque los tres
 *    aparecen según quién nombró el archivo, y el editor no tiene por qué
 *    acordarse de cuál usó.
 * 3. **La extensión no agrupa.** `Clase 03.mp4` y `Clase 03 v2.mov` son la misma
 *    clase: Claude puede cambiar de contenedor entre una versión y otra y eso no
 *    la convierte en otra cosa.
 *
 * Lo que NO se hace es inventar versiones que no están: si en la carpeta hay v1
 * y v3, la lista dice v1 y v3. Un hueco es información —alguien borró algo— y
 * taparlo con una fila vacía sería peor.
 *
 * **`Pre versions/` también se lee.** Cuando Claude entrega una versión nueva
 * mueve la anterior ahí con su carpeta de comentarios, para que la raíz tenga
 * solo lo final y elegir una clase sea elegir un renglón. Pero archivar no es
 * borrar: esas versiones siguen siendo de la misma clase, siguen apareciendo
 * en los botones de arriba del visor y sus comentarios siguen abriéndose. Si
 * no se leyeran, la v1 que el editor comentó el lunes desaparecería el martes
 * sin dejar rastro, que es la peor forma de perder trabajo.
 */

const fs = require('fs');
const path = require('path');

const edicionLib = require('./edicion');
const probe = require('./media-probe');
const workspace = require('./workspace');
const { RE_VERSION, EXTENSIONES, esRender, partir, marcasDe, marcasDeArchivos, partirEntre, parteDe, sinParte, clave, etiquetaDe } = require('./nombres');

/** Los archivos de video de una carpeta, sin entrar en subcarpetas. */
function archivosDe(raiz) {
    let entradas;
    try {
        entradas = fs.readdirSync(raiz, { withFileTypes: true });
    } catch (e) {
        return { error: e.code === 'ENOENT' ? 'Esa carpeta ya no está.' : e.message, archivos: [] };
    }

    const archivos = entradas
        .filter(e => e.isFile() && esRender(e.name))
        .map(e => path.join(raiz, e.name));

    return { error: null, archivos };
}

/**
 * Los renders guardados en `Pre versions/`, sin los que son copia de la raíz.
 *
 * Lo de descartar copias es por el que mueve los archivos: si en vez de mover
 * copia, el mismo render queda en los dos lados y la clase mostraría dos veces
 * la misma versión, una de ellas con los comentarios en la otra carpeta. Se
 * descarta por nombre de archivo, que es lo que se repite en ese caso —dos
 * versiones distintas nunca se llaman igual—, y gana la de la raíz porque es
 * la que el editor ve en el Finder.
 *
 * Un nivel y nada más: adentro de `Pre versions/` hay videos y las carpetas de
 * sus comentarios, no otra carpeta de versiones anteriores.
 */
function archivadasDe(raiz, deLaRaiz) {
    const carpeta = workspace.carpetaPrevias(raiz);
    if (!carpeta) return [];

    const yaEstan = new Set(deLaRaiz.map(r => path.basename(r)));
    return archivosDe(carpeta).archivos.filter(r => !yaEstan.has(path.basename(r)));
}

// ─── Las ediciones, que son versiones sin render ──────────────────────
//
// Claude también entrega clases montadas y sin renderizar: una carpeta con un
// `edit.json` que dice los cortes, y los proxies al lado. La app las compone en
// vivo. Son versiones de la misma clase que los renders y no una lista aparte,
// porque revisarlas es lo mismo —mirar, marcar un momento, pedir un cambio— y
// porque una edición viene SIEMPRE de un render: la pregunta que el editor se
// hace es «¿qué cambió respecto de la v3?», y esa pregunta solo se puede hacer
// si las dos están en el mismo renglón.

/** Lo que toda versión lleva, sea un render o una edición. */
function fila(ruta, { n, explicita, archivo, media, archivada = false, edicion = false }) {
    return {
        n,
        explicita,
        edicion,
        archivada,
        etiqueta: etiquetaDe({ n, edicion }),
        ruta,
        archivo,
        carpeta: workspace.carpetaDeVersion(ruta),
        tieneComentarios: workspace.tieneComentarios(ruta),
        comentarios: workspace.cuantosComentarios(ruta),
        media
    };
}

function agregar(porClase, nombre, version) {
    const k = clave(nombre);
    if (!porClase.has(k)) porClase.set(k, { id: k, nombre, versiones: [] });
    porClase.get(k).versiones.push(version);
}

const viva = clase => clase.versiones.some(v => !v.archivada);

/**
 * Lo que solo está en Pre versions va a parar a la clase de la que es historia.
 *
 * `Pre versions/` son versiones anteriores, y se llega a ellas desde los
 * botones de versión de su clase, no desde la lista. Casi siempre comparten
 * nombre con la de la raíz y ya cayeron juntas. Lo que queda suelto son las
 * clases que Claude partió o juntó entre una entrega y otra: `06_Curso_V2`,
 * que después fue `06_Curso_p1_V2` y `06_Curso_p2_V2`; o `08_Curso_p1_V2` y
 * `08_Curso_p2_V2`, que después fueron `08_Curso_V2`. Sin la marca de parte
 * los nombres coinciden, y la numeración lo confirma: las partes de la 06
 * empiezan en v2 porque la v1 fue la clase entera.
 *
 * Solo se mueve lo que no tiene ninguna versión a la vista: dos clases que
 * siguen vivas nunca se mezclan. Y lo que no encuentra de quién es historia
 * —una clase archivada entera— se queda en la lista, porque es lo único que
 * queda de ella y esconderlo sería perderla de vista sin haberla borrado.
 *
 * Una clase entera que se partió en dos es la v1 de las dos partes, así que
 * cuelga de las dos.
 */
function colgarArchivadas(porClase) {
    const vivas = [...porClase.values()].filter(viva);
    for (const [k, suelta] of porClase) {
        if (viva(suelta)) continue;
        const raiz = clave(sinParte(suelta.nombre));
        const deQuien = vivas.filter(c => clave(sinParte(c.nombre)) === raiz);
        if (!deQuien.length) continue;

        const parte = parteDe(suelta.nombre);
        for (const clase of deQuien) {
            for (const v of suelta.versiones) {
                clase.versiones.push({ ...v, parte, etiqueta: etiquetaDe({ n: v.n, edicion: v.edicion, parte }) });
            }
        }
        porClase.delete(k);
    }
}

/**
 * Una carpeta de edición → de qué clase es y la versión que la representa.
 *
 * De qué clase lo decide `edicion.nombreDe`, aunque la edición no se pueda
 * abrir: una edición rota aparece en el renglón de SU clase con el motivo,
 * igual que un render ilegible.
 *
 * El `media` es inventado y tiene que serlo: no hay un archivo que medir, hay
 * una receta para armar uno. Se rellena con lo que el `edit.json` declara para
 * que la ficha del visor, la suma de duración del curso y la proporción del
 * lienzo funcionen sin que nada de eso tenga que saber qué es una edición.
 */
function versionDeEdicion(carpeta, marcas) {
    const leido = edicionLib.leer(carpeta);
    const ruta = path.join(carpeta, edicionLib.ARCHIVO);
    const { clase, version, explicita } = edicionLib.nombreDe(carpeta, leido.identidad, marcas);

    const ed = leido.edicion;
    const media = leido.ok
        ? {
            ruta,
            ok: true,
            codec: 'edición',
            ancho: ed.ancho,
            alto: ed.alto,
            anchoReal: ed.ancho,
            vertical: ed.alto > ed.ancho,
            fps: ed.fps,
            duracion: ed.duracion,
            cuadros: ed.cuadros,
            conAudio: true
        }
        : { ruta, ok: false, error: leido.error };

    return {
        clase,
        // El nombre de la CARPETA y no «edit.json»: en el botón de versión y
        // en el título, «edit.json» sería el mismo texto para las veintiocho
        // clases.
        version: fila(ruta, { n: version, explicita, edicion: true, archivo: path.basename(carpeta), media })
    };
}

/**
 * Lee una carpeta y devuelve sus clases, cada una con sus versiones medidas.
 *
 * Las versiones van de la más vieja a la más nueva y la última es la que se
 * abre: revisar es mirar lo último que entregó Claude, y empezar por la v1
 * obligaría a un clic en cada clase para llegar a donde uno quería estar.
 *
 * @returns {Promise<{raiz:string, error:string|null, clases:Array}>}
 */
async function escanear(raiz) {
    const { error, archivos } = archivosDe(raiz);
    if (error) return { raiz, error, clases: [] };

    const guardadas = archivadasDe(raiz, archivos);
    const archivada = new Set(guardadas);

    const medidos = await probe.medirVarios([...archivos, ...guardadas]);
    const porClase = new Map();
    const base = ruta => path.basename(ruta, path.extname(ruta));
    // Los nombres se leen todos juntos, raíz y archivadas: la primera versión
    // de una serie suele estar en `Pre versions/` y lo que dice de qué clase es
    // —el resto de la serie— en la raíz (ver `nombres.partirEntre`).
    const marcas = marcasDeArchivos(medidos.map(m => base(m.ruta)));

    for (const media of medidos) {
        const { clase, version, explicita } = partirEntre(base(media.ruta), marcas);
        agregar(porClase, clase, fila(media.ruta, {
            n: version,
            explicita,
            archivada: archivada.has(media.ruta),
            archivo: path.basename(media.ruta),
            media
        }));
    }

    for (const carpeta of edicionLib.todasEn(raiz)) {
        const { clase, version } = versionDeEdicion(carpeta, marcas);
        agregar(porClase, clase, version);
    }

    colgarArchivadas(porClase);
    const clases = [...porClase.values()];
    for (const c of clases) {
        // Por número, y con el nombre de archivo para desempatar: dos archivos
        // que declaran la misma versión (un `.mov` y su `.mp4`) tienen que salir
        // siempre en el mismo orden, o la versión que se abre al entrar cambia
        // de una sesión a la otra sin motivo.
        //
        // La archivada va primero cuando empatan en número, así la que se abre
        // es la de la raíz. Ese empate solo pasa si alguien archivó una versión
        // y dejó otra con el mismo número afuera —un estado raro— y ahí lo
        // razonable es abrir lo que está a la vista.
        //
        // Y la edición va DESPUÉS del render con el mismo número, porque es
        // posterior: propone cambiarlo. Como la que se abre es la última, al
        // entrar a una clase que tiene edición se abre el preview, que es lo
        // que está esperando respuesta.
        c.versiones.sort((a, b) => a.n - b.n
            || (a.archivada === b.archivada ? 0 : (a.archivada ? -1 : 1))
            || (Boolean(a.edicion) === Boolean(b.edicion) ? 0 : (a.edicion ? 1 : -1))
            || a.archivo.localeCompare(b.archivo, 'es'));
        c.ultima = c.versiones[c.versiones.length - 1];
        c.conComentarios = c.versiones.filter(v => v.tieneComentarios).length;
    }

    // Las clases, en el orden en que el editor las lee: `localeCompare` con
    // `numeric` para que "Clase 10" vaya después de "Clase 9" y no entre la 1 y
    // la 2.
    clases.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { numeric: true }));

    return { raiz, error: null, clases };
}

/**
 * Los renders que hay AHORA en una carpeta, sin medir ninguno.
 *
 * Es lo mismo que mira `escanear` pero sin ffprobe, que es lo caro. Sirve para
 * contestar «¿cambió algo?» cada vez que el disco se mueve, que con Claude
 * trabajando al lado puede ser cada pocos segundos: medir veintiocho archivos
 * para descubrir que no hay nada nuevo sería gastar medio minuto de CPU en una
 * pregunta que se contesta con un `readdir`.
 */
function rutasEnDisco(raiz) {
    const { archivos } = archivosDe(raiz);
    const ediciones = edicionLib.todasEn(raiz).map(c => path.join(c, edicionLib.ARCHIVO));
    return [...archivos, ...archivadasDe(raiz, archivos), ...ediciones];
}

/** Las rutas que la ventana va a poder pedirle al protocolo. */
function rutasDe(clases) {
    const rutas = [];
    for (const clase of clases) {
        for (const version of clase.versiones) rutas.push(version.ruta);
    }
    return rutas;
}

/**
 * De qué clase y qué versión es una ruta, sin medirla.
 *
 * Para lo que llega nuevo al disco, antes de volver a escanear. Una edición se
 * reconoce por el nombre de su archivo y su clase sale del `based_on`: partir
 * `edit.json` por el nombre daba una clase llamada «edit», que no existe.
 *
 * @param {Array} [conocidas] las clases ya escaneadas, para leer el nombre
 *   como lo lee el escaneo (ver `nombres.partirEntre`)
 */
function claseDeRuta(ruta, conocidas) {
    const marcas = marcasDe((conocidas || []).map(c => c.nombre));
    if (path.basename(ruta) === edicionLib.ARCHIVO) {
        const { clase, version } = versionDeEdicion(path.dirname(ruta), marcas);
        return { clase, n: version.n };
    }
    const { clase, version } = partirEntre(path.basename(ruta, path.extname(ruta)), marcas);
    return { clase, n: version };
}

/** Una versión por su ruta, dentro de lo ya escaneado. */
function buscarVersion(clases, ruta) {
    for (const clase of clases) {
        const version = clase.versiones.find(v => v.ruta === ruta);
        if (version) return { clase, version };
    }
    return null;
}

module.exports = {
    EXTENSIONES,
    RE_VERSION,
    partir,
    clave,
    archivosDe,
    escanear,
    rutasEnDisco,
    rutasDe,
    claseDeRuta,
    buscarVersion
};
