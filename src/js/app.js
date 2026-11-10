'use strict';
/**
 * app.js — La ventana. No sabe leer discos ni medir video: le pide todo al
 * proceso principal por `window.rv` (preload) y se ocupa de dibujar.
 *
 * Acá está el cableado —qué botón llama a qué— y las dos cosas que no son de
 * nadie más: abrir una carpeta y la caja de comentar.
 */

import { $, anotar, avisar, enCampoDeTexto, escapar, nombreDe } from './chrome.js';
import { estado, claseActual, fps, rutaActual } from './estado.js';
import * as fmt from './formato.js';
import * as reproductor from './reproductor.js';
import * as dibujo from './dibujo.js';
import * as panel from './comentarios.js';
import * as paneles from './paneles.js';
import * as redactor from './redactor.js';
import * as adjuntos from './adjuntos.js';
import * as menu from './menu-arroba.js';
import * as historial from './historial.js';
import * as general from './general.js';
import * as dictado from './dictado.js';
import * as micro from './micro.js';
import * as pantalla from './pantalla.js';
import * as ajustes from './ajustes.js';
import { svg as marca } from './marca.js';
import { recargar as iconoRecargar } from './iconos.js';
import * as render from './render.js';
import * as vistas from './vistas.js';
import * as bordes from './bordes.js';
import * as dependencias from './dependencias.js';
import * as frameio from './frameio.js';

// ─── La carpeta ───────────────────────────────────────────────

async function pintarRecientes() {
    const lista = $('#recientes-lista');
    const recientes = await window.rv.carpetasRecientes();
    lista.textContent = '';
    $('#recientes').hidden = recientes.length === 0;

    for (const { ruta, existe } of recientes) {
        const li = document.createElement('li');
        li.className = existe ? '' : 'is-ida';
        li.innerHTML = `
            <button type="button" class="reciente" title="${escapar(ruta)}">${escapar(nombreDe(ruta))}</button>
            <button type="button" class="icono icono-chico quitar" title="Sacarla de la lista">✕</button>`;
        li.querySelector('.reciente').addEventListener('click', () => {
            if (existe) abrirCarpeta(ruta);
            else avisar('Esa carpeta ya no está en el disco.', 'mal');
        });
        li.querySelector('.quitar').addEventListener('click', async () => {
            await window.rv.olvidarCarpeta(ruta);
            pintarRecientes();
        });
        lista.appendChild(li);
    }
}

async function abrirCarpeta(raiz) {
    const error = $('#inicio-error');
    error.hidden = true;

    const r = await window.rv.abrirCarpeta(raiz);
    if (!r.ok) {
        error.textContent = r.error;
        error.hidden = false;
        return;
    }
    if (!r.clases.length) {
        error.textContent = 'En esa carpeta no hay videos. Reviewer busca los renders sueltos, no adentro de subcarpetas.';
        error.hidden = false;
        return;
    }

    estado.raiz = r.raiz;
    estado.clases = r.clases;
    estado.general = r.general;
    estado.nuevas.clear();
    estado.referencias = await window.rv.referenciasListar();

    vistas.ver('revision');
    frameio.refrescar();
    $('#btn-cambiar').hidden = false;
    const chip = $('#chip-carpeta');
    chip.hidden = false;
    chip.textContent = r.raiz;
    chip.title = r.raiz;

    pintarClases();
    general.pintar();
    await elegirClase(r.clases[0].id);
}

/** Abre la última versión de una clase, la esté mirando ya o no. */
async function abrirUltimaDe(clase) {
    estado.claseId = clase.id;
    estado.nuevas.delete(clase.id);
    pintarClases();
    await elegirVersion(clase.versiones[clase.versiones.length - 1]);
}

/**
 * Vuelve a leer la carpeta, y si Claude entregó algo nuevo de lo que estás
 * mirando, te lleva ahí.
 *
 * Se recarga casi siempre por eso: llegó la v5 de la clase que estás
 * revisando. Así que si estabas en la última versión y ahora hay otra, se abre
 * la nueva; y si la que mirabas desapareció —Claude la archivó al entregar—,
 * también. Lo que NO se hace es moverte cuando estabas en una versión vieja a
 * propósito, o cuando estás escribiendo un comentario: ahí se avisa y nada más.
 *
 * Abre por `elegirVersion` y no por `elegirClase`, que ignora a propósito el
 * clic en la clase que ya está abierta: recargar pasaba por ahí, la clase era
 * la misma y la versión nueva no se abría nunca.
 */
