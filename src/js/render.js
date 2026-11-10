'use strict';
/**
 * render.js — La pestaña de Render: qué está exportando el Mac y en qué va.
 *
 * Lo que se viene a buscar acá son dos preguntas: «¿en qué va?» y «¿falló
 * algo?». Todo lo demás —el log, las tareas sueltas, lo ya entregado— está
 * abajo y no estorba.
 *
 * Esta vista no sabe nada del taller: recibe el estado armado desde el proceso
 * principal, que lo lee con `engine/taller.js`. Ni siquiera decide qué es
 * urgente; eso viene resuelto en `resumen`, para que la regla viva en un solo
 * archivo con tests y no duplicada acá, que es donde se despegaría.
 */

import { $, anotar, avisar, escapar } from './chrome.js';
import * as dependencias from './dependencias.js';
import * as frameio from './frameio.js';

/** Lo último que mandó el proceso principal. */
let estado = null;

/** Las entregas que ya se le mostraron al editor, por ruta. */
const vistas = new Set();

/**
 * Qué clases dejó abiertas o cerradas el editor, por encima de lo que la vista
 * haría sola.
 *
 * Hace falta porque la vista se rehace entera cada dos segundos: sin esto,
 * cerrar una clase que está trabajando la vuelve a abrir en el siguiente
 * repintado, y el triangulito parece no funcionar.
 */
const desplegados = new Map();

/** Lo que la ventana le pide a este módulo. Lo pone `app.js`. */
export const al = {
    /** Abrir una versión entregada en la pestaña de revisión. */
    revisar: () => {},
    /** Repintar la insignia de la pestaña. */
    cambio: () => {}
};

/** Si la vista está a la vista: con ella escondida no se repinta de gusto. */
const mirando = () => !$('#vista-render').hidden;

/**
 * Un botón de la vista.
 *
 * Lleva `id` cuando es único —encender, pausar— y `dato` cuando hay uno por
 * tarjeta: el clic se atiende arriba de todo, sobre el contenedor, porque las
 * tarjetas se rehacen enteras cada dos segundos y un listener colgado de cada
 * botón se iría con el repintado.
 */
function boton(texto, { id = '', dato = null, tono = 'ghost', titulo = '' } = {}) {
    const atributos = [
        id ? ` id="${id}"` : '',
        dato ? ` data-${dato[0]}="${escapar(dato[1])}"` : '',
        titulo ? ` title="${escapar(titulo)}"` : ''
    ].join('');
    return `<button type="button" class="btn btn-${tono} btn-chico"${atributos}>${escapar(texto)}</button>`;
}

/**
 * La cabecera: quién está empujando la cola y con qué se lo prende o apaga.
 *
 * El caso que más confunde es el del worker ajeno —el de una Terminal abierta
 * de antes—, así que se dice con todas las letras en vez de mostrar «activo»:
 * con un worker ajeno vivo, el botón de encender no va a servir, y saber por
 * qué es la diferencia entre cerrar esa Terminal y pelearse con la app.
 */
