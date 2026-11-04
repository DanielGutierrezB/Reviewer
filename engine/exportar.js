'use strict';
/**
 * exportar.js — Todo el feedback del curso en una carpeta sola, para pasársela
 * a Claude de una vez.
 *
 * Hasta acá cada versión tenía su `feedback.md` al lado del render, que es lo
 * correcto mientras se revisa: el feedback viaja con el video y no hay una base
 * de datos que se pueda desincronizar. Pero para entregar el trabajo eso son
 * veintitrés archivos repartidos en veintitrés carpetas, y señalárselos uno por
 * uno al agente es donde se pierden tres.
 *
 * Lo que arma esto es un producto, no un lugar de trabajo:
 *
 *   <raíz>/Feedback/
 *     FEEDBACK.md              el curso entero, en orden
 *     <clase>_feedback.md      una clase sola, para pasarla de a una
 *     References/              los cuadros, dibujos, adjuntos y referencias
 *                              de todos los documentos de arriba
 *
 * Tres decisiones:
 *
 * 1. **Cada documento se rehace entero, y nada más que él.** Lo que dice es
 *    siempre lo de su última exportación, y lo que dejó de usar se va de
 *    `References/` —salvo que lo use otro documento (ver `ordenarRecursos`)—.
 *    Una carpeta que acumula es una carpeta donde hay un cuadro de un
 *    comentario que ya se borró, y el que la lee no tiene cómo saber cuál
 *    sobra. Exportar una clase no toca el documento del curso, ni al revés.
 * 2. **Se copian los archivos adentro.** Pesa más, pero la carpeta se vale por
 *    sí sola: se puede mandar, guardar como registro de lo que se pidió, o
 *    abrir dentro de un mes cuando los cuadros originales ya se borraron con
 *    su comentario.
 * 3. **Las rutas van relativas a la carpeta de la entrega, que se dice una vez
 *    arriba con su ruta completa.** El agente no adivina contra qué carpeta
 *    resolver una ruta relativa —por eso la base va explícita—, y con la base
 *    dicha no hace falta escribir la ruta de esta máquina en cada renglón: la
 *    carpeta se puede mover o mandar entera sin que se rompa nada.
 *
 * Solo van los comentarios abiertos. Es la lista de lo que hay que hacer; un
 * resuelto ya está hecho y ocupa lugar en lo que el modelo lee.
 *
 * **Cada clase lleva su encargo arriba**: el modelo local lee sus comentarios
 * y los devuelve ordenados (`encargosAlDia`). Es un paso aparte y anterior a
 * `exportar` porque es lento y puede fallar, y ninguna de las dos cosas puede
 * frenar la entrega: una clase sin encargo sale igual, con su lista completa.
 */

const fs = require('fs');
const path = require('path');

const adjuntos = require('./adjuntos');
const comentariosLib = require('./comentarios');
const encargo = require('./encargo');
const entrega = require('./entrega');
const feedback = require('./feedback');
const generalLib = require('./general');
const menciones = require('./menciones');
const { etiquetaDe } = require('./nombres');
const prompts = require('./prompts');
const workspace = require('./workspace');

const DOCUMENTO = 'FEEDBACK.md';

/**
 * Los archivos de todos los documentos, juntos en una carpeta.
 *
 * Cuadros, dibujos, adjuntos y las referencias del curso: lo que Claude tiene
 * que abrir para entender un comentario. Uno solo para todos los documentos de
 * `Feedback/` —el del curso y los de cada clase—, porque son los mismos
 * archivos: el cuadro de un comentario de la 03 es el mismo en el export del
 * curso y en el de esa clase, y con el mismo nombre se guarda una sola vez.
 */
const { RECURSOS_DIR } = entrega;

/** Lo que macOS deja en una carpeta que se abrió en el Finder. No es de nadie. */
const DEL_FINDER = '.DS_Store';

