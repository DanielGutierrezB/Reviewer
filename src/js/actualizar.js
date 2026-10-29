'use strict';
/**
 * actualizar.js — Avisar que hay una versión nueva sin meterse en el medio.
 *
 * El aviso es una cajita en la barra de arriba, y es así por una razón de esta
 * app en particular: revisar un render son treinta teclas de una sola letra
 * —espacio, J, K, L, M, O— sobre un video que se está mirando. Cualquier cosa
 * que se abra sola rompe las dos: un modal tapa el reproductor, y cualquier
 * cosa que tome el foco se come el próximo espacio y el video no arranca.
 *
 * Así que esto no abre nada, no suena, no se pone adelante y no pide el foco.
 * Aparece una cajita que dice que hay una versión nueva, y si al editor le
 * interesa la aprieta. Si no, sigue comentando y la cajita espera ahí.
 *
 * Quien sale a la red es el proceso principal (`engine/actualizaciones.js`): la
 * ventana tiene `connect-src 'self'` en la política de seguridad y no podría
 * consultar GitHub ni queriendo.
 */

import { $, anotar } from './chrome.js';
import { estado } from './estado.js';
import * as fmt from './formato.js';

/**
 * Cuánto se espera antes de preguntar sola.
 *
 * Cuatro segundos después de que la ventana está lista. No es por cortesía: el
 * arranque ya hace dos consultas al proceso principal, lista los micrófonos y
 * mide la segunda pantalla, y una más compitiendo con eso solo retrasa lo que
 * el editor está esperando ver. A los cuatro segundos la app ya está en uso y a
 * nadie le importa que haya un pedido andando de fondo.
 */
const ESPERA_MS = 4000;

const update = { buscando: false, hay: false, version: null, versionActual: null, notas: '', sinInstalador: false };

/**
 * Lo que este módulo le pide al resto.
 *
 * Es el mismo gancho que usan `reproductor.js` y `comentarios.js`, y por el
 * mismo motivo: la cajita de la barra tiene que poder abrir Ajustes, pero
 * `ajustes.js` ya importa a este módulo para pintar su bloque. Importarlo de
 * vuelta sería un ciclo, y un ciclo entre dos módulos ES no falla al cargar:
 * falla dejando uno de los dos a medio inicializar, que se ve como un botón que
 * no hace nada.
 */
export const al = { verAjustes: () => {} };

function decir(texto, tono) {
    const caja = $('#update-aviso');
    caja.textContent = texto;
    caja.className = `campo-aviso${tono ? ` is-${tono}` : ''}`;
}

/**
 * Pinta las tres cosas que cambian: la cajita de la barra, el bloque de Ajustes
 * y las notas.
 *
 * Todo junto y en una sola función porque son la misma información dicha en dos
 * lugares. Repintarlos por separado es cómo se llega a que la barra diga que hay
 * la 0.2.0 y Ajustes siga diciendo que estás al día.
 */
function pintar() {
    const chip = $('#chip-nueva');
    chip.hidden = !update.hay;
    if (update.hay) {
        chip.textContent = `Hay la ${update.version}`;
        chip.title = `Estás en la ${update.versionActual || ''}. Apretá para ver qué trae la ${update.version} y bajarla.`;
    }

    const boton = $('#btn-update-bajar');
    boton.hidden = !update.hay;
    boton.disabled = update.sinInstalador;
    boton.textContent = update.sinInstalador ? 'Todavía sin instalador' : `Bajar la ${update.version}`;
    boton.title = update.sinInstalador
        ? 'El release está publicado pero todavía no tiene el .pkg subido.'
        : 'Abre la página de la versión nueva en tu navegador, donde está el instalador.';

    const notas = $('#update-notas');
    // `textContent` y no `innerHTML`: esto es texto que viene de GitHub, y las
    // notas de una versión las escribe quien publica, no necesariamente quien
    // compiló esta app.
    notas.textContent = update.notas || '';
    notas.hidden = !(update.hay && update.notas);
}

/**
 * Pregunta si hay algo nuevo.
 *
 * @param {boolean} aMano true si el editor apretó el botón; false si es la
 *   comprobación del arranque. La diferencia es solo el «Preguntando…» y los
 *   fallos de IPC: a nadie que no esté mirando Ajustes le interesan.
 */