async function recargar() {
    if (!estado.raiz) return;

    const boton = $('#btn-recargar');
    boton.classList.add('is-girando');

    try {
        const r = await window.rv.abrirCarpeta(estado.raiz);
        if (!r.ok) {
            avisar(r.error, 'mal');
            return;
        }
        if (!r.clases.length) {
            avisar('En esa carpeta ya no hay videos.', 'mal');
            volverAlInicio();
            return;
        }

        const ruta = rutaActual();
        const antes = claseActual();
        const estabaEnLaUltima = Boolean(antes && ruta && ultimaDe(antes) && ultimaDe(antes).ruta === ruta);
        estado.clases = r.clases;
        estado.general = r.general;
        general.pintar();

        // El botón vuelve a apagarse pero los renglones siguen verdes: lo que
        // el botón dice es «hay algo en el disco que no cargaste», y eso ya no
        // es cierto. Que la clase esté sin ver, sí.
        boton.classList.remove('hay-nuevo');
        boton.title = 'Volver a leer la carpeta';

        const sigue = ruta
            ? r.clases.find(c => c.versiones.some(v => v.ruta === ruta))
            : null;

        const nueva = sigue && ultimaDe(sigue).ruta !== ruta ? ultimaDe(sigue) : null;
        if (sigue && nueva && estabaEnLaUltima && !redactor.abierto()) {
            await abrirUltimaDe(sigue);
            avisar(`Llegó la ${nombreCorto(nueva)} de esta clase y es la que estás viendo.`, 'bien');
        } else if (sigue) {
            // El mismo archivo, pero el objeto es otro: trae la cuenta de
            // comentarios y la medida de ahora, y el panel lee de acá.
            estado.claseId = sigue.id;
            estado.version = sigue.versiones.find(v => v.ruta === ruta);
            pintarClases();
            pintarVersiones();
            if (nueva && estabaEnLaUltima) avisar(`Hay una ${nombreCorto(nueva)} de esta clase. Cuando termines el comentario, abrila arriba.`);
        } else {
            const vuelta = r.clases.find(c => c.id === estado.claseId) || r.clases[0];
            await abrirUltimaDe(vuelta);
        }
    } finally {
        boton.classList.remove('is-girando');
    }
}

/**
 * Llegó algo al disco mientras la ventana estaba abierta.
 *
 * Solo se marca y se avisa: recargar lo decide el editor. Las clases que el
 * vigía nombra pueden no estar todavía en la lista —una clase entera nueva—, y
 * eso no es un problema: el id se guarda igual y el renglón sale verde en
 * cuanto exista.
 */
function llegaronRenders({ clases, movidas, faltantes }) {
    if (!estado.raiz) return;

    for (const c of clases) estado.nuevas.add(c.id);

    const boton = $('#btn-recargar');
    const hayNuevo = clases.length > 0 || movidas > 0 || faltantes > 0;
    boton.classList.toggle('hay-nuevo', hayNuevo);

    const partes = [];
    if (clases.length) partes.push(clases.length === 1 ? '1 entrega nueva' : `${clases.length} entregas nuevas`);
    if (movidas) partes.push(movidas === 1 ? '1 versión archivada' : `${movidas} versiones archivadas`);
    if (faltantes) partes.push(faltantes === 1 ? '1 render que ya no está' : `${faltantes} renders que ya no están`);
    boton.title = partes.length
        ? `${partes.join(' · ')}. Tocá para recargar.`
        : 'Volver a leer la carpeta';

    pintarClases();
}

/**
 * Claude marcó en un documento exportado que hizo algunos ajustes, y esos
 * comentarios ya están resueltos en el disco.
 *
 * Si alguno es de la versión abierta, se repinta, y entra al historial como un
 * paso: deshacerlo es volver a abrirlos, que es lo que el editor querría si
 * mira el cambio y no quedó bien.
 */
async function hizoClaude({ cuantos, rutas }) {
    const version = estado.version;
    if (version && rutas.includes(version.ruta)) {
        const antes = estado.datos;
        const datos = await window.rv.comentariosLeer(version.ruta);
        if (estado.version !== version) return;
        estado.datos = datos;
        historial.registrar('lo que marcó Claude', antes, datos);
        panel.pintar();
        refrescarMarcas();
        pintarHistorial();
    }
    avisar(cuantos === 1 ? 'Claude marcó 1 comentario como hecho.' : `Claude marcó ${cuantos} comentarios como hechos.`, 'bien');
}

function volverAlInicio() {
    reproductor.cerrar();
    dibujo.activar(false);
    redactor.cerrar();
    pantalla.cerrar();
    historial.abrir(null);
    estado.raiz = null;
    estado.clases = [];
    estado.claseId = null;
    estado.version = null;
    estado.datos = null;
    estado.nuevas.clear();
    // Las pestañas se quedan: el render no depende de la carpeta abierta, y
    // volver al inicio no tiene por qué esconder lo que el Mac está haciendo.
    vistas.ver('revision');
    frameio.refrescar();
    $('#btn-cambiar').hidden = true;
    $('#chip-carpeta').hidden = true;
    pintarRecientes();
}