/**
 * Lo que dejaba el export de antes, con una subcarpeta por cosa y otra por
 * clase. Se va la primera vez que se exporta con este: los documentos de ahora
 * no lo nombran, y una carpeta con dos formas de estar armada no se entiende.
 */
const ANTERIORES = ['imagenes', 'adjuntos', '_referencias', 'Clases'];

/**
 * Cómo se llama el documento.
 *
 * El de una clase lleva su nombre porque se le pasa a Claude suelto, de a uno:
 * con cinco `FEEDBACK.md` iguales abiertos en cinco pestañas, o arrastrados a
 * un chat, no hay forma de saber cuál es de qué clase sin abrirlo.
 */
function documentoDe(clase) {
    return clase ? `${clase.nombre}_feedback.md` : DOCUMENTO;
}

/**
 * Si una carpeta `Feedback` la hizo Reviewer y se puede escribir adentro.
 *
 * Lo es si no existe, si está vacía, si tiene el índice de `References/` o el
 * documento del curso. Cualquier otra cosa es de alguien, y no se toca.
 */
function esNuestra(carpeta) {
    let entradas;
    try {
        entradas = fs.readdirSync(carpeta);
    } catch (e) {
        return true;
    }
    return entradas.includes(DOCUMENTO)
        || fs.existsSync(path.join(carpeta, RECURSOS_DIR, entrega.INDICE))
        || entradas.every(e => e === DEL_FINDER);
}

/**
 * Deja `Feedback/` lista para escribir un documento.
 *
 * Se niega a tocar una carpeta que no haya hecho Reviewer. Es barato y evita
 * el único accidente caro de todo esto: alguien que ya tenía una carpeta con
 * ese nombre y sus cosas adentro.
 */
function preparar(carpeta, nombreDoc) {
    if (!esNuestra(carpeta)) {
        return { ok: false, error: `Ya hay una carpeta «${workspace.EXPORTACION_DIR}» con cosas adentro que no son de Reviewer. Movela o cambiale el nombre y volvé a exportar.` };
    }
    workspace.ensureDir(path.join(carpeta, RECURSOS_DIR));

    const habiaAnterior = ANTERIORES.some(n => fs.existsSync(path.join(carpeta, n)));
    for (const n of ANTERIORES) fs.rmSync(path.join(carpeta, n), { recursive: true, force: true });
    // El documento del curso del export de antes nombraba esas carpetas. Si
    // ahora se exporta una clase sola, ese documento quedaría apuntando a
    // nada: se va también, y vuelve en cuanto se exporte el curso.
    if (habiaAnterior && nombreDoc !== DOCUMENTO) fs.rmSync(path.join(carpeta, DOCUMENTO), { force: true });
    return { ok: true };
}

/**
 * Un nombre de archivo que se lee bien desde cualquier herramienta: sin
 * espacios, sin tildes, sin nada que haya que escapar en una ruta.
 */
function nombreLimpio(original) {
    const ext = path.extname(original).toLowerCase();
    return `${workspace.slug(path.basename(original, path.extname(original)))}${ext}`;
}

/**
 * El nombre que le toca a un archivo dentro de un mismo documento.
 *
 * Siempre el mismo para el mismo archivo —así el export del curso y el de la
 * clase lo comparten—; con un número si dos del mismo documento pidieran el
 * mismo, que solo pasa con dos adjuntos iguales en un comentario.
 */
function unico(nombre, usados) {
    const ext = path.extname(nombre);
    const base = path.basename(nombre, ext);
    let intento = nombre;
    for (let n = 2; usados.has(intento); n++) intento = `${base}-${n}${ext}`;
    usados.add(intento);
    return intento;
}

/**
 * Las versiones que tienen algo por hacer, en el orden de la lista de clases.
 *
 * Por versión y no por clase: si quedaron comentarios abiertos en la v1 y
 * Claude ya entregó la v3, esos pedidos siguen sin estar hechos y entran
 * igual. Lo que se hace es decirlo —`vieja`—, porque leerlos sin saber que son
 * de dos versiones atrás lleva a rehacer algo que ya se rehizo.
 */
