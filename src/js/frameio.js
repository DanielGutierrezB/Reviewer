'use strict';
/**
 * frameio.js — Lo que la ventana muestra de Frame.io.
 *
 * Tres sitios, un solo estado: el bloque de Ajustes donde se conecta la cuenta,
 * la cajita de la columna de clases con la carpeta vinculada y el botón de
 * traer, y el selector de carpeta. Los tres se repintan juntos desde lo que
 * manda el proceso principal, que es el único que habla con Frame.io: la
 * ventana tiene `connect-src 'self'` y no podría ni intentarlo.
 *
 * Decidir qué significa cada cosa —qué falta subir, qué versión es qué archivo,
 * si hay que apilar— es del motor. Acá solo se dibuja y se aprieta.
 */

import { $, anotar, avisar, escapar } from './chrome.js';
import { estado } from './estado.js';

/** Lo último que mandó el proceso principal. */
let fio = null;

/** Por dónde va el selector de carpeta. */
const eligiendo = { nivel: 'cuenta', camino: [], cuenta: null, workspace: null, proyecto: null, carpeta: null };

/** Lo que quedó sin pareja después de buscar, para emparejarlo a mano. */
const aMano = { versiones: [], remotos: [] };

/**
 * Lo que este módulo le pide a la ventana. Lo pone `app.js`.
 *
 * Son dos y no uno porque cuestan distinto: la lista de clases se repinta solo
 * cuando cambió qué está subido, y la pestaña Render en cada avance de la
 * barra. Con un solo gancho, cada porcentaje rehacía la lista de clases entera.
 */
export const al = {
    /** Repintar la lista de clases y los botones de versión. */
    clases: () => {},
    /** Repintar la pestaña Render, que muestra la barra de la subida. */
    render: () => {}
};

/** De qué archivo de Frame.io es una versión, para los puntos de la lista. */
export function deVersion(version) {
    if (!fio || !fio.vinculo || !version) return null;
    return fio.vinculo.renders[version.archivo] || null;
}

/** Lo último que se sabe. Lo usa la pestaña Render para la barra de la subida. */
export const ultimo = () => fio;

// ─── La cajita de la columna de clases ────────────────────────────────

function hace(cuando) {
    if (!cuando) return 'todavía no';
    const minutos = Math.round((Date.now() - new Date(cuando).getTime()) / 60000);
    if (minutos < 1) return 'recién';
    return minutos === 1 ? 'hace 1 min' : `hace ${minutos} min`;
}

function pintarColumna() {
    const caja = $('#clases-frameio');
    if (!estado.raiz || !fio || !fio.configurada) {
        caja.hidden = true;
        return;
    }
    caja.hidden = false;

    if (!fio.conectado) {
        caja.innerHTML = `
            <p class="frameio-nota">Conectate a Frame.io en Ajustes para traer los comentarios del equipo.</p>`;
        return;
    }
    if (!fio.vinculo || !fio.vinculo.ruta) {
        caja.innerHTML = `
            <p class="frameio-nota">Este curso no está vinculado a Frame.io.</p>
            <button type="button" class="btn btn-ghost btn-chico" data-fio="vincular">Vincular con Frame.io…</button>`;
        return;
    }

    const subiendo = fio.subiendo
        ? `<p class="frameio-nota">Subiendo ${escapar(fio.subiendo.archivo)}… ${fio.subiendo.pct} %</p>`
        : '';
    const enCola = fio.enCola.length
        ? `<p class="frameio-nota">${fio.enCola.length} ${fio.enCola.length === 1 ? 'render' : 'renders'} en fila para subir.</p>`
        : '';

    caja.innerHTML = `
        <p class="frameio-camino" title="${escapar(fio.vinculo.camino)}">Frame.io · ${escapar(fio.vinculo.camino || 'carpeta vinculada')}</p>
        ${subiendo}${enCola}
        <div class="frameio-acciones">
            <button type="button" class="btn btn-ghost btn-chico" data-fio="traer">Traer de Frame.io</button>
            <span class="frameio-cuando">${escapar(hace(fio.ultimaTraida))}</span>
        </div>
        <label class="check frameio-check">
            <input type="checkbox" data-fio="subir-solo"${fio.vinculo.subirSolo ? ' checked' : ''}>
            Subir lo que entregue Claude
        </label>
        <details class="frameio-mas">
            <summary>Más</summary>
            <button type="button" class="btn btn-ghost btn-chico" data-fio="emparejar"
                    title="Busca en la carpeta de Frame.io los archivos que coincidan por nombre con estos renders">Buscar lo que ya está allá</button>
            <button type="button" class="btn btn-ghost btn-chico" data-fio="subir">Subir lo que falte</button>
            <button type="button" class="btn btn-ghost btn-chico" data-fio="vincular">Cambiar de carpeta…</button>
            <button type="button" class="btn btn-ghost btn-chico" data-fio="desvincular">Desvincular</button>
        </details>
        ${pintarAMano()}`;
}

