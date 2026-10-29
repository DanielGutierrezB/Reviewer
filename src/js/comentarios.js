'use strict';
/**
 * comentarios.js — El panel de la derecha: las tarjetas de lo que se comentó.
 *
 * La tarjeta es el comentario, no un formulario para editarlo: el texto se
 * edita en el mismo lugar donde se lee (`contenteditable`) y se guarda al salir
 * del campo. Un botón «Editar» que abre un modal obliga a dos clics y a una
 * decisión —"¿guardo o cancelo?"— por cada corrección de una coma.
 *
 * **El timecode es un botón** y lleva el cabezal ahí. Es el movimiento que más
 * se repite al revisar: leer un comentario viejo y querer ver de qué hablaba.
 */

import { $, avisar, escapar } from './chrome.js';
import { estado, comentarios, comentarioPorId, fps, rutaActual } from './estado.js';
import * as fmt from './formato.js';
import * as reproductor from './reproductor.js';

/** Quien escucha. Lo pone `app.js`. */
export const al = { cambio: () => {} };

/**
 * El texto con las menciones resaltadas.
 *
 * Se escapa primero y se resalta después: al revés, un comentario que dijera
 * `<script>` se insertaría como etiqueta.
 */
function conMenciones(texto) {
    return escapar(texto).replace(/@\[([^[\]\n]{1,200})\]/g, (todo, dentro) => {
        const nombre = dentro.includes('/') ? dentro.slice(dentro.indexOf('/') + 1) : dentro;
        return `<span class="mencion" title="${escapar(dentro)}">@${escapar(nombre)}</span>`;
    });
}

function cuandoDe(c) {
    return c.tHasta
        ? `${fmt.timecode(c.t, fps())} → ${fmt.timecode(c.tHasta, fps())}`
        : fmt.timecode(c.t, fps());
}

function tarjeta(c) {
    const li = document.createElement('li');
    li.className = `comentario es-${c.estado}${estado.mirado === c.id ? ' is-mirado' : ''}`;
    li.dataset.id = c.id;

    const cabecera = document.createElement('div');
    cabecera.className = 'comentario-cabecera';
    cabecera.innerHTML = `
        <span class="comentario-id">${escapar(c.id)}</span>
        <button type="button" class="comentario-cuando" title="Ir a este momento">${escapar(cuandoDe(c))}</button>
        <span class="comentario-acciones">
            <button type="button" class="icono icono-chico" data-accion="estado"
                    title="${c.estado === 'abierto' ? 'Marcar como resuelto' : 'Volver a abrirlo'}">${c.estado === 'abierto' ? '✓' : '↺'}</button>
            <button type="button" class="icono icono-chico" data-accion="mejorar" title="Mejorar la redacción">✦</button>
            <button type="button" class="icono icono-chico" data-accion="borrar" title="Borrar">✕</button>
        </span>`;
    li.appendChild(cabecera);

    const texto = document.createElement('div');
    texto.className = 'comentario-texto';
    texto.contentEditable = 'plaintext-only';
    texto.spellcheck = true;
    texto.dataset.accion = 'texto';
    texto.innerHTML = conMenciones(c.texto);
    li.appendChild(texto);

    if (c.frameUrl || c.dibujoUrl || c.textoCrudo) {
        const tira = document.createElement('div');
        tira.className = 'comentario-tira';
        if (c.dibujoUrl) {
            tira.innerHTML += `<img class="comentario-mini" src="${c.dibujoUrl}" data-accion="ver-dibujo" alt="Lo que se dibujó" title="Verlo sobre el video">`;
        } else if (c.frameUrl) {
            tira.innerHTML += `<img class="comentario-mini" src="${c.frameUrl}" data-accion="ir" alt="El cuadro" title="Ir a este momento">`;
        }
        if (c.textoCrudo) {
            tira.innerHTML += '<button type="button" class="btn btn-ghost btn-chico" data-accion="crudo">Texto original</button>';
        }
        li.appendChild(tira);
    }

    return li;
}