function pintarWorker() {
    const caja = $('#render-worker');
    if (!estado) {
        // Sin taller no hay nada que mostrar, pero sí algo que hacer: elegir
        // el curso. Es la primera pantalla del que abre la app solo para
        // renderizar, así que el botón va acá y no escondido en Ajustes.
        caja.innerHTML = `
            <span class="render-punto"></span>
            <div class="render-worker-texto">
                <h3>Ningún curso para renderizar</h3>
                <p>Elegí la carpeta de un curso con <code>_claude_edit</code> adentro, o abrí su carpeta de renders en Revisión.</p>
            </div>
            <div class="render-acciones">
                ${boton('Elegir el curso…', { id: 'render-elegir', tono: 'primario' })}
            </div>`;
        return;
    }

    const r = estado.resumen || {};
    const tono = { trabajando: 'es-trabajando', espera: 'es-espera', mal: 'es-mal' };
    let titulo;
    let nota;
    let acciones;

    // El curso va delante de todo: desde que el render no depende de la
    // carpeta abierta, lo primero que hay que poder leer es qué se está
    // renderizando.
    const curso = estado.curso ? `${estado.curso} · ` : '';
    if (estado.ajeno) {
        titulo = 'Está renderizando una Terminal';
        nota = `${curso}Hay otro worker vivo en esta carpeta. Cerralo con Ctrl+C si querés que Reviewer se encargue.`;
        acciones = boton('Tomarlo igual', {
            id: 'render-forzar',
            titulo: 'Solo si estás seguro de que esa Terminal ya no está trabajando'
        });
    } else if (estado.encendido) {
        titulo = r.texto || 'Esperando trabajo';
        nota = estado.despierto
            ? `${curso}El Mac no se va a dormir mientras haya trabajo · ${estado.aLaVez} renders a la vez`
            : `${curso}Listo para cuando Claude deje algo · ${estado.aLaVez} renders a la vez`;
        acciones = boton('Pausar', { id: 'render-parar' });
    } else {
        titulo = 'Render en pausa';
        nota = `${curso}Claude deja el trabajo en la carpeta; Reviewer lo procesa con el Mac.`;
        acciones = boton('Encender', { id: 'render-arrancar', tono: 'primario' });
    }

    caja.innerHTML = `
        <span class="render-punto ${estado.encendido ? (tono[r.tono] || '') : ''}"></span>
        <div class="render-worker-texto">
            <h3>${escapar(titulo)}</h3>
            <p>${escapar(nota)}</p>
        </div>
        <div class="render-acciones">
            ${acciones}
            ${boton('Abrir carpeta', { id: 'render-finder' })}
            ${boton('Otro curso…', { id: 'render-elegir', titulo: 'Renderizar otro curso en vez de este' })}
        </div>`;
}

/**
 * La barra de progreso.
 *
 * El porcentaje sale medido del disco —tomas que existen, tramos de OCR
 * anotados, bytes escritos— y no de un reloj, así que cuando se queda quieta
 * es porque el trabajo está quieto. Por eso mismo hay etapas donde no se mueve
 * hasta el final: el control de calidad lee el archivo entero sin escribir
 * nada, y no hay nada honesto que mostrar mientras tanto.
 */
function barraDe(fraccion, { grande = false } = {}) {
    if (!Number.isFinite(fraccion)) return '';
    const pct = Math.max(0, Math.min(100, Math.round(100 * fraccion)));
    return `<div class="render-barra ${grande ? 'es-grande' : ''}" role="progressbar"
                 aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><span></span></div>`;
}

/**
 * Le pone el ancho a cada barra, después de insertar el HTML.
 *
 * **No se puede con `style="width:…"` en el HTML.** La CSP de la ventana es
 * `style-src 'self'`, sin `'unsafe-inline'`, así que el navegador descarta el
 * atributo y la barra se dibuja al 100% diga lo que diga. Así estuvo desde que
 * existe la vista: la barra del render se veía llena desde la primera toma.
 *
 * Tocar `el.style` desde JavaScript sí está permitido —la CSP mira el HTML,
 * no el CSSOM—, y el número se lee del `aria-valuenow` para que el que ve el
 * lector de pantalla y el que se dibuja no puedan separarse.
 */
function anchoDeLasBarras(donde) {
    for (const barra of donde.querySelectorAll('.render-barra')) {
        barra.firstElementChild.style.width = `${barra.getAttribute('aria-valuenow')}%`;
    }
}

function etapasDe(trabajo) {
    const orden = estado.etapas || [];
    const donde = orden.indexOf(trabajo.etapa);
    return `<div class="render-etapas">${orden.map((etapa, i) => {
        const clase = donde === -1 ? '' : (i < donde ? 'es-hecha' : (i === donde ? 'es-ahora' : ''));
        return `<span class="render-etapa ${clase}">${escapar((estado.nombresDeEtapa || {})[etapa] || etapa)}</span>`;
    }).join('')}</div>`;
}

/**
 * El control de calidad de una entrega.
 *
 * Es lo único que distingue «salió» de «salió bien», y hasta ahora solo estaba
 * en una línea de JSON del log. Un cuadro negro o un parpadeo no se ven
 * mirando el render por encima, pero sí se arreglan antes de publicar.
 */