/**
 * Lo que no coincidió por nombre, para emparejarlo a mano.
 *
 * Sale solo después de buscar, y solo con lo que quedó sin pareja. Emparejar
 * por parecido —sin extensión, por la clase— es cómo un comentario de la v2
 * termina en la v3, así que lo que no coincide exacto lo decide una persona.
 */
function pintarAMano() {
    if (!aMano.versiones.length) return '';
    const opciones = ['<option value="">— elegí el archivo de Frame.io —</option>']
        .concat(aMano.remotos.map(r => `<option value="${escapar(r.id)}">${escapar(r.nombre)}</option>`))
        .join('');
    return `
        <div class="frameio-amano">
            <p class="frameio-nota">Estos renders no están en Frame.io con el mismo nombre:</p>
            ${aMano.versiones.map(v => `
                <label class="frameio-par">
                    <span title="${escapar(v.archivo)}">${escapar(v.clase)} · ${escapar(v.etiqueta)}</span>
                    <select data-par="${escapar(v.archivo)}">${opciones}</select>
                </label>`).join('')}
        </div>`;
}

// ─── El bloque de Ajustes ─────────────────────────────────────────────

function pintarAjustes() {
    if (!fio) return;
    $('#btn-fio-conectar').hidden = fio.conectado;
    $('#btn-fio-desconectar').hidden = !fio.conectado;
    $('#btn-fio-conectar').disabled = !fio.configurada;
    $('#btn-fio-conectar').textContent = fio.configurada ? 'Conectar con Frame.io' : 'Pegá primero el identificador';

    const ayuda = $('#fio-ayuda');
    if (!fio.configurada) {
        ayuda.textContent = 'Se crea una vez en la Adobe Developer Console: proyecto nuevo, agregá la Frame.io API y'
            + ` una credencial OAuth Native App. Registrale ${fio.redirect} como patrón de regreso.`;
    } else if (!fio.guardaElToken) {
        ayuda.textContent = 'Ojo: el Llavero no está disponible, así que la sesión se va a perder al cerrar la app.';
    } else {
        ayuda.textContent = `El regreso registrado tiene que ser ${fio.redirect}.`;
    }

    const aviso = $('#fio-aviso');
    if (fio.conectado) {
        aviso.textContent = fio.quien ? `Conectado como ${fio.quien}.` : 'Conectado.';
        aviso.className = 'campo-aviso is-bien';
    } else if (!aviso.dataset.suyo) {
        aviso.textContent = '';
        aviso.className = 'campo-aviso';
    }
}

/** Lo que Ajustes pone al abrirse: el identificador guardado. */
export function pintarEnAjustes() {
    $('#fio-cliente').value = (estado.ajustes.frameio && estado.ajustes.frameio.clientId) || '';
    pintarAjustes();
}

// ─── El selector de carpeta ───────────────────────────────────────────

function decirEnModal(texto, tono) {
    const caja = $('#fio-modal-aviso');
    caja.textContent = texto;
    caja.className = `campo-aviso${tono ? ` is-${tono}` : ''}`;
}

async function explorar() {
    decirEnModal('Buscando…');
    $('#fio-lista').innerHTML = '';
    const r = await window.rv.frameioExplorar({
        cuenta: eligiendo.cuenta,
        workspace: eligiendo.workspace,
        proyecto: eligiendo.proyecto,
        carpeta: eligiendo.carpeta
    });
    if (!r.ok) {
        decirEnModal(r.error, 'mal');
        return;
    }
    decirEnModal('');
    eligiendo.nivel = r.nivel;
    if (r.carpeta) eligiendo.carpeta = r.carpeta;

    $('#fio-camino').textContent = eligiendo.camino.length
        ? eligiendo.camino.map(p => p.nombre).join(' / ')
        : 'Elegí la cuenta.';
    // Dentro de un proyecto, la carpeta donde estás parado YA es una opción
    // válida: casi siempre los renders van en la raíz del proyecto, y obligar a
    // entrar a una subcarpeta sería inventar una que no existe.
    $('#btn-fio-elegir').hidden = r.nivel !== 'carpeta';
    $('#btn-fio-atras').hidden = !eligiendo.camino.length;

    $('#fio-lista').innerHTML = r.items.length
        ? r.items.map(i => `<li><button type="button" class="fio-item" data-id="${escapar(i.id)}" data-nombre="${escapar(i.nombre)}">${escapar(i.nombre)}</button></li>`).join('')
        : '<li class="frameio-nota">Acá adentro no hay carpetas.</li>';
}

