'use strict';
/**
 * claude.js — El bloque de «Mi cuenta de Claude» dentro de Ajustes.
 *
 * Vive aparte de `ajustes.js` porque es lo único de esa pantalla que no
 * configura un servidor: no hay dirección que escribir ni clave que pegar, hay
 * una sesión que está o no está, y eso se pinta distinto. Mezclarlo con el
 * resto habría convertido `pintarProveedor` en una tabla de excepciones.
 *
 * **No hay botón de «Iniciar sesión».** Es la decisión que más se nota de este
 * archivo y es a propósito: iniciar sesión es `claude auth login` en una
 * terminal, que abre el navegador y guarda la sesión en el CLI. Un botón acá
 * tendría que lanzar `claude setup-token` de forma interactiva, leer la URL de
 * su salida, abrir el navegador, pedirle al editor que pegue el código y
 * guardarse el token que sale —que es exactamente lo que hace HyperPremiere, y
 * por una razón que acá no se da: allá el panel corre adentro de Premiere, en
 * la máquina de un editor que no tiene por qué abrir una terminal nunca—.
 * Reviewer es una app para hablarle a Claude: quien la usa tiene la CLI y la
 * terminal. Cambiar cuatro pasos y un secreto guardado por un comando copiado
 * es mejor negocio, y el comando está escrito acá al lado para copiarlo.
 */

import { $, avisar } from './chrome.js';

/** Lo último que se supo de la sesión, para que `ajustes.js` no vuelva a preguntar. */
let ultima = null;

export function estado() {
    return ultima;
}

function pintarEstado(s) {
    const aviso = $('#claude-estado');
    const nota = $('#claude-nota');

    aviso.textContent = s.resumen;
    // Tres clases para cuatro estados: «no se sabe» se pinta neutro a propósito.
    // Que la pregunta haya fallado no quiere decir que falte la sesión, y
    // pintarlo de rojo manda a arreglar algo que a lo mejor funciona.
    aviso.className = `campo-aviso${s.estado === 'con-sesion' ? ' is-bien' : (s.estado === 'no-se-sabe' ? '' : ' is-mal')}`;

    // El botón de cerrar sesión solo cuando hay una: un botón que no puede
    // hacer nada igual invita a apretarlo.
    $('#claude-salir').hidden = s.estado !== 'con-sesion';

    const partes = [];
    if (s.detalle) partes.push(s.detalle);
    if (s.estado === 'con-sesion') {
        // Dicho cada vez que se abre la pantalla y no una sola vez al elegir la
        // opción: es la diferencia con los otros dos transportes y el editor
        // tiene que poder verla cuando decide, no haberla leído una vez.
        partes.push('El texto de los comentarios viaja a Anthropic para reescribirse. Con Ollama no sale de esta Mac.');
        partes.push('Cerrar sesión la cierra en todo el CLI de Claude, también en la terminal.');
    }
    nota.textContent = partes.join(' ');
}

function pintarModelos(modelos, elegido) {
    const select = $('#llm-modelo');
    select.textContent = '';
    for (const m of modelos) {
        const opcion = document.createElement('option');
        opcion.value = m.id;
        opcion.textContent = m.nombre;
        if (m.id === elegido) opcion.selected = true;
        select.appendChild(opcion);
    }
    // Sin la opción «—»: con la cuenta de Claude siempre hay un modelo, porque
    // el que no elige nada usa Haiku. Dejarla vacía ofrecería un estado que no
    // existe y que haría fallar al botón de mejorar por nada.
    if (!modelos.some(m => m.id === elegido)) select.value = modelos[0].id;
}

/**
 * Pregunta cómo está la sesión y pinta el bloque. Devuelve el estado para que
 * quien llame pueda guardar el modelo que quedó elegido.
 *
 * Tarda lo que tarda `claude auth status` —unos 250 ms medidos— y por eso se
 * pide al abrir Ajustes y no al dibujar cada campo.
 */
export async function pintar(elegido) {
    $('#claude-estado').textContent = 'Preguntándole al CLI de Claude…';
    $('#claude-estado').className = 'campo-aviso';
    const s = await window.rv.claudeSesion();
    ultima = s;
    pintarEstado(s);
    pintarModelos(s.modelos, elegido);
    return s;
}

export function wire(alCambiar) {
    $('#claude-comprobar').addEventListener('click', async () => {
        await pintar($('#llm-modelo').value);
    });

    $('#claude-salir').addEventListener('click', async () => {
        const r = await window.rv.claudeSalir();
        if (!r.ok) {
            $('#claude-estado').textContent = r.error;
            $('#claude-estado').className = 'campo-aviso is-mal';
            return;
        }
        avisar('Sesión de Claude cerrada. Para volver a entrar: claude auth login');
        await pintar($('#llm-modelo').value);
        // El que cerró sesión probablemente quiera volver a lo local, pero
        // decidirlo por él sería cambiarle un ajuste que no tocó. Se le avisa y
        // se deja el proveedor como está: el botón de mejorar va a explicar qué
        // falta, que es lo que tiene que hacer igual.
        if (typeof alCambiar === 'function') alCambiar();
    });
}