function qaDe(qa) {
    if (!qa) return '';
    const partes = [
        `<span class="${qa.PASS ? 'es-bien' : 'es-mal'}">${qa.PASS ? 'Revisión OK' : 'Revisar a mano'}</span>`,
        qa.n_black ? `<span class="es-mal">${qa.n_black} cuadros negros</span>` : '',
        qa.n_flicker ? `<span class="es-mal">${qa.n_flicker} parpadeos</span>` : '',
        typeof qa.lufs === 'number' ? `<span>${qa.lufs.toFixed(1)} LUFS</span>` : ''
    ];
    return `<div class="render-qa">${partes.filter(Boolean).join('')}</div>`;
}

/** Una parte de una clase: su barra, en qué etapa va y cuánto lleva. */
function filaDeParte(trabajo) {
    const p = trabajo.progreso || {};
    const nombre = trabajo.parte
        ? `Parte ${trabajo.parte.replace(/^p/i, '')}`
        : trabajo.clase;
    return `
        <div class="render-parte">
            <div class="render-fila">
                <span class="render-parte-nombre">${escapar(nombre)}</span>
                <span class="render-dato">${escapar(
        (estado.nombresDeEtapa || {})[trabajo.etapa] || trabajo.etapa
    )}${p.detalle ? ` · ${escapar(p.detalle)}` : ''}</span>
            </div>
            ${barraDe(p.fraccion)}
            ${etapasDe(trabajo)}
        </div>`;
}

/**
 * Una clase: arriba cómo va entera, abajo cada parte.
 *
 * El desplegable viene abierto mientras la clase está trabajando y cerrado
 * cuando ya está: lo que se quiere ver de una clase lista es que está lista,
 * y lo que se quiere ver de una trabajando es cuál de sus partes falta.
 *
 * Con una sola parte no se despliega nada, porque la clase y la parte son lo
 * mismo y un triangulito que abre una copia de lo que ya se ve es ruido.
 */
function tarjetaDeClase(g) {
    const pct = Math.round(100 * g.fraccion);
    const etapa = g.etapa ? (estado.nombresDeEtapa || {})[g.etapa] || g.etapa : 'Listo';
    const cuantas = g.partes.length;

    const cabeza = `
        <div class="render-fila">
            <span class="render-nombre">${escapar(g.clase)}</span>
            <span class="render-dato">${escapar(etapa)} · ${pct}%</span>
        </div>
        ${barraDe(g.fraccion, { grande: true })}`;

    if (cuantas === 1) {
        return `<article class="render-tarjeta">
            ${cabeza}
            ${etapasDe(g.partes[0])}
        </article>`;
    }

    const hechas = g.partes.filter(j => j.etapa === 'delivered').length;
    const abierto = desplegados.has(g.llave) ? desplegados.get(g.llave) : g.estado === 'trabajando';
    return `
        <article class="render-tarjeta">
            <details class="render-desplegable" data-clase="${escapar(g.llave)}" ${abierto ? 'open' : ''}>
                <summary>
                    ${cabeza}
                    <span class="render-partes-cuenta">${hechas} de ${cuantas} partes listas</span>
                </summary>
                <div class="render-partes">${g.partes.map(filaDeParte).join('')}</div>
            </details>
        </article>`;
}

/**
 * Un trabajo que se cortó.
 *
 * No se dice en qué etapa falló: `step.py` pisa la etapa con `error` al
 * fallar, así que la original ya no está en ningún lado. Decir «falló en
 * Error» sería inventar, y el mensaje del registro alcanza para ubicarlo.
 */
function tarjetaConError(trabajo) {
    return `
        <article class="render-tarjeta es-mal">
            <div class="render-fila">
                <span class="render-nombre">${escapar(trabajo.clase)}</span>
                <span class="render-dato">se cortó</span>
            </div>
            <pre class="render-error">${escapar(trabajo.error || 'Sin mensaje en el registro.')}</pre>
            <div class="render-acciones">
                ${boton('Copiar para Claude', {
        dato: ['copiar', trabajo.nombre],
        titulo: 'Copia el trabajo y el error, listo para pegarle'
    })}
            </div>
        </article>`;
}

function tarjetaEntregada(trabajo) {
    return `
        <article class="render-tarjeta">
            <div class="render-fila">
                <span class="render-nombre">${escapar(trabajo.clase)}</span>
                ${boton('Revisar', { dato: ['revisar', trabajo.ruta] })}
            </div>
            ${qaDe(trabajo.qa)}
        </article>`;
}

