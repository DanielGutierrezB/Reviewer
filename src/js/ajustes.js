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
import * as claude from './claude.js';
import * as dictado from './dictado.js';
import * as micro from './micro.js';
import * as actualizar from './actualizar.js';

function configDeLaPantalla() {
    const proveedor = $('#llm-proveedor').value;
    return {
        proveedor,
        url: $('#llm-url').value.trim(),
        modelo: $('#llm-modelo').value || null,
        apiKey: $('#llm-apikey').value
    };
}

async function pintarProveedor() {
    const a = estado.ajustes;
    const proveedor = $('#llm-proveedor').value;
    const config = a.llm[proveedor] || {};
    $('#llm-url').value = config.url || '';
    $('#llm-apikey').value = config.apiKey || '';
    $('#fila-apikey').hidden = proveedor !== 'openai';
    // Con la cuenta de Claude no hay servidor al que apuntar ni lista que
    // buscar: la dirección y el botón «Buscar» no se esconden por prolijidad,
    // sino porque escribir algo ahí no haría nada y dejarlos invita a creer que
    // sí. Los modelos y el cartel de la sesión los pinta `claude.js`.
    $('#fila-claude').hidden = proveedor !== 'claude';
    $('#llm-url').closest('.fila').hidden = proveedor === 'claude';
    $('#llm-refrescar').hidden = proveedor === 'claude';
    if (proveedor === 'claude') {
        await claude.pintar(config.modelo);
        return;
    }

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
    // Solo lo que esta pantalla toca. Los transportes que no son el activo no
    // viajan y quedan como estaban: el merge contra el disco lo hace
    // `engine/ajustes.parchear`, así que «probar LM Studio y volver a Ollama no
    // te reescribe el modelo que tenías» ya no depende de que este objeto se
    // arme bien.
    estado.ajustes = await window.rv.ajustesParchear({
        llm: {
            proveedor,
            // El de Claude guarda SOLO el modelo. No es un ahorro: es que no
            // tiene nada más: sin dirección, sin clave y sin token, porque la
            // sesión la tiene el CLI y acá no se guarda ninguna credencial.
            [proveedor]: proveedor === 'claude' ? { modelo: config.modelo } : {
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
    // El de la barra tiene que seguir al de acá: son el mismo ajuste.
    micro.llenar($('#micro-elegido'));
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
 * El desplegable de micrófonos de Ajustes.
 *
 * La lista la trae `micro.js`, que es la misma que usa el de la barra de
 * arriba: dos listas armadas por separado se contradicen en cuanto alguien
 * enchufa algo con los Ajustes abiertos.
 */
async function pintarMicrofonos() {
    await micro.buscar();
    micro.llenar($('#dict-micro'));
    if (!micro.lista().some(d => d.label)) {
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
    await pintarProveedor();
    $('#dict-idioma').value = estado.ajustes.dictado.idioma;
    $('#dict-refinar').checked = estado.ajustes.dictado.refinar;
    $('#llm-aviso').textContent = '';
    $('#dict-aviso').textContent = '';
    await pintarMicrofonos();
    await pintarDoctor();
    await actualizar.pintarEnAjustes();
    $('#modal-ajustes').hidden = false;
}

export function cerrar() {
    $('#modal-ajustes').hidden = true;
}

export function wire() {
    // La cajita «hay la 0.2.0» de la barra abre este panel. El gancho se ata acá
    // y no en `app.js` porque `actualizar.js` no puede importar a este módulo
    // —este ya lo importa a él— y porque el único que necesita saber de los dos
    // es justamente el que los junta.
    actualizar.al.verAjustes = abrir;
    actualizar.wire();

    $('#btn-ajustes').addEventListener('click', abrir);
    $('#ajustes-cerrar').addEventListener('click', cerrar);
    $('#modal-ajustes').addEventListener('click', e => {
        if (e.target === $('#modal-ajustes')) cerrar();
    });

    $('#llm-proveedor').addEventListener('change', async () => {
        // Pintar antes de guardar, y el orden importa: `pintar` deja en el
        // desplegable el modelo que ese transporte tenía guardado, y `guardar`
        // escribe lo que haya en la pantalla. Al revés se guardaría el modelo
        // del transporte anterior, que para el nuevo no quiere decir nada.
        await pintarProveedor();
        await guardar();
    });
    claude.wire(() => pintarProveedor());
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