function recolectar(clases) {
    const partes = [];
    // Una clase entera que Claude partió en dos es la v1 de las dos partes, y
    // está en las dos (`versiones.colgarArchivadas`). Sus comentarios son uno
    // solo y se piden una sola vez.
    const vistas = new Set();
    for (const clase of clases) {
        const ultima = clase.versiones[clase.versiones.length - 1];
        for (const version of clase.versiones) {
            if (vistas.has(version.ruta)) continue;
            vistas.add(version.ruta);
            const datos = comentariosLib.leer(version.ruta, version.media);
            const abiertos = datos.comentarios.filter(c => c.estado === 'abierto');
            if (!abiertos.length) continue;
            partes.push({
                clase,
                version,
                datos,
                abiertos,
                vieja: ultima && version.ruta !== ultima.ruta ? etiquetaDe(ultima) : null
            });
        }
    }
    return partes;
}

/** Las clases que entran: todas, o la que se pidió. */
function elegir(clases, soloClase) {
    return soloClase ? clases.filter(c => c.id === soloClase) : clases;
}

/**
 * Pone al día el encargo de cada versión que va a entrar al export.
 *
 * Solo pide los que faltan o quedaron viejos: un encargo cuya huella coincide
 * resume exactamente lo que hay, y rehacerlo sería esperar al modelo para
 * obtener lo mismo. Así exportar dos veces seguidas no cuesta dos veces.
 *
 * Uno por uno y no en paralelo: el modelo es local, y pedirle doce a la vez es
 * hacerlo ir doce veces más lento en cada uno.
 *
 * Nunca lanza ni frena: lo que falla se cuenta y la clase sale sin encargo.
 *
 * @param {object} opciones
 * @param {string|null} opciones.soloClase
 * @param {object} opciones.config      el modelo activo, de `ajustes.llmActivo`
 * @param {Function} opciones.contextoDe ruta → contexto para reescribir su `feedback.md`
 * @param {Function} [opciones.alAvanzar] `{hecho, total, nombre}` antes de cada uno
 * @returns {Promise<{hechos:number, vigentes:number, fallados:string[], sinModelo:boolean}>}
 */
async function encargosAlDia(raiz, clases, { soloClase = null, config, contextoDe, alAvanzar = () => {} }) {
    const partes = recolectar(elegir(clases, soloClase));
    const general = generalLib.leer(raiz).texto || '';
    const pendientes = partes.filter(p => !encargo.vigente(p.datos, general));
    const resultado = { hechos: 0, vigentes: partes.length - pendientes.length, fallados: [], sinModelo: false };

    if (!pendientes.length) return resultado;
    if (!config || !config.modelo) {
        resultado.sinModelo = true;
        return resultado;
    }

    for (const [i, p] of pendientes.entries()) {
        const nombre = `${p.clase.nombre} · ${etiquetaDe(p.version)}`;
        alAvanzar({ hecho: i, total: pendientes.length, nombre });
        const r = await prompts.prepararInstruccion(config, p.datos, {
            clase: p.clase.nombre,
            etiqueta: etiquetaDe(p.version),
            general
        });
        if (!r.ok) {
            resultado.fallados.push(`${nombre} (${r.motivo})`);
            continue;
        }
        // La huella de lo que el modelo LEYÓ, no de lo que hay ahora: si
        // alguien comentó mientras el modelo escribía, el encargo ya nació
        // viejo y tiene que contar como tal.
        comentariosLib.guardarInstruccion(p.version.ruta, r.texto, r.modelo, encargo.huellaDe(p.datos, general), contextoDe(p.version.ruta));
        resultado.hechos++;
    }
    return resultado;
}

