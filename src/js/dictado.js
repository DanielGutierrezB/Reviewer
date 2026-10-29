'use strict';
/**
 * dictado.js — El micrófono, del lado de la ventana.
 *
 * Abre el micrófono, manda el audio al proceso principal y va poniendo en el
 * campo lo que Whisper va entendiendo. Al parar, pide una última lectura y —si
 * está puesto en Ajustes— la pasa por el modelo para que quede escrita como una
 * nota de edición.
 *
 * **Lo que ya estaba escrito no se pisa nunca**: el dictado se agrega abajo
 * mientras se habla, y al parar las dos partes se refinan juntas, como una sola
 * idea, no una atrás de la otra.
 *
 * **El texto en vivo se reescribe entero en cada refresco**, porque el motor no
 * trocea el audio: retranscribe todo el buffer cada segundo y medio. A cambio,
 * la frase se corrige sola a medida que crece el contexto en vez de quedar
 * cosida de pedazos que no se conocen entre sí.
 *
 * El botón está verde cuando se puede dictar y rojo mientras escucha. En una
 * máquina donde el dictado no está disponible queda gris y su globito dice qué
 * falta: que una función exista y no esté disponible es información, que no esté
 * es un misterio.
 */

import { $, $$, anotar } from './chrome.js';
import { estado } from './estado.js';

/** Cada cuánto se vuelve a leer todo lo dicho. */
const REFRESCO_MS = 1500;

const sesion = {
    campo: null,
    boton: null,
    stream: null,
    contexto: null,
    nodo: null,
    reloj: null,
    yaEstaba: '',
    ultimo: '',
    leyendo: false
};

/** Quien escucha. Lo pone `app.js`. */
export const al = { termina: () => {} };

function campoDe(cual) {
    return cual === 'modal' ? $('#modal-texto') : $('#general-texto');
}

function avisoDe(cual) {
    return $(`[data-aviso="${cual}"]`);
}

function decir(cual, texto, tono) {
    const nodo = avisoDe(cual);
    if (!nodo) return;
    nodo.textContent = texto || '';
    nodo.className = `campo-aviso${tono ? ` is-${tono}` : ''}`;
}

export function oyendo() {
    return Boolean(sesion.stream);
}

/** Pinta los micrófonos de la ventana según lo que esta Mac puede. */
export function pintarBotones() {
    for (const boton of $$('.icono-mic')) {
        const puede = estado.puedeDictar;
        boton.disabled = !puede || (oyendo() && boton !== sesion.boton);
        boton.classList.toggle('is-oyendo', oyendo() && boton === sesion.boton);
        boton.title = !puede
            ? (estado.dictadoMotivo || 'Esta Mac no puede dictar')
            : (oyendo() && boton === sesion.boton ? 'Parar' : 'Dictar');
    }
}

async function leer() {
    if (sesion.leyendo || !sesion.campo) return;
    sesion.leyendo = true;
    try {
        const r = await window.rv.dictadoLeer();
        if (!sesion.campo) return;
        if (!r.ok) {
            decir(sesion.cual, r.motivo, 'mal');
            return;
        }
        if (r.silencio && !r.texto) {
            decir(sesion.cual, r.motivo || 'No se oye nada todavía…');
            return;
        }
        if (!r.texto) return;
        sesion.ultimo = r.texto;
        const separador = sesion.yaEstaba && !/\s$/.test(sesion.yaEstaba) ? '\n' : '';
        sesion.campo.value = `${sesion.yaEstaba}${separador}${r.texto}`;
        // Que se vea el final de lo que se va diciendo: el texto se reescribe
        // entero en cada refresco, así que hay que volver a mandarlo abajo.
        sesion.campo.scrollTop = sesion.campo.scrollHeight;
        sesion.campo.dispatchEvent(new Event('input'));
        decir(sesion.cual, `Escuchando… ${Math.round(r.segundos)} s`);
    } finally {
        sesion.leyendo = false;
    }
}

export async function empezar(cual, boton) {
    if (oyendo()) return parar();

    const arranque = await window.rv.dictadoEmpezar();
    if (!arranque.ok) {
        decir(cual, arranque.motivo, 'mal');
        return;
    }

    sesion.cual = cual;
    sesion.campo = campoDe(cual);
    sesion.boton = boton;
    sesion.yaEstaba = sesion.campo.value;
    sesion.ultimo = '';

    try {
        const preferido = estado.ajustes && estado.ajustes.dictado.microfono;
        sesion.stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                ...(preferido ? { deviceId: { ideal: preferido } } : {}),
                // El micrófono de una Mac con la cancelación puesta le come los
                // finales de palabra cuando uno habla bajito; acá el audio no se
                // escucha, se transcribe, así que conviene crudo.
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: true
            }
        });
    } catch (e) {
        decir(cual, 'No se pudo abrir el micrófono. Revisá los permisos del sistema.', 'mal');
        sesion.stream = null;
        return;
    }

    // 16 kHz es lo que Whisper quiere: pidiéndoselo al contexto, Chromium
    // resamplea por su cuenta y no hay que escribir un remuestreador acá.
    sesion.contexto = new AudioContext({ sampleRate: 16000 });
    await sesion.contexto.audioWorklet.addModule('js/captura-worklet.js');
    sesion.nodo = new AudioWorkletNode(sesion.contexto, 'captura-dictado');
    sesion.nodo.port.onmessage = evento => {
        window.rv.dictadoTrozo(evento.data.buffer);
    };
    sesion.contexto.createMediaStreamSource(sesion.stream).connect(sesion.nodo);
    // El worklet no saca sonido, pero sin conectarlo a algo Chromium no lo
    // corre: `process` nunca se llama y no llega audio.
    sesion.nodo.connect(sesion.contexto.destination);

    sesion.reloj = setInterval(leer, REFRESCO_MS);
    decir(cual, arranque.listo ? 'Escuchando…' : 'Cargando el modelo de voz…');
    pintarBotones();
    anotar('dictado.empieza', { campo: cual });
}