function grupo(titulo, dentro) {
    return dentro ? `<section class="render-grupo"><h4>${escapar(titulo)}</h4>${dentro}</section>` : '';
}

function pintarTareas() {
    const t = estado.tareas;
    if (!t || (!t.corriendo && !t.pendientes.length && !t.hechas.length)) return '';
    const fila = (nombre, extra, clase) =>
        `<div class="render-tarea ${clase || ''}"><span class="render-tarea-nombre">${escapar(nombre)}</span><span class="render-tarea-ultima">${escapar(extra || '')}</span></div>`;
    return grupo('Tareas del Mac', [
        t.corriendo ? fila(t.corriendo.nombre, t.corriendo.ultima, 'es-ahora') : '',
        ...t.pendientes.map(n => fila(n, 'en espera')),
        ...t.hechas.slice(-4).reverse().map(n => fila(n, 'listo', 'es-hecha'))
    ].join(''));
}

/**
 * Las dependencias que el worker no encontró, con botón para instalarlas.
 *
 * Se monta una vez y después solo se le cambia el filtro: la lista la
 * mantiene `dependencias.js`, y cuando algo se instala, el próximo intento de
 * encender ya no lo va a reclamar.
 */
let faltantesMontados = null;
function pintarFaltantes(falta) {
    const caja = $('#render-deps');
    const claves = falta.map(f => f.clave).filter(Boolean);
    caja.hidden = !claves.length;
    if (!claves.length) return;
    if (!faltantesMontados) {
        faltantesMontados = dependencias.montar(caja, { solo: claves });
    } else {
        dependencias.filtrar(caja, claves);
    }
}

/**
 * Lo que se está subiendo a Frame.io.
 *
 * Va acá y no solo en la columna de clases porque una entrega termina en dos
 * lados: el render y la subida. Verlas juntas es lo que deja seguir una clase
 * desde que Claude la encola hasta que el equipo la puede comentar.
 */
function pintarSubidas() {
    const f = frameio.ultimo();
    if (!f || !f.subiendo) return '';
    return grupo('Subiendo a Frame.io', `
        <article class="render-tarjeta">
            <div class="render-fila">
                <span class="render-nombre">${escapar(f.subiendo.archivo)}</span>
                <span class="render-dato">${f.subiendo.pct} %</span>
            </div>
            ${barraDe(f.subiendo.pct / 100, { grande: true })}
            ${f.enCola.length ? `<p class="render-aviso">${f.enCola.length} más en fila.</p>` : ''}
        </article>`);
}

export function pintar() {
    pintarWorker();
    const listas = $('#render-listas');
    if (!estado) {
        listas.innerHTML = '';
        $('#render-log').textContent = '';
        return;
    }

    // Lo que le falta al worker va con su botón de instalar, con la misma
    // lista que Ajustes; lo que no es de la Mac —los módulos de Python, que
    // Reviewer pone solo— se dice en texto.
    pintarFaltantes(estado.falta || []);
    const avisos = (estado.avisos || []).map(a => `<p class="render-aviso">${escapar(a)}</p>`).join('')
        + (estado.falta || []).filter(f => !f.clave).map(f => `<p class="render-aviso">Falta ${escapar(f.que)}. ${escapar(f.como)}</p>`).join('');

    // Por clase y no por trabajo: una clase partida en tres son tres trabajos
    // en la cola, pero una sola cosa que el editor está esperando.
    const enCurso = (estado.grupos || []).filter(g => g.estado === 'trabajando');
    const entregados = estado.entregados.slice(-6).reverse();

    listas.innerHTML = avisos
        + grupo('Con error', estado.errores.map(tarjetaConError).join(''))
        + (enCurso.length
            ? grupo('Exportando ahora', enCurso.map(tarjetaDeClase).join(''))
            : `<div class="render-vacio">No hay nada en la cola. Cuando Claude deje trabajo, aparece acá.</div>`)
        + pintarTareas()
        + grupo('Entregados', entregados.map(tarjetaEntregada).join(''));

    listas.innerHTML += pintarSubidas();
    anchoDeLasBarras(listas);
    $('#render-log').textContent = (estado.log || []).join('\n');
}