/**
 * Copia los archivos de un comentario a `References/` y dice cómo se llaman ahí.
 *
 * Los nombres llevan clase, versión y id adelante porque acá se mezclan los
 * archivos de todas las clases en una carpeta: tres comentarios distintos
 * pueden tener un `c01-00h00m12s00f.png` y sin el prefijo se pisarían.
 */
function copiarDe(parte, comentario, recursos, usados) {
    const carpeta = workspace.carpetaDeVersion(parte.version.ruta);
    const prefijo = entrega.codigoDe(parte.clase, parte.version, comentario);

    const salida = [];
    for (const archivo of feedback.archivosDe(comentario, carpeta)) {
        if (!fs.existsSync(archivo.ruta)) continue;
        const propio = archivo.origen === 'adjunto'
            ? nombreLimpio(archivo.nombre || path.basename(archivo.ruta))
            : `${archivo.origen}${path.extname(archivo.ruta).toLowerCase()}`;
        const nombre = unico(`${prefijo}-${propio}`, usados);
        const copia = path.join(recursos, nombre);
        fs.copyFileSync(archivo.ruta, copia);
        salida.push({ ...archivo, original: archivo.ruta, ruta: copia });
    }
    return salida;
}

/** Las referencias del curso, copiadas a `References/`. */
function copiarReferencias(raiz, recursos, usados) {
    const salida = [];
    for (const ref of generalLib.leer(raiz).referencias) {
        if (ref.falta || !fs.existsSync(ref.ruta)) continue;
        const nombre = unico(`curso-${nombreLimpio(path.basename(ref.ruta))}`, usados);
        const copia = path.join(recursos, nombre);
        fs.copyFileSync(ref.ruta, copia);
        salida.push({ ...ref, ruta: copia });
    }
    return salida;
}

/**
 * Anota en el índice qué usa este documento y borra lo que dejó de usar.
 *
 * Solo lo que no usa ningún otro: el cuadro de un comentario que se resolvió
 * se va del export de la clase, pero si el del curso todavía no se rehízo y lo
 * nombra, se queda hasta entonces.
 *
 * Junto con los archivos van sus pedidos —qué comentario es cada código—, que
 * es lo que `entrega.aplicarHechos` necesita para leer las casillas.
 */
function ordenarRecursos(carpeta, nombreDoc, usados, pedidos) {
    const recursos = path.join(carpeta, RECURSOS_DIR);
    const indice = entrega.leerIndice(carpeta);
    const { documentos } = indice;

    const deOtros = new Set(Object.entries(documentos)
        .filter(([doc]) => doc !== nombreDoc)
        .flatMap(([, d]) => d.archivos));
    for (const viejo of (documentos[nombreDoc] || { archivos: [] }).archivos) {
        if (!usados.has(viejo) && !deOtros.has(viejo)) fs.rmSync(path.join(recursos, viejo), { force: true });
    }

    documentos[nombreDoc] = { archivos: [...usados].sort(), pedidos };
    entrega.escribirIndice(carpeta, indice);
}

/**
 * Arma un documento en `Feedback/`: el del curso o el de una clase.
 *
 * @param {string} raiz la carpeta de renders
 * @param {Array} clases lo que devolvió `versiones.escanear`
 * @param {object} [opciones]
 * @param {string} [opciones.soloClase] el id de una clase, para mandar una sola
 * @param {Function} [opciones.contextoDe] ruta → contexto, para resolver lo que
 *   Claude marcó como hecho con el `feedback.md` bien escrito
 */