/** Repinta las tarjetas, el badge y las marcas de la línea de tiempo. */
export function pintar() {
    const lista = $('#comentarios');
    const vacio = $('#comentarios-vacio');
    lista.textContent = '';

    const cs = comentarios();
    for (const c of cs) lista.appendChild(tarjeta(c));
    vacio.hidden = cs.length > 0;

    const cuenta = (estado.datos && estado.datos.cuenta) || { abiertos: 0, resueltos: 0, total: 0 };
    const badge = $('#video-badge');
    badge.textContent = cuenta.total
        ? `${cuenta.abiertos} por hacer${cuenta.resueltos ? ` · ${cuenta.resueltos} ✓` : ''}`
        : 'sin comentarios';
    badge.className = `badge${cuenta.abiertos ? ' is-pendiente' : (cuenta.total ? ' is-lleno' : '')}`;

    const alcance = $('#video-alcance');
    if (estado.version) {
        const clase = estado.clases.find(c => c.id === estado.claseId);
        alcance.textContent = `Solo para «${clase ? clase.nombre : ''} v${estado.version.n}». Se guardan al lado del render.`;
    }

    // El resumen para Claude.
    const inst = estado.datos && estado.datos.instruccion;
    $('#instruccion').hidden = !inst;
    if (inst) {
        $('#instruccion-texto').textContent = inst.texto;
        $('#instruccion-pie').textContent = inst.modelo ? `Lo escribió ${inst.modelo}` : '';
    }

    $('#btn-mejorar-todos').disabled = !cs.some(c => c.estado === 'abierto');
    $('#btn-preparar').disabled = !cs.some(c => c.estado === 'abierto');
    $('#btn-copiar-ruta').disabled = !(estado.datos && estado.datos.existeFeedback);

    reproductor.pintarMarcas();
}