function entrarA(id, nombre) {
    const nivel = eligiendo.nivel;
    eligiendo.camino.push({ nivel, id, nombre });
    if (nivel === 'cuenta') eligiendo.cuenta = id;
    else if (nivel === 'workspace') eligiendo.workspace = id;
    else if (nivel === 'proyecto') { eligiendo.proyecto = id; eligiendo.carpeta = null; }
    else eligiendo.carpeta = id;
    explorar();
}

function volver() {
    const salio = eligiendo.camino.pop();
    if (!salio) return;
    if (salio.nivel === 'cuenta') eligiendo.cuenta = null;
    else if (salio.nivel === 'workspace') eligiendo.workspace = null;
    else if (salio.nivel === 'proyecto') { eligiendo.proyecto = null; eligiendo.carpeta = null; }
    else {
        // Al salir de una carpeta se vuelve a la de arriba, que es la última del
        // camino que quedó, o la raíz del proyecto si no quedó ninguna.
        const arriba = [...eligiendo.camino].reverse().find(p => p.nivel === 'carpeta');
        eligiendo.carpeta = arriba ? arriba.id : null;
    }
    eligiendo.nivel = salio.nivel;
    explorar();
}

function abrirSelector() {
    eligiendo.camino = [];
    eligiendo.cuenta = null;
    eligiendo.workspace = null;
    eligiendo.proyecto = null;
    eligiendo.carpeta = null;
    eligiendo.nivel = 'cuenta';
    $('#modal-fio').hidden = false;
    explorar();
}

async function guardarEleccion() {
    const de = nivel => [...eligiendo.camino].reverse().find(p => p.nivel === nivel);
    const cuenta = de('cuenta');
    const workspace = de('workspace');
    const proyecto = de('proyecto');
    const carpeta = de('carpeta');
    const r = await window.rv.frameioVincular({
        cuenta: cuenta && cuenta.id,
        cuentaNombre: cuenta && cuenta.nombre,
        workspace: workspace && workspace.id,
        workspaceNombre: workspace && workspace.nombre,
        proyecto: proyecto && proyecto.id,
        proyectoNombre: proyecto && proyecto.nombre,
        // Sin entrar a ninguna subcarpeta, la elegida es la raíz del proyecto,
        // que el explorador ya dejó en `eligiendo.carpeta`.
        carpeta: (carpeta && carpeta.id) || eligiendo.carpeta,
        carpetaNombre: (carpeta && carpeta.nombre) || (proyecto && proyecto.nombre)
    });
    if (!r.ok) {
        decirEnModal(r.error, 'mal');
        return;
    }
    $('#modal-fio').hidden = true;
    avisar('Vinculado. Reviewer va a traer los comentarios y a subir lo que falte.');
    anotar('frameio.vinculado', {});
}

// ─── Lo que llega del proceso principal ───────────────────────────────

/**
 * Vuelve a pedir el estado y repinta.
 *
 * Hace falta al abrir y al cerrar una carpeta: el proceso principal avisa
 * mientras todavía está atendiendo el `abrir-carpeta`, así que cuando ese aviso
 * llega la ventana todavía no sabe en qué carpeta está, y la cajita se
 * escondería sola.
 */
export async function refrescar() {
    recibir(await window.rv.frameioEstado());
}

function recibir(nuevo) {
    const antes = fio;
    fio = nuevo;
    pintarAjustes();
    pintarColumna();
    // La lista de clases muestra un punto por versión: si cambió qué está
    // subido, hay que repintarla.
    const cambiaron = !antes || JSON.stringify(antes.vinculo && antes.vinculo.renders) !== JSON.stringify(nuevo.vinculo && nuevo.vinculo.renders);
    if (cambiaron) al.clases();
    al.render();
}