export async function parar() {
    if (!oyendo()) return;
    const cual = sesion.cual;
    const campo = sesion.campo;

    clearInterval(sesion.reloj);
    for (const pista of sesion.stream.getTracks()) pista.stop();
    try { sesion.nodo.disconnect(); } catch (e) { /* ya estaba suelto */ }
    try { await sesion.contexto.close(); } catch (e) { /* ya estaba cerrado */ }
    sesion.stream = null;
    sesion.nodo = null;
    sesion.contexto = null;
    pintarBotones();

    decir(cual, 'Pasando a limpio…');
    // La última lectura es del buffer COMPLETO, igual que las parciales: el
    // texto final nunca se arma pegando pedazos.
    const ultima = await window.rv.dictadoLeer();
    window.rv.dictadoCerrar();

    const dictado = (ultima.ok && ultima.texto) ? ultima.texto : sesion.ultimo;
    sesion.campo = null;
    sesion.boton = null;

    if (!dictado) {
        campo.value = sesion.yaEstaba;
        decir(cual, ultima.ok ? 'No se entendió nada de lo que se dijo.' : ultima.motivo, 'mal');
        return;
    }

    const separador = sesion.yaEstaba && !/\s$/.test(sesion.yaEstaba) ? '\n' : '';
    campo.value = `${sesion.yaEstaba}${separador}${dictado}`;
    campo.dispatchEvent(new Event('input'));

    if (!(estado.ajustes && estado.ajustes.dictado.refinar)) {
        decir(cual, 'Listo.');
        al.termina(cual);
        return;
    }

    const r = await window.rv.refinar({
        texto: sesion.yaEstaba,
        dictado,
        origen: 'dictado'
    });

    if (r.ok) {
        campo.value = r.texto;
        campo.dispatchEvent(new Event('input'));
        guardarCrudo(cual, r.crudo);
        decir(cual, `Pasado a limpio por ${r.modelo}`, 'bien');
    } else {
        // Un dictado sí se puede pisar con el crudo: el crudo es lo que acababa
        // de entrar, así que no se pierde nada de lo escrito antes.
        decir(cual, `Quedó como se dijo: ${r.motivo}`, 'mal');
    }
    al.termina(cual);
}

/** Lo que se había dicho antes de pasarlo a limpio, para el botón de volver. */
const crudos = new Map();

function guardarCrudo(cual, crudo) {
    if (!crudo) return;
    crudos.set(cual, crudo);
    const boton = $(`[data-volver="${cual}"]`);
    if (boton) boton.hidden = false;
}

export function wire() {
    for (const boton of $$('.icono-mic')) {
        boton.addEventListener('click', () => {
            const cual = boton.dataset.dictar;
            if (oyendo()) parar(); else empezar(cual, boton);
        });
    }

    for (const boton of $$('[data-volver]')) {
        boton.addEventListener('click', () => {
            const cual = boton.dataset.volver;
            const crudo = crudos.get(cual);
            if (!crudo) return;
            const campo = campoDe(cual);
            campo.value = crudo;
            campo.dispatchEvent(new Event('input'));
            crudos.delete(cual);
            boton.hidden = true;
            decir(cual, '');
        });
    }

    // El ✨ de los dos campos grandes: el mismo refinador, sobre lo tecleado.
    for (const boton of $$('[data-refinar]')) {
        boton.addEventListener('click', async () => {
            const cual = boton.dataset.refinar;
            const campo = campoDe(cual);
            if (!campo.value.trim()) return;
            boton.disabled = true;
            decir(cual, 'Mejorando la redacción…');
            const r = await window.rv.refinar({ texto: campo.value, origen: 'escrito' });
            boton.disabled = false;
            if (!r.ok) {
                // Lo tecleado no se pisa: queda tal cual y se dice el motivo.
                decir(cual, r.motivo, 'mal');
                return;
            }
            guardarCrudo(cual, campo.value);
            campo.value = r.texto;
            campo.dispatchEvent(new Event('input'));
            decir(cual, `Reescrito por ${r.modelo}`, 'bien');
        });
    }
}

export { decir };