// ─── Lo que llega desde la pestaña de Render ───────────────────

/**
 * Desde la pestaña de Render: abrir esa entrega para revisarla.
 *
 * Casi siempre la clase todavía no está en la lista: se entregó hace unos
 * segundos y la carpeta se leyó hace una hora. Por eso se relee acá en vez de
 * pasar por `recargar`, que a propósito no te mueve de donde estás — y que
 * justamente por eso dejaba el botón abriendo la clase vieja.
 */
async function revisarEntrega(ruta) {
    const carpeta = ruta.slice(0, ruta.lastIndexOf('/'));
    const buscar = () => estado.clases.find(c => c.versiones.some(v => v.ruta === ruta));

    if (estado.raiz === carpeta) {
        vistas.ver('revision');
        if (!buscar()) {
            const r = await window.rv.abrirCarpeta(estado.raiz);
            if (r.ok && r.clases.length) {
                estado.clases = r.clases;
                estado.general = r.general;
                general.pintar();
            }
        }
    } else {
        // Sin carpeta abierta —la app se abrió solo para renderizar— o con
        // otra: se abre la de la entrega, que es lo que pidió el clic.
        await abrirCarpeta(carpeta);
    }
    const clase = buscar();
    if (!clase) {
        avisar('Esa entrega ya no está en la carpeta.', 'mal');
        return;
    }

    estado.claseId = clase.id;
    estado.nuevas.delete(clase.id);
    pintarClases();
    await elegirVersion(clase.versiones.find(v => v.ruta === ruta));
}

// ─── Clases y versiones ───────────────────────────────────────

/** La versión que se abre al tocar la clase: la última. */
function ultimaDe(clase) {
    return clase.versiones[clase.versiones.length - 1] || null;
}

function pintarClases() {
    const lista = $('#clases-lista');
    lista.textContent = '';
    $('#clases-cuenta').textContent = `${estado.clases.length}`;

    for (const clase of estado.clases) {
        const li = document.createElement('li');
        const boton = document.createElement('button');
        boton.type = 'button';
        boton.className = 'clase'
            + (clase.id === estado.claseId ? ' is-activa' : '')
            + (estado.nuevas.has(clase.id) ? ' es-nueva' : '');
        boton.title = estado.nuevas.has(clase.id)
            ? `${clase.nombre} — entrega nueva sin ver`
            : clase.nombre;
        boton.innerHTML = `
            <span class="clase-nombre">${escapar(clase.nombre)}</span>
            ${extrasDeClase(clase)}
            <span class="clase-vs">${cajitaDeVersion(clase)}</span>`;
        boton.addEventListener('click', () => elegirClase(clase.id));
        li.appendChild(boton);
        lista.appendChild(li);
    }

    pintarTotal();
}

/**
 * Lo que aparece en el renglón cuando la columna se ensancha: cuánto dura y
 * cuántos comentarios tiene.
 *
 * **Se dibuja siempre y lo esconde el CSS**, no al revés. Quién lo ve lo decide
 * una `@container` sobre el ancho de la columna (ver `style.css`), así que
 * arrastrar el borde no tiene que repintar veintitrés renglones por cuadro de
 * arrastre, y nadie tiene que acordarse de volver a pintar la lista cuando la
 * columna cambia de ancho.
 *
 * Los dos números son de la ÚLTIMA versión, que es la que se abre al tocar la
 * clase y de la que habla la cajita de al lado. Contar las anteriores haría que
 * el renglón dijera «8 comentarios» de una clase cuya entrega nueva no miró
 * nadie, que es justo lo contrario de lo que se viene a buscar en esta lista.
 */
function extrasDeClase(clase) {
    const ultima = ultimaDe(clase);
    if (!ultima) return '';

    const dura = (ultima.media && ultima.media.duracion) || 0;
    const cuantos = ultima.comentarios || 0;

    return `
        <span class="clase-dura">${dura ? fmt.reloj(dura) : '—'}</span>
        <span class="clase-cuantos${cuantos ? ' tiene' : ''}"
              title="${cuantos === 1 ? '1 comentario' : `${cuantos} comentarios`} en la ${ultima.etiqueta}">${cuantos || ''}</span>`;
}

/**
 * El pie de la columna: cuántas clases son y cuánto duran en total.
 *
 * Suma la última versión de cada clase y no todas las versiones: lo que se
 * quiere saber es cuánto dura el curso, y una clase con tres versiones no dura
 * el triple. Un render que no se pudo medir no suma y se dice aparte, porque un
 * total que se come una clase en silencio es peor que uno que avisa.
 *
 * La cuenta de clases está también arriba, al lado del título, y acá se repite
 * a propósito: los dos números dicen una sola cosa —«esto es el curso
 * entero»— y leerla parte arriba y parte abajo obliga a cruzar la columna con
 * la vista. Salen del mismo `estado.clases`, así que no pueden discrepar.
 */