async function buscar(aMano) {
    if (update.buscando) {
        if (aMano) decir('Ya estoy preguntando…');
        return;
    }
    update.buscando = true;
    if (aMano) decir('Preguntando…');

    let r = null;
    try {
        r = await window.rv.actualizacionBuscar();
    } catch (e) {
        // El motor no lanza —un fallo de red vuelve como `hay: false` con su
        // motivo—, así que llegar acá es que se cayó el IPC. Se dice solo si el
        // editor estaba esperando una respuesta.
        update.buscando = false;
        if (aMano) decir(`No se pudo preguntar: ${e.message}`, 'mal');
        return;
    }
    update.buscando = false;

    Object.assign(update, {
        hay: Boolean(r && r.hay),
        version: r && r.version,
        versionActual: r && r.versionActual,
        notas: (r && r.notas) || '',
        sinInstalador: Boolean(r && r.sinInstalador)
    });
    pintar();

    if (update.hay) {
        const peso = r.tamanoBytes ? ` (${fmt.pesa(r.tamanoBytes)})` : '';
        decir(`Estás en la ${r.versionActual} y hay la ${r.version}${peso}.`, 'bien');
        anotar('update.hay', { version: r.version, aMano: Boolean(aMano) });
        return;
    }

    // Sin novedades no aparece la cajita de la barra y no se interrumpe nada,
    // pero el renglón de Ajustes se escribe igual aunque el panel esté cerrado:
    // así quien lo abre después lee lo que de verdad pasó —«no hay releases»,
    // «no se pudo consultar»— en vez de tener que apretar el botón para
    // enterarse de algo que la app ya sabía.
    decir(r && r.motivo ? r.motivo : `Estás en la ${r.versionActual}, que es la última.`);
}

/** Abre Ajustes en el bloque de actualizaciones, que es donde están las notas. */
async function verDeQueSeTrata() {
    // El foco se suelta antes de abrir el panel: un botón de la barra que queda
    // con el foco se queda también con el próximo espacio, y el espacio en esta
    // app es play/pausa.
    $('#chip-nueva').blur();
    await al.verAjustes();
    $('#aj-update').scrollIntoView({ block: 'nearest' });
}

/**
 * Lo que Ajustes muestra al abrirse: en qué versión estás y lo último que se
 * averiguó. No vuelve a preguntar —eso lo hace el botón— porque abrir Ajustes
 * para mirar el micrófono no tiene por qué salir a internet.
 *
 * La versión que corre se le pregunta al proceso principal y no se lee de la
 * barra de arriba: ese `v0.1.4` es texto para mirar, y parsearlo para volver a
 * armar el número es la clase de atajo que se rompe el día que alguien le
 * agrega algo al lado.
 */
export async function pintarEnAjustes() {
    if (!update.versionActual) {
        update.versionActual = (await window.rv.appInfo()).version;
    }
    $('#aj-update-auto').checked = estado.ajustes.actualizaciones.alArrancar;
    $('#update-version').textContent = `Estás en la ${update.versionActual}.`;
    pintar();
    if (!update.hay && !$('#update-aviso').textContent) {
        decir('Nadie preguntó todavía en esta sesión.');
    }
}

export function wire() {
    $('#chip-nueva').addEventListener('click', verDeQueSeTrata);
    $('#btn-update-buscar').addEventListener('click', () => buscar(true));

    $('#btn-update-bajar').addEventListener('click', async () => {
        const r = await window.rv.actualizacionAbrir();
        if (!r.ok) decir(r.error, 'mal');
        else decir('Te abrí la página en el navegador. Bajá el .pkg y abrilo.', 'bien');
    });

    $('#aj-update-auto').addEventListener('change', async e => {
        estado.ajustes = await window.rv.ajustesParchear({
            actualizaciones: { alArrancar: e.target.checked }
        });
    });

    // Sin `await` y sin que nadie espere el resultado: si no hay internet, el
    // motor contesta «no hay nada» y acá no pasa nada. Lo que no puede pasar es
    // que el arranque de la ventana dependa de que GitHub conteste.
    //
    // Se decide una sola vez, acá: encender la casilla a mitad de una sesión no
    // dispara la consulta, porque este ajuste es «al abrir la app» y no «cada
    // tanto». El botón de al lado está justo para eso.
    if (estado.ajustes.actualizaciones.alArrancar) {
        setTimeout(() => buscar(false), ESPERA_MS);
    }
}
