'use strict';
/**
 * app.js — La ventana. No sabe leer discos ni medir video: le pide todo al
 * proceso principal por `window.rv` (preload) y se ocupa de dibujar.
 *
 * Acá está el cableado —qué botón llama a qué— y las dos cosas que no son de
 * nadie más: abrir una carpeta y la caja de comentar.
 */

import { $, anotar, avisar, escapar, nombreDe } from './chrome.js';
import { estado, claseActual, fps, rutaActual } from './estado.js';
import * as fmt from './formato.js';
import * as reproductor from './reproductor.js';
import * as dibujo from './dibujo.js';
import * as panel from './comentarios.js';
import * as general from './general.js';
import * as dictado from './dictado.js';
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
        const conComentarios = clase.versiones.filter(v => v.tieneComentarios).length;
        const li = document.createElement('li');
        const boton = document.createElement('button');
        boton.type = 'button';
        boton.className = `clase${clase.id === estado.claseId ? ' is-activa' : ''}`;
        boton.innerHTML = `
            <span class="clase-nombre">${escapar(clase.nombre)}</span>
            <span class="clase-pie">
                <span>${clase.versiones.length} ${clase.versiones.length === 1 ? 'versión' : 'versiones'}</span>
                ${conComentarios ? '<span class="clase-punto">● comentada</span>' : ''}
            </span>`;
        boton.addEventListener('click', () => elegirClase(clase.id));
        li.appendChild(boton);
        lista.appendChild(li);
    }
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
    }
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

// ─── La caja de comentar ──────────────────────────────────────

const modal = {
    t: 0,
    tHasta: null,
    conDibujo: false
};

function abrirModal() {
    if (!estado.version) return;
    reproductor.pausar();

    const rango = reproductor.rangoHecho();
    modal.t = rango ? estado.rango.desde : reproductor.tiempo();
    modal.tHasta = rango ? estado.rango.hasta : null;
    modal.conDibujo = dibujo.hayTrazos();

    $('#modal-cuando').textContent = rango
        ? `Un tramo: ${fmt.timecode(modal.t, fps())} → ${fmt.timecode(modal.tHasta, fps())}`
        : `En ${fmt.timecode(modal.t, fps())}`;
    $('#modal-con-dibujo').checked = modal.conDibujo;
    $('#modal-con-dibujo').disabled = !modal.conDibujo;
    $('#modal-nota').textContent = modal.conDibujo
        ? 'Se guarda el cuadro y el cuadro con tu dibujo encima.'
        : 'Se guarda el cuadro de este momento.';
    $('#modal-texto').value = '';
    dictado.decir('modal', '');
    $('[data-volver="modal"]').hidden = true;
    $('#modal-comentario').hidden = false;
    $('#modal-texto').focus();
}

async function cerrarModal() {
    if (dictado.oyendo()) await dictado.parar();
    $('#modal-comentario').hidden = true;
}

async function guardarComentario() {
    const texto = $('#modal-texto').value.trim();
    if (!texto) {
        dictado.decir('modal', 'Escribí o dictá qué cambiar.', 'mal');
        $('#modal-texto').focus();
        return;
    }

    const guardarDibujo = modal.conDibujo && $('#modal-con-dibujo').checked;
    const trazos = guardarDibujo ? dibujo.trazos() : null;
    // El PNG se compone ANTES de cerrar la caja: el cuadro sale del `<video>`,
    // y si el editor mueve el cabezal mientras se guarda, el dibujo quedaría
    // sobre otro cuadro.
    const png = guardarDibujo
        ? await dibujo.componer(estado.version.media.ancho, estado.version.media.alto)
        : null;

    await cerrarModal();

    const r = await window.rv.comentarioAgregar(rutaActual(), {
        t: modal.t,
        tHasta: modal.tHasta,
        texto,
        trazos
    });
    estado.datos = r;
    estado.mirado = r.nuevo;
    panel.pintar();
    refrescarMarcas();
    reproductor.limpiarRango();
    dibujo.limpiar();

    // El cuadro tarda medio segundo con ffmpeg: la tarjeta ya está en pantalla y
    // la miniatura aparece cuando está.
    const imagenes = await window.rv.comentarioImagenes(rutaActual(), r.nuevo, modal.t, png);
    if (imagenes.ok) {
        estado.datos = imagenes.estado;
        panel.pintar();
        refrescarMarcas();
    } else {
        panel.decirEstado(`El comentario se guardó, pero el cuadro no: ${imagenes.error}`, 'mal');
    }
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
    general.wire();
    dictado.wire();
    ajustes.wire();

    reproductor.al.comentar = abrirModal;
    reproductor.al.mirar = id => panel.mirar(id, true);
    panel.al.cambio = refrescarMarcas;
    general.al.cambio = () => general.pintar();
    // Dibujar es, casi siempre, querer comentar eso: al primer trazo se abre la
    // caja sola. El editor que solo quería señalar algo la cierra con Esc.
    dibujo.al.primerTrazo = () => {
        if ($('#modal-comentario').hidden) abrirModal();
    };

    $('#modal-cerrar').addEventListener('click', cerrarModal);
    $('#modal-cancelar').addEventListener('click', cerrarModal);
    $('#modal-guardar').addEventListener('click', guardarComentario);
    // Clic en el fondo para cerrar, pero solo si el clic EMPEZÓ en el fondo.
    //
    // Mirar nada más el `click` cerraba la caja en los dos momentos en que más
    // molesta. El primero es el que la abre: al soltar el trazo, el navegador
    // manda un `click` detrás del `pointerup`, y como la caja ya está arriba ese
    // clic cae en su fondo — dibujar abría la caja y la cerraba en el mismo
    // gesto. El segundo es seleccionar texto adentro del campo y soltar el botón
    // un poco afuera, que se llevaba el comentario a medio escribir.
    let empezoEnElFondo = false;
    $('#modal-comentario').addEventListener('pointerdown', e => {
        empezoEnElFondo = e.target === $('#modal-comentario');
    });
    $('#modal-comentario').addEventListener('click', e => {
        if (empezoEnElFondo && e.target === $('#modal-comentario')) cerrarModal();
        empezoEnElFondo = false;
    });
    // Cmd+Enter guarda desde adentro del campo: Enter solo es un renglón nuevo,
    // que en un comentario de tres líneas hace falta.
    $('#modal-texto').addEventListener('keydown', e => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            guardarComentario();
        }
    });

    window.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
            if (!$('#modal-comentario').hidden) return cerrarModal();
            if (!$('#modal-ajustes').hidden) return ajustes.cerrar();
            if (estado.mirado) {
                estado.mirado = null;
                reproductor.mostrarDibujo(null);
                panel.pintar();
            }
            return;
        }
        if (!$('#modal-comentario').hidden || !$('#modal-ajustes').hidden) return;
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

    const d = await window.rv.doctor();
    estado.puedeDictar = d.puedeDictar;
    estado.dictadoMotivo = d.puedeDictar ? null : (d.filas.find(f => !f.ok && !f.critico) || {}).nota;

    wire();
    dictado.pintarBotones();
    await pintarRecientes();

    if (!d.ok) {
        const falta = d.filas.filter(f => f.critico && !f.ok).map(f => f.nombre).join(' y ');
        avisar(`Falta ${falta}: sin eso no se puede abrir una carpeta. Mirá Ajustes.`, 'mal');
    }
    anotar('ventana.lista', { version: info.version, puedeDictar: d.puedeDictar });
}

arrancar();