function pintarTotal() {
    const pie = $('#clases-total');
    if (!estado.clases.length) {
        pie.hidden = true;
        return;
    }

    const ultimas = estado.clases.map(ultimaDe).filter(Boolean);
    const medidas = ultimas.filter(v => v.media && v.media.duracion > 0);
    const total = medidas.reduce((suma, v) => suma + v.media.duracion, 0);
    const sinMedir = ultimas.length - medidas.length;

    const cuantas = estado.clases.length === 1 ? '1 clase' : `${estado.clases.length} clases`;

    pie.hidden = false;
    pie.innerHTML = `
        <span class="clases-total-que">${cuantas}</span>
        <span class="clases-total-cuanto">${fmt.horasYMinutos(total)}</span>`;
    pie.title = sinMedir
        ? `Suma de la última versión de cada clase. ${sinMedir} no se pudieron medir y no están contadas.`
        : 'Suma de la última versión de cada clase.';
}

/**
 * La cajita `v3` de una clase en la barra lateral: una sola, la última.
 *
 * El número ya cuenta a las anteriores. Un `v3` dice que hubo una v1 y una v2
 * sin gastar dos cajitas más en decirlo, y lo que se viene a leer en ese
 * renglón es el nombre de la clase, que es lo que las cajitas empujaban hasta
 * dejarlo cortado. El detalle completo —cuántas hay, cuáles tienen
 * comentarios— está en el `title`, y los botones de arriba del visor siguen
 * mostrando todas las versiones de la clase abierta.
 *
 * **El ámbar es «la última ya la comenté», no «alguna tiene comentarios».** Es
 * la diferencia que hace que la señal sirva: el ciclo normal es comentar la v1
 * y que Claude devuelva la v2, así que marcar «alguna» pintaría de ámbar al
 * curso entero a los dos días. Lo que se mira de un vistazo es qué entregas
 * nuevas siguen sin revisar, y eso son las que NO están en ámbar.
 */
function cajitaDeVersion(clase) {
    const ultima = clase.versiones[clase.versiones.length - 1];
    if (!ultima) return '';

    const cuantas = clase.versiones.length;
    const comentadas = clase.versiones.filter(v => v.tieneComentarios).map(v => v.etiqueta);
    const detalle = `${cuantas} ${cuantas === 1 ? 'versión' : 'versiones'}`
        + (comentadas.length ? ` · con comentarios: ${comentadas.join(', ')}` : ' · sin comentarios');

    return `<span class="clase-v${ultima.tieneComentarios ? ' tiene' : ''}"
                  title="${escapar(detalle)}">${escapar(nombreCorto(ultima))}</span>`;
}

/**
 * Cómo se llama una versión donde hay poco lugar: los botones del visor, la
 * cajita de la barra lateral y el título.
 *
 * Una edición no lleva número propio: es una propuesta de cambio SOBRE la v3,
 * no una v4. Escribirle «v4» prometería un render que no existe, y escribirle
 * «v3» la haría indistinguible del render que está al lado. Donde sí hay lugar
 * —un tooltip, el export— va `version.etiqueta`, que dice de cuál.
 */
function nombreCorto(version) {
    return version.edicion ? 'edición' : version.etiqueta;
}

function pintarVersiones() {
    const caja = $('#versiones');
    caja.textContent = '';
    const clase = claseActual();
    if (!clase) return;

    for (const version of clase.versiones) {
        const boton = document.createElement('button');
        boton.type = 'button';
        boton.className = 'version'
            + (estado.version && version.ruta === estado.version.ruta ? ' is-activa' : '')
            + (version.tieneComentarios ? ' tiene' : '')
            + (version.archivada ? ' es-archivada' : '')
            + (version.edicion ? ' es-edicion' : '');
        boton.textContent = nombreCorto(version);

        // Que esté archivada se dice, porque cambia dónde está el archivo: el
        // que abre una v1 y después la busca en el Finder tiene que saber que
        // no está al lado de las demás.
        const notas = [];
        if (version.edicion) notas.push(`montaje sin renderizar, sobre la v${version.n}`);
        if (version.archivada) notas.push('guardada en Pre versions');
        if (version.tieneComentarios) notas.push('tiene comentarios');

        // Si está en Frame.io, un punto lo dice y el título lleva el enlace. No
        // es un adorno: sin él no hay forma de saber si lo que el equipo está
        // mirando allá es esta versión o la anterior.
        const enFrameio = frameio.deVersion(version);
        if (enFrameio && enFrameio.fileId) {
            boton.classList.add('en-frameio');
            notas.push(enFrameio.vista ? 'en Frame.io — clic con ⌥ para abrirlo allá' : 'en Frame.io');
            if (enFrameio.vista) {
                // Se manda el nombre del render, no la url: quién sabe a dónde
                // lleva cada archivo es el proceso principal, y una url que
                // viaja desde la ventana para que el sistema la abra es una url
                // que podría ser cualquiera.
                boton.addEventListener('click', e => {
                    if (!e.altKey) return;
                    e.stopImmediatePropagation();
                    window.rv.frameioAbrir(version.archivo);
                }, true);
            }
        } else if (enFrameio && enFrameio.estado === 'error') {
            boton.classList.add('frameio-mal');
            notas.push(`no se pudo subir a Frame.io: ${enFrameio.error || 'sin motivo'}`);
        }

        boton.title = notas.length ? `${version.archivo} — ${notas.join(' · ')}` : version.archivo;
        boton.addEventListener('click', () => elegirVersion(version));
        caja.appendChild(boton);
    }
}