/** Resalta un comentario y, si tiene dibujo, lo muestra sobre el video. */
export function mirar(id, irAlTiempo) {
    const c = comentarioPorId(id);
    estado.mirado = c ? id : null;
    reproductor.mostrarDibujo(c && c.dibujoUrl ? c.dibujoUrl : null);
    if (c && irAlTiempo) {
        reproductor.pausar();
        reproductor.irA(c.t);
    }
    pintar();
    if (!c) return;
    const nodo = $(`.comentario[data-id="${id}"]`);
    if (nodo) nodo.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function decirEstado(texto, tono) {
    const p = $('#panel-estado');
    p.textContent = texto || '';
    p.className = `panel-estado${tono ? ` is-${tono}` : ''}`;
}

async function aplicar(promesa) {
    const datos = await promesa;
    estado.datos = datos;
    pintar();
    al.cambio();
    return datos;
}

/** Mejora la redacción de un comentario con el modelo local. */
async function mejorar(id) {
    const c = comentarioPorId(id);
    if (!c || !c.texto.trim()) return;
    decirEstado('Mejorando la redacción…');
    const r = await window.rv.refinar({ texto: c.texto, origen: 'escrito' });
    if (!r.ok) {
        // Lo que se escribió a mano no se pisa con nada: queda como está y se
        // dice por qué. Es la diferencia con el dictado, donde el crudo es lo
        // que acababa de entrar y pisarlo no pierde trabajo.
        decirEstado(`${c.id}: ${r.motivo}`, 'mal');
        return;
    }
    await aplicar(window.rv.comentarioEditar(rutaActual(), id, { texto: r.texto, textoCrudo: c.texto }));
    decirEstado(`${c.id} reescrito por ${r.modelo}`, 'bien');
}

export function wire() {
    const lista = $('#comentarios');

    lista.addEventListener('click', async evento => {
        const tarjetaNodo = evento.target.closest('.comentario');
        if (!tarjetaNodo) return;
        const id = tarjetaNodo.dataset.id;
        const accion = evento.target.dataset.accion
            || (evento.target.closest('.comentario-cuando') ? 'ir' : null);

        switch (accion) {
            case 'ir':
                mirar(id, true);
                return;
            case 'ver-dibujo':
                mirar(id, true);
                return;
            case 'estado': {
                const c = comentarioPorId(id);
                await aplicar(window.rv.comentarioEditar(rutaActual(), id, {
                    estado: c.estado === 'abierto' ? 'resuelto' : 'abierto'
                }));
                return;
            }
            case 'mejorar':
                await mejorar(id);
                return;
            case 'crudo': {
                const c = comentarioPorId(id);
                await aplicar(window.rv.comentarioEditar(rutaActual(), id, {
                    texto: c.textoCrudo, textoCrudo: null
                }));
                return;
            }
            case 'borrar': {
                const c = comentarioPorId(id);
                const seguro = await window.rv.confirmar({
                    titulo: `¿Borrar ${c.id}?`,
                    detalle: 'Se borra también el cuadro y el dibujo que tenga guardados.'
                });
                if (!seguro) return;
                if (estado.mirado === id) {
                    estado.mirado = null;
                    reproductor.mostrarDibujo(null);
                }
                await aplicar(window.rv.comentarioBorrar(rutaActual(), id));
                return;
            }
            default:
                mirar(id, false);
        }
    });

    // El texto se guarda al salir del campo y no en cada tecla: cada guardado
    // reescribe el `feedback.md` entero, y hacerlo por letra sería escribir el
    // archivo cuarenta veces por frase.
    lista.addEventListener('focusout', async evento => {
        const campo = evento.target.closest('[data-accion="texto"]');
        if (!campo) return;
        const id = campo.closest('.comentario').dataset.id;
        const c = comentarioPorId(id);
        const nuevo = campo.innerText.trim();
        if (!c || nuevo === c.texto.trim()) return;
        if (!nuevo) {
            // Vaciar un comentario no lo borra: borrar es el botón de borrar, y
            // un `Cmd+A` + Supr accidental no puede llevarse el cuadro.
            campo.innerHTML = conMenciones(c.texto);
            decirEstado('Un comentario no puede quedar vacío: usá ✕ para borrarlo.', 'mal');
            return;
        }
        await aplicar(window.rv.comentarioEditar(rutaActual(), id, { texto: nuevo }));
    });

    $('#btn-mejorar-todos').addEventListener('click', async () => {
        const pendientes = comentarios().filter(c => c.estado === 'abierto' && c.texto.trim());
        let hechos = 0;
        const fallados = [];
        for (const c of pendientes) {
            decirEstado(`Mejorando ${c.id}… (${hechos + 1} de ${pendientes.length})`);
            const r = await window.rv.refinar({ texto: c.texto, origen: 'escrito' });
            if (r.ok) {
                await aplicar(window.rv.comentarioEditar(rutaActual(), c.id, { texto: r.texto, textoCrudo: c.texto }));
                hechos++;
            } else {
                fallados.push(`${c.id} (${r.motivo})`);
            }
        }
        decirEstado(
            fallados.length
                ? `${hechos} reescritos. Quedaron como estaban: ${fallados.join(', ')}`
                : `${hechos} comentarios reescritos.`,
            fallados.length ? 'mal' : 'bien'
        );
    });

    $('#btn-preparar').addEventListener('click', async () => {
        decirEstado('Juntando todos los comentarios en un encargo…');
        const r = await window.rv.instruccionPreparar(rutaActual());
        if (!r.ok) {
            decirEstado(r.motivo, 'mal');
            return;
        }
        estado.datos = r.estado;
        pintar();
        al.cambio();
        decirEstado(
            r.sinCitar && r.sinCitar.length
                ? `Listo, pero no nombró ${r.sinCitar.join(', ')}: revisalo antes de mandarlo.`
                : `Listo. Lo escribió ${r.modelo}.`,
            r.sinCitar && r.sinCitar.length ? 'mal' : 'bien'
        );
    });

    $('#btn-instruccion-borrar').addEventListener('click', async () => {
        await aplicar(window.rv.instruccionBorrar(rutaActual()));
        decirEstado('');
    });

    $('#btn-abrir-carpeta').addEventListener('click', () => {
        const carpeta = estado.datos && estado.datos.carpeta;
        // Si no hay comentarios la carpeta no existe —y eso es a propósito—, así
        // que se abre la del render, que es donde está el video.
        window.rv.abrirEnFinder(estado.datos && estado.datos.existeFeedback ? carpeta : rutaActual());
    });

    $('#btn-copiar-ruta').addEventListener('click', async () => {
        if (!estado.datos || !estado.datos.existeFeedback) return;
        await window.rv.copiar(estado.datos.rutaFeedback);
        avisar('Ruta copiada. Pegásela a Claude.', 'bien');
    });
}

export { decirEstado };