function exportar(raiz, clases, opciones) {
    const soloClase = (opciones || {}).soloClase || null;
    const contextoDe = (opciones || {}).contextoDe || (ruta => ({ rutaVideo: ruta }));
    // Antes de leer nada: lo que Claude ya marcó como hecho se resuelve y no
    // entra. Y antes de reescribir el documento, que es donde están esas
    // marcas: rehacerlo sin leerlas sería borrarlas.
    entrega.aplicarHechos(raiz, contextoDe);
    const partes = recolectar(elegir(clases, soloClase));
    if (!partes.length) {
        return {
            ok: false,
            error: soloClase
                ? 'Esa clase no tiene comentarios por hacer.'
                : 'No hay ningún comentario por hacer para exportar.'
        };
    }

    const clase = soloClase ? clases.find(c => c.id === soloClase) : null;
    const carpeta = path.join(raiz, workspace.EXPORTACION_DIR);
    const nombreDoc = documentoDe(clase);
    const listo = preparar(carpeta, nombreDoc);
    if (!listo.ok) return listo;

    const recursos = path.join(carpeta, RECURSOS_DIR);
    const usados = new Set();
    const referencias = copiarReferencias(raiz, recursos, usados);
    const general = generalLib.leer(raiz);

    // Se copia todo primero y se escribe después: el documento nombra las
    // rutas de las copias, así que tienen que existir antes de nombrarlas.
    const pedidos = {};
    for (const parte of partes) {
        parte.archivos = new Map(parte.abiertos.map(c => [c.id, copiarDe(parte, c, recursos, usados)]));
        for (const c of parte.abiertos) pedidos[entrega.codigoDe(parte.clase, parte.version, c)] = entrega.pedidoDe(raiz, parte.version, c);
    }
    ordenarRecursos(carpeta, nombreDoc, usados, pedidos);

    const texto = documento({ raiz, carpeta, partes, general, referencias, soloClase });
    const archivo = path.join(carpeta, nombreDoc);
    fs.writeFileSync(archivo, texto, 'utf8');

    return {
        ok: true,
        carpeta,
        documento: archivo,
        clases: new Set(partes.map(p => p.clase.id)).size,
        comentarios: partes.reduce((n, p) => n + p.abiertos.length, 0),
        archivos: partes.reduce((n, p) => n + [...p.archivos.values()].reduce((m, a) => m + a.length, 0), 0)
            + referencias.length,
        viejas: partes.filter(p => p.vieja).map(p => `${p.clase.nombre} ${etiquetaDe(p.version)}`)
    };
}

/**
 * El markdown entero.
 *
 * Todas las rutas empiezan con la variable `{FEEDBACK}`, que se define una sola
 * vez arriba con la ruta de esta máquina (`entrega.lineaDeBase`). El documento
 * no lleva la ruta en cada renglón; si la carpeta se abre en otra computadora,
 * Reviewer corrige esa línea al abrirla y nada más. Y para el que la recibe sin
 * pasar por Reviewer, el documento dice cuál es la carpeta si esa ruta no
 * existe: la de este mismo archivo. Un agente no adivina contra qué carpeta
 * resolver una ruta, y por eso la base va explícita y con nombre.
 */