async function elegirClase(id) {
    const clase = estado.clases.find(c => c.id === id);
    if (!clase) return;
    // Tocar la clase que ya está abierta no abre nada: sería volver al
    // principio del render que estás mirando. Con una edición además cuesta
    // caro —ocho videos que se cierran y se vuelven a abrir— y pasa de verdad,
    // porque entrar a una carpeta ya abre la primera clase sola y el primer
    // impulso es hacerle clic encima.
    if (estado.claseId === id && estado.version) return;
    estado.claseId = id;
    // Abrirla ES verla: el verde se apaga acá y no con un reloj. Lo que queda
    // verde después de recargar es la cola de lo que falta mirar, y un
    // temporizador la borraría justo cuando se está trabajando en ella.
    estado.nuevas.delete(id);
    pintarClases();
    // La última es la que se abre: revisar es mirar lo último que entregó
    // Claude, y empezar por la v1 obligaría a un clic en cada clase para llegar
    // a donde uno quería estar.
    await elegirVersion(clase.versiones[clase.versiones.length - 1]);
}

async function elegirVersion(version) {
    if (!version) return;
    const clase = claseActual();
    estado.version = version;
    estado.mirado = null;
    dibujo.activar(false);
    await redactor.cerrar();
    // El historial es de una versión sola: un ⌘Z que cruzara de render
    // resucitaría un comentario adentro de otro archivo.
    historial.abrir(version.ruta);

    $('#visor-nombre').textContent = `${clase ? clase.nombre : ''} · ${nombreCorto(version)}`;
    $('#visor-ficha').textContent = fmt.ficha(version.media);
    pintarVersiones();

    const datos = await window.rv.comentariosLeer(version.ruta);
    if (estado.version !== version) return;
    estado.datos = datos;
    panel.pintar();

    const abierto = await reproductor.abrir(version);
    if (abierto.tarde) return;
    if (abierto.ok) {
        // El canvas solo se prende con el video andando: encima de un negro no
        // hay nada que señalar.
        dibujo.activar(true);
        reproductor.pintarMarcas();
        // Con una edición no hay url: la segunda pantalla reproduce un archivo
        // por su cuenta, y una edición se compone en este proceso, cuadro a
        // cuadro. Se le dice igual, para que no se quede mostrando el render
        // de antes moviéndolo con los tiempos de la edición.
        pantalla.mostrar(abierto.url || null, version.media);
        const faltan = abierto.faltan || [];
        if (faltan.length) {
            avisar(`La edición abrió sin ${faltan.length} archivo${faltan.length > 1 ? 's' : ''}: ${faltan.slice(0, 2).join(', ')}`, 'mal');
        }
    }
    pintarHistorial();
    anotar('version.abre', { n: version.n, edicion: Boolean(version.edicion), proxy: Boolean(abierto.proxy) });
}

/** Relee del disco qué versiones tienen comentarios, para los puntos de la lista. */
async function refrescarMarcas() {
    const clase = claseActual();
    if (!clase || !estado.datos) return;
    const version = clase.versiones.find(v => v.ruta === rutaActual());
    if (version) {
        version.tieneComentarios = estado.datos.existeFeedback;
        // La cuenta vino del escaneo y envejece en cuanto se guarda o se borra
        // un comentario. Se actualiza acá, con lo que el motor acaba de
        // devolver, para que el número del renglón no diga uno menos que las
        // tarjetas que están al lado en la pantalla.
        version.comentarios = (estado.datos.comentarios || []).length;
    }
    pintarVersiones();
    pintarClases();
}

// ─── Guardar un comentario nuevo ──────────────────────────────

