'use strict';
/**
 * ajustes.js — La pantalla de Ajustes: el modelo local, el dictado y qué tiene
 * esta Mac.
 *
 * Lo que se elige acá no es una preferencia estética: sin un modelo elegido, los
 * dos botones de mejorar redacción y el de preparar para Claude no hacen nada, y
 * el dictado no se refina. Por eso el botón «Probar» pregunta de verdad en vez
 * de mirar solo la lista: un modelo que figura instalado y no entra en memoria
 * falla recién al usarlo, que es a mitad de un refinado.
 */

import { $, avisar } from './chrome.js';
import { estado } from './estado.js';
import * as fmt from './formato.js';
import * as dictado from './dictado.js';

function configDeLaPantalla() {
    const proveedor = $('#llm-proveedor').value;
    return {
        proveedor,
        url: $('#llm-url').value.trim(),
        modelo: $('#llm-modelo').value || null,
        apiKey: $('#llm-apikey').value
    };
}

function pintarProveedor() {
    const a = estado.ajustes;
    const proveedor = $('#llm-proveedor').value;
    const config = a.llm[proveedor] || {};
    $('#llm-url').value = config.url || '';
    $('#llm-apikey').value = config.apiKey || '';
    $('#fila-apikey').hidden = proveedor !== 'openai';

    const select = $('#llm-modelo');
    select.textContent = '';
    const vacio = document.createElement('option');
    vacio.value = '';
    vacio.textContent = '—';
    select.appendChild(vacio);
    if (config.modelo) {
        const opcion = document.createElement('option');
        opcion.value = config.modelo;
        opcion.textContent = config.modelo;
        opcion.selected = true;
        select.appendChild(opcion);
    }
}

async function guardar() {
    const proveedor = $('#llm-proveedor').value;
    const config = configDeLaPantalla();
    estado.ajustes = await window.rv.ajustesGuardar({
        ...estado.ajustes,
        llm: {
            ...estado.ajustes.llm,
            proveedor,
            [proveedor]: {
                url: config.url,
                modelo: config.modelo,
                ...(proveedor === 'openai' ? { apiKey: config.apiKey } : {})
            }
        },
        dictado: {
            microfono: $('#dict-micro').value,
            idioma: $('#dict-idioma').value,
            refinar: $('#dict-refinar').checked
        }
    });
}

async function buscarModelos() {
    const aviso = $('#llm-aviso');
    aviso.textContent = 'Buscando…';
    aviso.className = 'campo-aviso';
    const r = await window.rv.llmModelos(configDeLaPantalla());
    if (!r.ok) {
        aviso.textContent = `No se pudo hablar con ese servidor: ${r.error}`;
        aviso.className = 'campo-aviso is-mal';
        return;
    }

    const select = $('#llm-modelo');
    const elegido = select.value;
    select.textContent = '';
    const vacio = document.createElement('option');
    vacio.value = '';
    vacio.textContent = '—';
    select.appendChild(vacio);
    for (const nombre of r.modelos) {
        const opcion = document.createElement('option');
        opcion.value = nombre;
        opcion.textContent = nombre;
        if (nombre === elegido) opcion.selected = true;
        select.appendChild(opcion);
    }
    aviso.textContent = r.modelos.length
        ? `${r.modelos.length} modelo(s). Elegí uno chico: reescribir no es diseñar.`
        : 'Ese servidor no tiene modelos instalados.';
    aviso.className = `campo-aviso${r.modelos.length ? '' : ' is-mal'}`;
}

/**
 * Los micrófonos del sistema.
 *
 * Con una interfaz de audio, unos auriculares y una webcam enchufados, "el
 * micrófono" no dice nada: el desplegable es la única forma de saber cuál se
 * está usando. Los nombres solo aparecen una vez que se dio permiso al
 * micrófono, así que antes de eso la lista queda en "el del sistema" y se dice.
 */