/**
 * Llega estado nuevo del proceso principal.
 *
 * Se repinta solo si la vista está abierta —con la pestaña en Revisión no hay
 * nada que dibujar— pero la insignia se actualiza siempre, que es justamente
 * para lo que sirve.
 */
export function recibir(nuevo) {
    const antes = estado;
    estado = nuevo;

    // Lo entregado desde que se abrió la app y todavía no se miró. Se calcula
    // acá, contra lo que había antes, y no en el motor: «sin ver» es algo de
    // esta ventana, no del disco.
    if (nuevo && antes) {
        const eran = new Set(antes.entregados.map(j => j.ruta));
        for (const j of nuevo.entregados) {
            if (!eran.has(j.ruta) && !mirando()) vistas.delete(j.ruta);
        }
    }
    if (mirando()) pintar();
    al.cambio();
}

/** Cuántas entregas hay sin mirar. Lo usa la insignia. */
export function sinVer() {
    if (!estado) return 0;
    return estado.entregados.filter(j => !vistas.has(j.ruta)).length;
}

/** Se abrió la pestaña: lo entregado deja de estar sin ver. */
export function alAbrir() {
    if (estado) for (const j of estado.entregados) vistas.add(j.ruta);
    pintar();
    al.cambio();
}

/** El último estado, para quien necesite leerlo sin pedirlo de nuevo. */
export const ultimo = () => estado;

export function montar() {
    // Un solo escucha para toda la vista, puesta sobre el contenedor: las
    // tarjetas se rehacen enteras cada dos segundos, así que un listener por
    // botón se perdería en el siguiente repintado.
    $('#vista-render').addEventListener('click', async e => {
        // Antes que los botones: el clic llega acá antes de que el navegador
        // abra o cierre el `details`, así que lo que se guarda es lo contrario
        // de lo que está puesto ahora.
        const resumen = e.target.closest('summary');
        if (resumen) {
            const caja = resumen.closest('details[data-clase]');
            if (caja) desplegados.set(caja.dataset.clase, !caja.open);
            return;
        }

        const donde = e.target.closest('button');
        if (!donde) return;

        if (donde.id === 'render-arrancar' || donde.id === 'render-forzar') {
            donde.disabled = true;
            const r = await window.rv.tallerArrancar({ forzar: donde.id === 'render-forzar' });
            donde.disabled = false;
            if (!r.ok) avisar(r.error, 'mal');
            else anotar('taller.encendido', {});
            return;
        }
        if (donde.id === 'render-parar') {
            await window.rv.tallerParar();
            anotar('taller.pausado', {});
            return;
        }
        if (donde.id === 'render-finder') {
            const carpeta = await window.rv.tallerCarpeta();
            if (carpeta) window.rv.abrirEnFinder(carpeta);
            return;
        }
        if (donde.id === 'render-elegir') {
            donde.disabled = true;
            const r = await window.rv.tallerElegir();
            donde.disabled = false;
            if (r.cancelado) return;
            if (!r.ok) avisar(r.error, 'mal');
            else anotar('taller.elegido', {});
            return;
        }
        if (donde.dataset.revisar) {
            al.revisar(donde.dataset.revisar);
            return;
        }
        if (donde.dataset.copiar) {
            const trabajo = estado.trabajos.find(j => j.nombre === donde.dataset.copiar);
            if (!trabajo) return;
            await window.rv.copiar(
                `El render de ${trabajo.clase} falló en el worker del Mac.\n\n`
                + `Trabajo: ${trabajo.nombre}\nTag: ${trabajo.tag || '—'}\nEtapa: ${trabajo.etapa}\n\n`
                + `Error:\n${trabajo.error || '(sin mensaje en el registro)'}\n`
            );
            avisar('Copiado. Pegáselo a Claude.');
        }
    });

    window.rv.alCambiarTaller(recibir);
    window.rv.alPrepararTaller(carga => {
        if (carga && carga.texto) avisar(carga.texto);
    });
    // El proceso principal pudo haber vuelto al último curso antes de que
    // esta ventana existiera, y ese primer aviso no llegó a nadie. Pedirlo
    // una vez hace que lo vuelva a mandar; lo que devuelve no hace falta.
    window.rv.tallerEstado();
}