async function guardarComentario() {
    const q = await redactor.recoger();
    if (!q) return;

    const ruta = rutaActual();
    const antes = estado.datos;
    await redactor.cerrar();

    const r = await window.rv.comentarioAgregar(ruta, {
        t: q.t,
        tHasta: q.tHasta,
        texto: q.texto,
        trazos: q.trazos
    });
    estado.datos = r;
    estado.mirado = r.nuevo;
    panel.pintar();
    refrescarMarcas();
    reproductor.limpiarRango();
    dibujo.limpiar();

    // El cuadro tarda medio segundo con ffmpeg y copiar los adjuntos otro
    // tanto: la tarjeta ya está en pantalla y lo demás aparece cuando está. El
    // historial se anota DESPUÉS de las dos cosas y no antes, para que la foto
    // de «después» sea el comentario entero: deshacer y rehacer tienen que
    // devolver la tarjeta con su cuadro Y con sus archivos, no una versión de
    // ella a la que le falta la mitad de lo que decía.
    //
    // Lo que falló se junta y se dice al final, en una sola frase. Con un
    // cartel por cada cosa, el segundo pisa al primero y el editor se entera
    // nada más que de la última.
    let ultimo = r;
    const problemas = [];

    if (q.conCuadro) {
        const imagenes = await window.rv.comentarioImagenes(ruta, r.nuevo, q.t, q.png, await reproductor.cuadroCompuesto(q.t));
        if (imagenes.ok) ultimo = imagenes.estado;
        else problemas.push(`el cuadro no se guardó (${imagenes.error})`);
        estado.datos = ultimo;
        panel.pintar();
        refrescarMarcas();
    }

    if (q.adjuntos.length) {
        const colgados = await window.rv.comentarioAdjuntar(ruta, r.nuevo, q.adjuntos);
        ultimo = colgados.estado;
        for (const f of colgados.fallados) problemas.push(`«${f.nombre}» no entró (${f.motivo})`);
        estado.datos = ultimo;
        panel.pintar();
        refrescarMarcas();
    }

    historial.registrar(`comentar en ${fmt.timecode(q.t, fps())}`, antes, ultimo);
    if (problemas.length) {
        panel.decirEstado(`El comentario se guardó, pero ${problemas.join(' y ')}.`, 'mal');
    }
}

// ─── Deshacer y rehacer ───────────────────────────────────────

/**
 * `Cmd+Z` tiene dos dueños y el de arriba es el dibujo.
 *
 * Mientras hay trazos en la pizarra sin guardar, deshacer saca el último trazo.
 * Es lo que uno acaba de hacer, y lo que uno acaba de hacer es siempre lo que
 * espera desandar primero. Recién cuando la pizarra está limpia, ⌘Z empieza a
 * desandar comentarios guardados.
 */
async function deshacer() {
    if (dibujo.hayQueDeshacer()) {
        dibujo.deshacer();
        return;
    }
    const paso = await historial.deshacer();
    if (!paso) return;
    panel.adoptar(paso.datos);
    refrescarMarcas();
    panel.decirEstado(`Deshecho: ${paso.nombre}.`);
}

async function rehacer() {
    if (dibujo.hayQueRehacer()) {
        dibujo.rehacer();
        return;
    }
    const paso = await historial.rehacer();
    if (!paso) return;
    panel.adoptar(paso.datos);
    refrescarMarcas();
    panel.decirEstado(`Rehecho: ${paso.nombre}.`);
}

function pintarHistorial() {
    const que = historial.queSigue();
    const atras = $('#btn-deshacer-todo');
    const adelante = $('#btn-rehacer-todo');
    atras.disabled = !que.atras && !dibujo.hayQueDeshacer();
    adelante.disabled = !que.adelante && !dibujo.hayQueRehacer();
    atras.title = dibujo.hayQueDeshacer()
        ? 'Deshacer el último trazo (⌘Z)'
        : (que.atras ? `Deshacer: ${que.atras} (⌘Z)` : 'Nada que deshacer');
    adelante.title = dibujo.hayQueRehacer()
        ? 'Rehacer el trazo (⇧⌘Z)'
        : (que.adelante ? `Rehacer: ${que.adelante} (⇧⌘Z)` : 'Nada que rehacer');
}

// ─── Arranque ─────────────────────────────────────────────────