function documento({ raiz, carpeta, partes, general, referencias, soloClase }) {
    const L = [];
    const rel = ruta => entrega.rutaEn(carpeta, ruta);
    const cuantos = partes.reduce((n, p) => n + p.abiertos.length, 0);
    const cuantasClases = new Set(partes.map(p => p.clase.id)).size;

    L.push(`# Feedback de edición · ${path.basename(raiz)}`);
    L.push('');
    L.push('Lo escribió el editor revisando los renders, con Reviewer. Es todo lo que hay que');
    L.push('hacer: cada comentario dice en qué momento exacto del video pasa lo que se pide y,');
    L.push('cuando hace falta, trae el cuadro.');
    L.push('');
    L.push(`- **Ajustes por hacer:** ${cuantos} en ${cuantasClases} ${cuantasClases === 1 ? 'clase' : 'clases'}`);
    L.push(`- **Los renders están en:** ${rel(raiz)} (la carpeta de arriba)`);
    if (soloClase) L.push('- **Ojo:** es una sola clase, no el curso entero.');
    L.push('');
    L.push('## Dónde están los archivos');
    L.push('');
    L.push('```');
    L.push(entrega.lineaDeBase(carpeta));
    L.push('```');
    L.push('');
    const variable = `\`{${entrega.VARIABLE}}\``;
    L.push(`Todas las rutas de este documento empiezan con ${variable}: reemplazalo por esa ruta. Si en`);
    L.push(`tu máquina esa carpeta no existe, ${variable} es la carpeta donde está este archivo.`);
    L.push('');

    L.push('Los comentarios ya resueltos no están acá. Lo que figura es lo que falta.');
    L.push('');

    // Va arriba y no al final: es una instrucción para mientras se trabaja,
    // y al final de un documento de veinte clases se lee cuando ya se terminó.
    L.push('## Cuando termines cada ajuste, marcalo acá');
    L.push('');
    L.push('Cada comentario tiene su casilla, con un código entre corchetes:');
    L.push('');
    L.push('    - [ ] Hecho · [codigo-de-ejemplo]');
    L.push('');
    L.push('Cuando termines ese ajuste, cambiá `[ ]` por `[x]` en ESTE archivo y, si querés,');
    L.push('agregá al final de la línea qué hiciste:');
    L.push('');
    L.push('    - [x] Hecho · [codigo-de-ejemplo] — bajé el logo a la esquina inferior derecha');
    L.push('');
    L.push('Reviewer lee estas casillas y da el comentario por resuelto, así no vuelve a pedirse.');
    L.push('Marcá solo lo que de verdad quedó hecho: lo que quedó a medias o no se pudo hacer, dejalo');
    L.push('sin marcar y explicá por qué. No cambies el código entre corchetes ni el resto del renglón.');
    L.push('');

    if (general.texto && general.texto.trim()) {
        L.push('## Lo que vale para todas las clases del curso');
        L.push('');
        L.push('Es la base: marca, tipografía, tono, reglas que no cambian de una clase a la otra.');
        L.push('Donde un comentario de una clase diga algo distinto, **manda el comentario**; en');
        L.push('todo lo demás, sigue mandando esto. No es una invitación a promediar.');
        L.push('');
        L.push(general.texto.trim());
        L.push('');
    }

    // El índice existe porque esto puede tener veinte secciones. Sin él, saber
    // cuánto trabajo hay en cada clase obliga a recorrer el documento entero, y
    // es lo primero que se quiere saber para repartir el trabajo.
    L.push('## Las clases, en orden');
    L.push('');
    for (const p of partes) {
        const cuantos_ = p.abiertos.length;
        const vieja = p.vieja ? `, de la ${etiquetaDe(p.version)} —ya hay una ${p.vieja}—` : '';
        L.push(`- **${p.clase.nombre} · ${etiquetaDe(p.version)}** — ${cuantos_} ${cuantos_ === 1 ? 'ajuste' : 'ajustes'}${vieja}`);
    }
    L.push('');

    for (const p of partes) {
        L.push('---');
        L.push('');
        L.push(`## ${p.clase.nombre} · ${etiquetaDe(p.version)}`);
        L.push('');
        L.push(`- **Video:** ${rel(p.version.ruta)}`);
        L.push(`- **El render:** ${feedback.fichaDelVideo(p.datos)}`);
        if (p.vieja) {
            L.push('');
            L.push(`> Estos comentarios son de la **${etiquetaDe(p.version)}** y de esta clase ya hay una **${p.vieja}**.`);
            L.push('> Quedaron sin marcar como resueltos, así que puede que algunos ya estén hechos.');
            L.push(`> Mirá la ${p.vieja} antes de rehacer nada.`);
        }
        L.push('');

        if (encargo.vigente(p.datos, general.texto)) {
            L.push('### Qué hay que hacer');
            L.push('');
            L.push('El resumen ordenado de los comentarios de esta clase. Los comentarios de abajo');
            L.push('siguen siendo la fuente: si acá falta un detalle, está en el comentario que lo dice.');
            L.push('');
            L.push(p.datos.instruccion.texto.trim());
            L.push('');
            L.push('### Los comentarios');
            L.push('');
        }

        for (const comentario of p.abiertos) {
            const archivos = p.archivos.get(comentario.id) || [];
            L.push(feedback.cabeceraDe(comentario, p.datos.fps));
            L.push(`- [ ] Hecho · [${entrega.codigoDe(p.clase, p.version, comentario)}]`);
            L.push('');

            // Las menciones se resuelven contra las COPIAS: si apuntaran al
            // original, el documento mandaría a abrir un archivo de afuera de
            // la carpeta y la exportación dejaría de valerse por sí sola.
            const deLaVersion = workspace.carpetaDeVersion(p.version.ruta);
            const deEste = adjuntos.paraResolver(comentario, deLaVersion).map(item => {
                const copia = archivos.find(a => a.original === item.ruta);
                return copia ? { ...item, ruta: copia.ruta } : item;
            });
            const { texto } = menciones.resolver(comentario.texto, [...referencias, ...deEste]);
            L.push(texto.trim() || '_(sin texto)_');

            if (archivos.length) {
                L.push('');
                for (const a of archivos) {
                    L.push(`- ${a.titulo}: ${rel(a.ruta)}`);
                    if (a.frase) L.push(`  ${a.frase}`);
                }
            }
            L.push('');
        }
    }

    // La lista de todo junto, igual que en el feedback de una versión: es lo
    // que un agente necesita para abrir las imágenes de una antes de empezar.
    const todos = [];
    for (const p of partes) {
        for (const comentario of p.abiertos) {
            for (const a of (p.archivos.get(comentario.id) || [])) {
                todos.push({ etiqueta: `${p.clase.nombre} ${etiquetaDe(p.version)} · ${comentario.id} (${a.corto})`, ruta: a.ruta });
            }
        }
    }
    for (const ref of referencias) {
        todos.push({
            etiqueta: ref.tipo === 'imagen' ? `imagen ${ref.numero} («${ref.nombre}»)` : `documento «${ref.nombre}»`,
            ruta: ref.ruta
        });
    }

    if (todos.length) {
        L.push('---');
        L.push('');
        L.push('## Dónde está cada archivo');
        L.push('');
        L.push(`No van adjuntos a este texto: son ${todos.length} archivos que están en ${rel(path.join(carpeta, RECURSOS_DIR))}, al lado de`);
        L.push('este documento. Abrilos con tu herramienta de lectura');
        L.push('**antes** de tocar la edición: un comentario sobre un encuadre no se puede');
        L.push('contestar sin mirar el cuadro del que habla.');
        L.push('');
        for (const a of todos) L.push(`- ${a.etiqueta} → ${rel(a.ruta)}`);
        L.push('');

        if (partes.some(p => p.abiertos.some(c => (c.adjuntos || []).length))) {
            L.push('Entre los archivos que adjuntó el editor hay dos clases y no se pueden tratar igual.');
            L.push('Los que dicen **SOLO DE REFERENCIA** se miran para entender qué se pide, y nada más.');
            L.push('Los que dicen **PARA USAR TAL CUAL** son el material: ese archivo entra a la pieza, no');
            L.push('una versión parecida ni una recreación. Ante la duda, preguntá antes de usar uno.');
            L.push('');
        }
    }

    L.push('---');
    L.push('');
    L.push(`Lo exportó Reviewer el ${new Date().toISOString().slice(0, 10)}.`);
    L.push(soloClase
        ? 'Este documento se rehace entero cada vez que se exporta esta clase: lo que se escriba'
        : 'Este documento se rehace entero cada vez que se exporta el curso: lo que se escriba');
    L.push('acá a mano se pierde. Lo que vale es lo que el editor tiene en Reviewer.');
    L.push('');

    return L.join('\n');
}

module.exports = { DOCUMENTO, RECURSOS_DIR, encargosAlDia, exportar, recolectar };
