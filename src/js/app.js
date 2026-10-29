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
            <span class="clase-vs">${cajitasDeVersion(clase)}</span>`;
        boton.addEventListener('click', () => elegirClase(clase.id));
        li.appendChild(boton);
        lista.appendChild(li);
    }
}

/**
 * Las cajitas `v1 v2` de una clase en la barra lateral.
 *
 * Solo las tres últimas. Una clase con nueve versiones llenaría el renglón de
 * cajitas y empujaría el nombre —que es lo que se viene a leer— hasta no
 * entrar; las viejas se resumen en un `+6`. La que tiene comentarios va en
 * ámbar, que es la misma señal que usa el resto de la app para «acá hay
 * trabajo hecho».
 */
function cajitasDeVersion(clase) {
    const ULTIMAS = 3;
    const sobran = Math.max(0, clase.versiones.length - ULTIMAS);
    const cajas = clase.versiones.slice(-ULTIMAS).map(v =>
        `<span class="clase-v${v.tieneComentarios ? ' tiene' : ''}">v${v.n}</span>`);
    return (sobran ? `<span class="clase-v-mas">+${sobran}</span>` : '') + cajas.join('');
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
            + (version.tieneComentarios ? ' tiene' : '');
        boton.textContent = `v${version.n}`;
        boton.title = version.tieneComentarios
            ? `${version.archivo} — tiene comentarios`
            : version.archivo;
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
    if (version) version.tieneComentarios = estado.datos.existeFeedback;
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

/**
 * La tecla O: le pone la salida al último comentario que quedó atrás.
 *
 * «El último de atrás» se busca entre los que todavía son un instante, porque
 * uno que ya es un tramo ya fue cerrado y volver a cerrarlo sería pisar algo
 * hecho a propósito. Si el redactor está abierto sobre un comentario que aún no
 * se guardó, se cierra ese: es más nuevo que cualquiera del disco.
 */
async function extenderUltimo(t) {
    if (!estado.version) return;

    if (redactor.abierto()) {
        const { t: desde } = redactor.cuando();
        if (t <= desde) {
            panel.decirEstado('La salida tiene que ir después del comentario.', 'mal');
            return;
        }
        redactor.abrir({ t: desde, tHasta: t });
        return;
    }

    const candidato = comentarios()
        .filter(c => c.tHasta == null && c.t < t)
        .sort((a, b) => a.t - b.t)
        .pop();

    if (!candidato) {
        panel.decirEstado('No hay ningún comentario de un instante antes de acá.', 'mal');
        return;
    }

    await panel.cambiar(
        `cerrar ${candidato.id}`,
        window.rv.comentarioEditar(rutaActual(), candidato.id, { tHasta: t })
    );
    panel.mirar(candidato.id, false);
    panel.decirEstado(`${candidato.id} va hasta ${fmt.timecode(t, fps())}.`, 'bien');
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
    reproductor.al.extender = extenderUltimo;
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