function wire() {
    $('#btn-elegir').addEventListener('click', async () => {
        const ruta = await window.rv.elegirCarpeta();
        if (ruta) abrirCarpeta(ruta);
    });
    $('#btn-cambiar').addEventListener('click', volverAlInicio);
    $('#chip-carpeta').addEventListener('click', () => window.rv.abrirEnFinder(estado.raiz));
    $('#btn-recargar').querySelector('.recargar-icono').innerHTML = iconoRecargar;
    $('#btn-recargar').addEventListener('click', recargar);

    render.al.revisar = revisarEntrega;
    render.montar();
    vistas.wire();
    // La lista de clases y los botones de versión muestran qué está en
    // Frame.io, así que se repintan cuando eso cambia.
    frameio.al.clases = () => { pintarClases(); pintarVersiones(); };
    frameio.al.render = () => { if (vistas.enRender()) render.pintar(); };
    frameio.wire();
    window.rv.alLlegarRenders(llegaronRenders);
    window.rv.alHacerClaude(hizoClaude);

    // Soltar una carpeta en la pantalla de arranque.
    const zona = $('#zona-soltar');
    for (const evento of ['dragenter', 'dragover']) {
        zona.addEventListener(evento, e => {
            e.preventDefault();
            zona.classList.add('is-encima');
        });
    }
    for (const evento of ['dragleave', 'drop']) {
        zona.addEventListener(evento, () => zona.classList.remove('is-encima'));
    }
    zona.addEventListener('drop', e => {
        e.preventDefault();
        const archivo = e.dataTransfer.files[0];
        if (!archivo) return;
        const ruta = window.rv.rutaDe(archivo);
        if (ruta) abrirCarpeta(ruta);
        else avisar('No se pudo leer la ruta de eso.', 'mal');
    });

    reproductor.wire();
    dibujo.wire();
    panel.wire();
    redactor.wire();
    general.wire();
    dictado.wire();
    micro.wire();

    // Soltar archivos en cualquier parte del bloque de este video, no solo
    // sobre el redactor o sobre una tarjeta.
    //
    // Si el redactor está abierto van al comentario que se está escribiendo; si
    // no, se abre uno en el cabezal y van ahí. Es la misma decisión que ya toma
    // el primer trazo del dibujo: soltar un archivo en el panel de comentarios
    // es querer comentar algo con ese archivo, y la alternativa —no hacer nada
    // y que el archivo rebote— deja al editor probando dónde había que soltar.
    //
    // Las zonas de la tarjeta y del redactor cortan la propagación, así que
    // esta solo se entera de lo que cayó en el aire que queda entre ellas.
    //
    // **DEUDA, verificada el 29/10: soltar sobre el VIDEO no hace nada.**
    // `.bloque-video` es, a pesar del nombre, la sección de comentarios y vive
    // adentro de `#panel`; el video y la línea de tiempo están en la columna
    // del medio, afuera de esta zona. Con ⌘E el panel se pliega entero y
    // entonces lo único que recibe archivos es el `#redactor`, porque su
    // propia zona viaja con el nodo cuando `paneles.js` lo muda a
    // `#redactor-compacto` —y solo si está abierto—.
    //
    // No se arregló acá porque cambia dónde se puede soltar y eso se mira, no
    // se deduce. El movimiento, cuando se decida: mover este atrapatodo a
    // `#vista-revision`, que cubre las tres columnas, y dejar que las zonas de
    // la tarjeta y del redactor sigan quedándose con lo suyo.
    adjuntos.zonaDeSoltar($('.bloque-video'), entradas => {
        if (!estado.version) return;
        if (!redactor.abierto()) redactor.abrir();
        redactor.recibir(entradas);
    });
    pantalla.wire();
    ajustes.wire();

    // El gancho va antes del `wire` porque ese `wire` ya pone los paneles como
    // quedaron la sesión pasada, y para eso tiene que poder preguntar si hay un
    // comentario a medio escribir —no lo hay al arrancar, pero depender de eso
    // sería dejar el orden como una trampa—. Quién lleva la cuenta de eso es
    // `redactor.js` y nadie más.
    paneles.al.redactorAbierto = redactor.abierto;
    paneles.wire();

    reproductor.al.comentar = () => redactor.abrir();
    reproductor.al.mirar = id => panel.mirar(id, true);
    reproductor.al.entrada = t => bordes.corregir('entrada', t);
    reproductor.al.salida = t => bordes.corregir('salida', t);
    reproductor.al.ajustar = bordes.ajustarBorde;
    reproductor.al.cambiarTiempo = t => pantalla.seguir(t);
    // La segunda pantalla se entera de la velocidad en el acto y no en el
    // próximo `timeupdate`: un cuarto de segundo al ritmo viejo alcanza para
    // que se vaya y tenga que reenganchar, que se ve como un salto.
    reproductor.al.cambiarVelocidad = () => pantalla.seguir(reproductor.tiempo());
    panel.al.cambio = refrescarMarcas;

    // El menú del `@` es uno solo para toda la ventana, así que acá se le dice
    // de dónde sacar los candidatos según en qué campo esté parado el cursor:
    // en el redactor, la tira del borrador —que todavía vive en memoria—; en
    // una tarjeta, la tira de ESE comentario. La lista es por comentario
    // porque el ámbito `@[adjunto/…]` también lo es: ofrecer los archivos de
    // otra tarjeta sería ofrecer una referencia que no va a resolver.
    menu.al.items = campo => (campo.tagName === 'TEXTAREA'
        ? redactor.candidatosDelBorrador()
        : panel.candidatosDe(campo));
    menu.al.elegir = (campo, item, donde) => (campo.tagName === 'TEXTAREA'
        ? redactor.elegirDelMenu(item, donde)
        : panel.elegirDelMenu(campo, item, donde));
    menu.wire();

    general.al.cambio = () => general.pintar();
    historial.al.cambio = pintarHistorial;
    redactor.al.guardar = guardarComentario;

    // Dibujar es, casi siempre, querer comentar eso: al primer trazo se abre el
    // redactor solo. El editor que solo quería señalar algo lo cierra con Esc.
    dibujo.al.primerTrazo = () => {
        if (!redactor.abierto()) redactor.abrir();
    };
    // Cada trazo cambia lo que dice la casilla del dibujo y qué puede deshacer
    // ⌘Z, así que las dos cosas se repintan juntas.
    dibujo.al.cambio = () => {
        redactor.pintarAdjuntos();
        pintarHistorial();
        pantalla.mandarTrazos();
    };
    // Elegir herramienta o color no cambia ningún trazo, pero sí cambia con qué
    // va a salir el próximo del Pencil: la paleta del iPad tiene que enterarse,
    // o muestra una forma y dibuja otra.
    dibujo.al.eleccion = () => pantalla.mandarTrazos();

    $('#btn-deshacer-todo').addEventListener('click', deshacer);
    $('#btn-rehacer-todo').addEventListener('click', rehacer);

    window.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
            if (redactor.abierto()) return redactor.cerrar();
            if (!$('#modal-ajustes').hidden) return ajustes.cerrar();
            if (estado.mirado) {
                estado.mirado = null;
                reproductor.mostrarDibujo(null);
                panel.resaltar();
            }
            return;
        }

        // Deshacer y rehacer andan en TODA la ventana, también con el cursor
        // adentro de un campo de texto. Adentro de un campo, ⌘Z es el de ese
        // campo —lo maneja el navegador— y acá no se toca; en cualquier otro
        // lado es el de la app.
        if ((e.metaKey || e.ctrlKey) && (e.key === 'z' || e.key === 'Z') && !enCampoDeTexto(e)) {
            e.preventDefault();
            if (e.shiftKey) rehacer(); else deshacer();
            return;
        }

        if (!$('#modal-ajustes').hidden) return;

        // Con la pestaña de Render abierta no corre ningún atajo del
        // reproductor. No es que estorben: es que SÍ funcionarían. M dejaría un
        // marcador y abriría el redactor sobre un video que no está en
        // pantalla, y el espacio pondría a sonar la clase desde atrás de esta
        // vista. Los de la app —Escape, ⌘Z, ⌘S— siguen, y por eso esto va acá
        // abajo y no arriba de todo.
        if (vistas.enRender()) return;

        // ⌘S y ⌘E pliegan las columnas de los costados. Van ANTES del
        // reproductor porque ese se va sin hacer nada en cuanto ve un ⌘, y
        // DESPUÉS del `return` de Ajustes: con el panel de ajustes abierto no
        // corre ningún atajo de la app, igual que con las teclas de una letra.
        //
        // A diferencia del ⌘Z de más arriba, estos dos sí corren con el cursor
        // adentro de un campo de texto; el porqué está en `paneles.teclas`.
        if (paneles.teclas(e)) {
            e.preventDefault();
            return;
        }
        if (reproductor.teclas(e)) e.preventDefault();
    });

    window.rv.alAvanzarProxy(({ ruta, pct, motivo }) => {
        if (!estado.version || estado.version.ruta !== ruta) return;
        $('#escenario-aviso-texto').textContent = `${motivo}. Preparando una copia que sí se pueda… ${Math.round(pct * 100)} %`;
        $('#escenario-barra').style.width = `${pct * 100}%`;
    });
}

async function arrancar() {
    $('#marca').innerHTML = marca(15);

    const info = await window.rv.appInfo();
    $('#version').textContent = `v${info.version}`;
    estado.ajustes = await window.rv.ajustesLeer();
    // Antes de cablear nada: los dos rótulos de «para qué sirve un adjunto» los
    // escribe el motor, y el primer selector que se pinte ya los necesita.
    await adjuntos.cargarUsos();

    const d = await window.rv.doctor();
    estado.puedeDictar = d.puedeDictar;
    estado.dictadoMotivo = d.puedeDictar ? null : (d.filas.find(f => !f.esta && !f.requerida) || {}).para;

    wire();
    dictado.pintarBotones();
    pintarHistorial();
    await micro.buscar();
    await pantalla.revisar();
    await pintarRecientes();

    // Si falta algo, se dice ahora y con botón para instalarlo, antes de que
    // nadie intente abrir una carpeta y se encuentre con que no se puede.
    await dependencias.avisoAlAbrir();
    anotar('ventana.lista', { version: info.version, puedeDictar: d.puedeDictar, alcanza: d.ok });
}

arrancar();