async function pintarMicrofonos() {
    const select = $('#dict-micro');
    const elegido = (estado.ajustes && estado.ajustes.dictado.microfono) || '';
    let entradas = [];
    try {
        entradas = (await navigator.mediaDevices.enumerateDevices())
            .filter(d => d.kind === 'audioinput');
    } catch (e) { /* sin permiso todavía */ }

    select.textContent = '';
    const porDefecto = document.createElement('option');
    porDefecto.value = '';
    porDefecto.textContent = 'El del sistema';
    select.appendChild(porDefecto);
    for (const d of entradas) {
        if (!d.deviceId || d.deviceId === 'default') continue;
        const opcion = document.createElement('option');
        opcion.value = d.deviceId;
        opcion.textContent = d.label || 'Micrófono sin nombre';
        if (d.deviceId === elegido) opcion.selected = true;
        select.appendChild(opcion);
    }
    if (!entradas.some(d => d.label)) {
        $('#dict-aviso').textContent = 'Los nombres de los micrófonos aparecen después de dictar una vez (ahí el sistema pide permiso).';
    }
}

async function pintarDoctor() {
    const d = await window.rv.doctor();
    const lista = $('#doctor');
    lista.textContent = '';
    for (const fila of d.filas) {
        const li = document.createElement('li');
        const clase = fila.ok ? 'is-ok' : (fila.critico ? 'is-no' : 'is-opcional');
        li.innerHTML = `
            <span class="marca ${clase}">${fila.ok ? '✓' : (fila.critico ? '✕' : '!')}</span>
            <span class="doctor-que">${fila.nombre}</span>
            <span class="doctor-donde">${fila.ok ? fila.ruta : fila.nota}</span>`;
        lista.appendChild(li);
    }

    estado.puedeDictar = d.puedeDictar;
    estado.dictadoMotivo = d.puedeDictar
        ? null
        : (d.filas.find(f => !f.ok && !f.critico) || {}).nota;
    dictado.pintarBotones();

    $('#cache-aviso').textContent = d.cache.archivos
        ? `${d.cache.archivos} video(s) preparado(s), ${fmt.pesa(d.cache.bytes)}. Se rehacen solos.`
        : 'Todavía no hubo que preparar ningún video.';
}

export async function abrir() {
    estado.ajustes = await window.rv.ajustesLeer();
    $('#llm-proveedor').value = estado.ajustes.llm.proveedor;
    pintarProveedor();
    $('#dict-idioma').value = estado.ajustes.dictado.idioma;
    $('#dict-refinar').checked = estado.ajustes.dictado.refinar;
    $('#llm-aviso').textContent = '';
    $('#dict-aviso').textContent = '';
    await pintarMicrofonos();
    await pintarDoctor();
    $('#modal-ajustes').hidden = false;
}

export function cerrar() {
    $('#modal-ajustes').hidden = true;
}

export function wire() {
    $('#btn-ajustes').addEventListener('click', abrir);
    $('#ajustes-cerrar').addEventListener('click', cerrar);
    $('#modal-ajustes').addEventListener('click', e => {
        if (e.target === $('#modal-ajustes')) cerrar();
    });

    $('#llm-proveedor').addEventListener('change', async () => {
        pintarProveedor();
        await guardar();
    });
    for (const sel of ['#llm-url', '#llm-apikey']) {
        $(sel).addEventListener('change', guardar);
    }
    $('#llm-modelo').addEventListener('change', guardar);
    $('#llm-refrescar').addEventListener('click', buscarModelos);

    $('#llm-probar').addEventListener('click', async () => {
        const aviso = $('#llm-aviso');
        aviso.textContent = 'Probando…';
        aviso.className = 'campo-aviso';
        await guardar();
        const r = await window.rv.llmProbar(configDeLaPantalla());
        aviso.textContent = r.ok
            ? `Anda: contestó en ${(r.ms / 1000).toFixed(1)} s.`
            : r.error;
        aviso.className = `campo-aviso${r.ok ? ' is-bien' : ' is-mal'}`;
    });

    for (const sel of ['#dict-micro', '#dict-idioma', '#dict-refinar']) {
        $(sel).addEventListener('change', guardar);
    }

    $('#btn-cache-vaciar').addEventListener('click', async () => {
        const r = await window.rv.cacheVaciar();
        $('#cache-aviso').textContent = r.ok ? 'Vaciado.' : r.error;
        if (r.ok) avisar('Listo. Los videos se vuelven a preparar cuando haga falta.');
    });
}
