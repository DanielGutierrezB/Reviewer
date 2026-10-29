'use strict';
/**
 * app.js — La ventana. No sabe leer discos ni medir video: le pide todo al
 * proceso principal por `window.rv` (preload) y se ocupa de dibujar.
 *
 * Acá está el cableado —qué botón llama a qué— y las dos cosas que no son de
 * nadie más: abrir una carpeta y la caja de comentar.
 */

import { $, anotar, avisar, enCampoDeTexto, escapar, nombreDe } from './chrome.js';
import { estado, claseActual, comentarios, fps, rutaActual } from './estado.js';
import * as fmt from './formato.js';
import * as reproductor from './reproductor.js';
import * as dibujo from './dibujo.js';
import * as panel from './comentarios.js';
import * as paneles from './paneles.js';
import * as redactor from './redactor.js';
import * as adjuntos from './adjuntos.js';
import * as menu from './menu-arroba.js';
import * as marcadores from './marcadores.js';
import * as historial from './historial.js';
import * as general from './general.js';
import * as dictado from './dictado.js';
import * as micro from './micro.js';
import * as pantalla from './pantalla.js';
import * as ajustes from './ajustes.js';
import { svg as marca } from './marca.js';

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
    estado.referencias = await window.rv.referenciasListar();

    $('#vista-inicio').hidden = true;
    $('#vista-revision').hidden = false;
    $('#btn-cambiar').hidden = false;
    const chip = $('#chip-carpeta');
    chip.hidden = false;
    chip.textContent = r.raiz;
    chip.title = r.raiz;

    pintarClases();
    general.pintar();
    await elegirClase(r.clases[0].id);
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
    $('#vista-revision').hidden = true;
    $('#vista-inicio').hidden = false;
    $('#btn-cambiar').hidden = true;
    $('#chip-carpeta').hidden = true;
    pintarRecientes();
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
        boton.className = `clase${clase.id === estado.claseId ? ' is-activa' : ''}`;
        boton.title = clase.nombre;
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
              title="${cuantos === 1 ? '1 comentario' : `${cuantos} comentarios`} en v${ultima.n}">${cuantos || ''}</span>`;
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
    const comentadas = clase.versiones.filter(v => v.tieneComentarios).map(v => `v${v.n}`);
    const detalle = `${cuantas} ${cuantas === 1 ? 'versión' : 'versiones'}`
        + (comentadas.length ? ` · con comentarios: ${comentadas.join(', ')}` : ' · sin comentarios');

    return `<span class="clase-v${ultima.tieneComentarios ? ' tiene' : ''}"
                  title="${escapar(detalle)}">v${ultima.n}</span>`;
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
            + (version.archivada ? ' es-archivada' : '');
        boton.textContent = `v${version.n}`;

        // Que esté archivada se dice, porque cambia dónde está el archivo: el
        // que abre una v1 y después la busca en el Finder tiene que saber que
        // no está al lado de las demás.
        const notas = [];
        if (version.archivada) notas.push('guardada en Pre versions');
        if (version.tieneComentarios) notas.push('tiene comentarios');
        boton.title = notas.length ? `${version.archivo} — ${notas.join(' · ')}` : version.archivo;
        boton.addEventListener('click', () => elegirVersion(version));
        caja.appendChild(boton);
    }
}

async function elegirClase(id) {
    const clase = estado.clases.find(c => c.id === id);
    if (!clase) return;
    estado.claseId = id;
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

    $('#visor-nombre').textContent = `${clase ? clase.nombre : ''} · v${version.n}`;
    $('#visor-ficha').textContent = fmt.ficha(version.media);
    pintarVersiones();

    estado.datos = await window.rv.comentariosLeer(version.ruta);
    panel.pintar();

    const abierto = await reproductor.abrir(version);
    if (abierto.ok) {
        // El canvas solo se prende con el video andando: encima de un negro no
        // hay nada que señalar.
        dibujo.activar(true);
        reproductor.pintarMarcas();
        pantalla.mostrar(abierto.url, version.media);
    }
    pintarHistorial();
    anotar('version.abre', { n: version.n, proxy: Boolean(abierto.proxy) });
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
        const imagenes = await window.rv.comentarioImagenes(ruta, r.nuevo, q.t, q.png);
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

// ─── Corregir la entrada y la salida de un marcador ───────────

/**
 * Las teclas I y O, y también soltar el borde de una marca arrastrado con Opt.
 *
 * Las tres cosas terminan acá porque son la misma: mover uno de los dos
 * tiempos de un marcador que ya existe. Lo que cambia entre ellas es nada más
 * de dónde sale el marcador —las teclas lo deducen de dónde está el cabezal,
 * el arrastre lo señala con el dedo— y eso se resuelve antes de llamar.
 *
 * El borrador va primero y no pasa por `marcadores.js`: un comentario que se
 * está escribiendo todavía no está en el disco, así que no aparece en la línea
 * ni en ninguna lista, pero es más nuevo que cualquiera de los que están y es
 * del que uno está hablando. Mover sus tiempos es gratis —no hay nada escrito
 * que corregir— y el cuadro se saca recién al guardar, así que sale solo.
 */
async function corregirBorrador(lado, t) {
    const { t: desde, tHasta } = redactor.cuando();

    if (lado === 'entrada') {
        if (tHasta != null && t >= tHasta) {
            panel.decirEstado('La entrada tiene que ir antes de la salida.', 'mal');
            return;
        }
        redactor.abrir({ t, tHasta });
        return;
    }

    if (t <= desde) {
        panel.decirEstado('La salida tiene que ir después del comentario.', 'mal');
        return;
    }
    redactor.abrir({ t: desde, tHasta: t });
}

/**
 * Mueve un borde y, si hace falta, vuelve a sacar el cuadro.
 *
 * **El cuadro guardado es el de la entrada**, así que moverla deja un PNG que
 * muestra otro momento del que el comentario dice. Se vuelve a sacar, salvo
 * cuando el editor dibujó encima: ahí el PNG no es una ilustración del
 * instante sino el dibujo, y cambiarlo por el cuadro nuevo tiraría el trazo.
 * Entre perder un dibujo y que el cuadro quede unos cuadros corrido, lo
 * segundo se arregla mirando y lo primero no se arregla.
 */
async function guardarBorde(c, lado, t) {
    const ruta = rutaActual();
    const campo = lado === 'entrada' ? 't' : 'tHasta';

    await panel.cambiar(
        `mover la ${lado} de ${c.id}`,
        window.rv.comentarioEditar(ruta, c.id, { [campo]: t })
    );
    panel.mirar(c.id, false);

    const conDibujo = Boolean(c.dibujo) || Boolean(c.trazos && c.trazos.length);
    if (lado === 'entrada' && c.frame && !conDibujo) {
        const r = await window.rv.comentarioImagenes(ruta, c.id, t, null);
        if (r.ok) panel.adoptar(r.estado);
    }

    panel.decirEstado(
        lado === 'entrada'
            ? `${c.id} empieza en ${fmt.timecode(t, fps())}${conDibujo ? ' (el cuadro dibujado se queda donde estaba)' : ''}.`
            : `${c.id} va hasta ${fmt.timecode(t, fps())}.`,
        'bien'
    );
}

/**
 * I y O desde el teclado: a quién le hablan lo decide dónde está el cabezal.
 *
 * Lo primero es anclar el tiempo al comienzo de su cuadro. Lo que llega es el
 * `currentTime` crudo del video, que viene con unos microsegundos de más; sin
 * anclarlo, el borde quedaría guardado en un número que no es el principio de
 * ningún cuadro y el PNG saldría de otro lado que el timecode.
 */
async function corregir(lado, crudo) {
    if (!estado.version) return;

    const f = fps();
    const t = fmt.segundosDe(fmt.cuadroDe(crudo, f), f);
    if (redactor.abierto()) return corregirBorrador(lado, t);

    const c = lado === 'entrada'
        ? marcadores.paraEntrada(comentarios(), t)
        : marcadores.paraSalida(comentarios(), t);

    if (!c) {
        panel.decirEstado(lado === 'entrada'
            ? 'No hay ningún marcador acá ni más adelante. Con M dejás uno donde estás.'
            : 'No hay ningún marcador sin cerrar antes de acá. Con M dejás uno donde estás.', 'mal');
        return;
    }

    // Ya estar donde se lo quiere poner no es un cambio. Se compara con medio
    // cuadro de margen y no con `===`: el tiempo guardado y el que devuelve el
    // video después de ir hasta él se parecen hasta el microsegundo pero no son
    // el mismo número, y sin el margen esto escribiría el disco y dejaría un
    // paso en el deshacer que no deshace nada.
    const yaEsta = lado === 'entrada' ? c.t : c.tHasta;
    if (yaEsta != null && Math.abs(t - yaEsta) < 1 / (2 * f)) {
        panel.decirEstado(`La ${lado} de ${c.id} ya está acá.`);
        return;
    }
    if (lado === 'entrada' && c.tHasta != null && t >= c.tHasta) {
        panel.decirEstado(`La entrada tiene que ir antes de la salida de ${c.id}.`, 'mal');
        return;
    }
    if (lado === 'salida' && t <= c.t) {
        panel.decirEstado(`La salida tiene que ir después de la entrada de ${c.id}.`, 'mal');
        return;
    }

    await guardarBorde(c, lado, t);
}

/** Soltar el borde de una marca arrastrado con Opt: el marcador ya está dicho. */
async function ajustarBorde(id, lado, t) {
    const c = comentarios().find(x => x.id === id);
    // El reproductor ya frenó el borde a un cuadro del otro mientras se
    // arrastraba, así que acá no hay nada que validar: lo que llega es válido o
    // el comentario dejó de existir.
    if (c) await guardarBorde(c, lado, t);
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
    reproductor.al.entrada = t => corregir('entrada', t);
    reproductor.al.salida = t => corregir('salida', t);
    reproductor.al.ajustar = ajustarBorde;
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
    estado.dictadoMotivo = d.puedeDictar ? null : (d.filas.find(f => !f.ok && !f.critico) || {}).nota;

    wire();
    dictado.pintarBotones();
    pintarHistorial();
    await micro.buscar();
    await pantalla.revisar();
    await pintarRecientes();

    if (!d.ok) {
        const falta = d.filas.filter(f => f.critico && !f.ok).map(f => f.nombre).join(' y ');
        avisar(`Falta ${falta}: sin eso no se puede abrir una carpeta. Mirá Ajustes.`, 'mal');
    }
    anotar('ventana.lista', { version: info.version, puedeDictar: d.puedeDictar });
}

arrancar();