export function wire() {
    $('#fio-cliente').addEventListener('change', async e => {
        estado.ajustes = await window.rv.ajustesParchear({ frameio: { clientId: e.target.value.trim() || null } });
        fio = await window.rv.frameioEstado();
        pintarAjustes();
    });

    $('#btn-fio-conectar').addEventListener('click', async () => {
        const aviso = $('#fio-aviso');
        aviso.dataset.suyo = '1';
        aviso.textContent = 'Te abrí el navegador. Entrá con tu cuenta y volvé.';
        aviso.className = 'campo-aviso';
        const r = await window.rv.frameioConectar();
        delete aviso.dataset.suyo;
        if (!r.ok) {
            aviso.textContent = r.error;
            aviso.className = 'campo-aviso is-mal';
            return;
        }
        if (r.aviso) avisar(r.aviso, 'mal');
        pintarAjustes();
    });

    $('#btn-fio-desconectar').addEventListener('click', async () => {
        await window.rv.frameioDesconectar();
        $('#fio-aviso').textContent = 'Desconectado.';
        $('#fio-aviso').className = 'campo-aviso';
    });

    // Un solo escucha para la cajita de la columna: se rehace entera en cada
    // aviso, así que un listener por botón se iría con el repintado.
    $('#clases-frameio').addEventListener('click', async e => {
        const boton = e.target.closest('[data-fio]');
        if (!boton || boton.tagName === 'INPUT') return;
        const que = boton.dataset.fio;

        if (que === 'vincular') { abrirSelector(); return; }
        if (que === 'traer') {
            boton.disabled = true;
            const r = await window.rv.frameioTraer();
            boton.disabled = false;
            if (!r.ok && r.error) avisar(r.error, 'mal');
            else if (!r.agregados && !r.actualizados && !r.borrados) avisar('Nada nuevo en Frame.io.');
            return;
        }
        if (que === 'subir') {
            const r = await window.rv.frameioSubir(null);
            avisar(r.ok ? `${r.cuantas} ${r.cuantas === 1 ? 'render' : 'renders'} en fila para subir.` : r.error, r.ok ? null : 'mal');
            return;
        }
        if (que === 'emparejar') {
            boton.disabled = true;
            const r = await window.rv.frameioEmparejar();
            boton.disabled = false;
            if (!r.ok) { avisar(r.error, 'mal'); return; }
            // Lo que quedó sin pareja de los dos lados queda a mano para que el
            // editor lo una: los locales en una lista, los de allá en el menú.
            aMano.versiones = r.sinEmparejar;
            aMano.remotos = r.huerfanos;
            pintarColumna();
            const partes = [`${r.emparejados.length} ${r.emparejados.length === 1 ? 'render emparejado' : 'renders emparejados'}`];
            if (r.sinEmparejar.length) partes.push(`${r.sinEmparejar.length} sin encontrar allá`);
            avisar(`${partes.join(', ')}.`);
            return;
        }
        if (que === 'desvincular') {
            await window.rv.frameioDesvincular();
            avisar('Desvinculado. Los comentarios que ya bajaron se quedan.');
        }
    });

    $('#clases-frameio').addEventListener('change', async e => {
        if (e.target.dataset.fio === 'subir-solo') {
            await window.rv.frameioSubirSolo(e.target.checked);
            return;
        }
        const archivo = e.target.dataset.par;
        if (!archivo || !e.target.value) return;
        const r = await window.rv.frameioVincularArchivo(archivo, e.target.value);
        if (!r.ok) { avisar(r.error, 'mal'); return; }
        aMano.versiones = aMano.versiones.filter(v => v.archivo !== archivo);
        pintarColumna();
        avisar(`${archivo} quedó vinculado. Ya traigo sus comentarios.`);
    });

    $('#fio-lista').addEventListener('click', e => {
        const item = e.target.closest('.fio-item');
        if (item) entrarA(item.dataset.id, item.dataset.nombre);
    });
    $('#btn-fio-atras').addEventListener('click', volver);
    $('#btn-fio-elegir').addEventListener('click', guardarEleccion);
    $('#fio-cerrar').addEventListener('click', () => { $('#modal-fio').hidden = true; });
    $('#modal-fio').addEventListener('click', e => {
        if (e.target === $('#modal-fio')) $('#modal-fio').hidden = true;
    });

    window.rv.alCambiarFrameio(recibir);
    window.rv.alAvanzarFrameio(a => {
        if (!fio) return;
        fio.subiendo = { archivo: a.archivo, pct: a.pct };
        pintarColumna();
        al.render();
    });
    window.rv.alTraerFrameio(r => {
        const partes = [];
        if (r.agregados) partes.push(`${r.agregados} ${r.agregados === 1 ? 'comentario nuevo' : 'comentarios nuevos'}`);
        if (r.actualizados) partes.push(`${r.actualizados} ${r.actualizados === 1 ? 'cambiado' : 'cambiados'}`);
        if (r.borrados) partes.push(`${r.borrados} ${r.borrados === 1 ? 'borrado' : 'borrados'}`);
        if (partes.length) avisar(`Frame.io: ${partes.join(', ')}.`);
    });

    // El estado inicial: el proceso principal pudo haber avisado antes de que
    // esta ventana existiera.
    window.rv.frameioEstado().then(recibir);
}
