'use strict';
/**
 * registro.js — El diario de la sesión, para cuando algo no anduvo.
 *
 * Un solo registro para el proceso principal y para la ventana, con un solo
 * reloj: si cada lado llevara el suyo, el archivo mezclaría dos ordenamientos y
 * "qué pasó primero, el clic o el proxy que disparó" dejaría de leerse.
 *
 * **No se anota el texto de ningún comentario.** Un comentario es lo que el
 * editor opina del trabajo de alguien, y este archivo se manda por chat para
 * pedir ayuda. Los tamaños y los tiempos alcanzan para diagnosticar: una consulta
 * al modelo de 4.000 caracteres que tarda 40 segundos y vuelve vacía se entiende
 * sin leer una palabra de lo que decía.
 */

const fs = require('fs');
const path = require('path');

const TOPE = 4000;

const lineas = [];
let archivo = null;
let pendientes = 0;

function stamp() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

/**
 * Una línea en el diario.
 *
 * @param {string} origen `'main'` o `'ventana'`
 * @param {string} evento clave con puntos: `app.arranca`, `proxy.arma`
 * @param {object} datos lo que se pueda contar sin contar lo que el editor escribió
 */
function anotar(origen, evento, datos) {
    const cuerpo = datos && Object.keys(datos).length
        ? ` ${Object.entries(datos).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' ')}`
        : '';
    lineas.push(`[${stamp()}] ${origen} ${evento}${cuerpo}`);
    if (lineas.length > TOPE) lineas.splice(0, lineas.length - TOPE);
    pendientes++;
    // No se escribe en cada línea: un arrastre del cabezal son veinte anotaciones
    // por segundo y abrir el archivo cada vez se nota. Pero tampoco se espera al
    // cierre, que es cuando se pierde lo interesante.
    if (pendientes >= 20) volcar();
}

/** Abre el archivo del diario. Lo primero que hace la app, antes de anotar nada. */
function abrirDiario(userData) {
    try {
        fs.mkdirSync(userData, { recursive: true });
        archivo = path.join(userData, 'reviewer.log');
        const teniamos = lineas.length;
        fs.appendFileSync(archivo, `\n=== ${new Date().toISOString()} ===\n`);
        return { ok: true, ruta: archivo, teniamos };
    } catch (e) {
        archivo = null;
        return { ok: false, error: e.message, teniamos: lineas.length };
    }
}

function volcar() {
    if (!archivo || !pendientes) return;
    const nuevas = lineas.slice(-pendientes);
    pendientes = 0;
    try {
        fs.appendFileSync(archivo, `${nuevas.join('\n')}\n`);
    } catch (e) { /* un diario que no se puede escribir no puede tumbar la app */ }
}

/** Todo lo de esta sesión, para el botón que lo descarga. */
function texto() {
    return lineas.join('\n');
}

module.exports = { anotar, abrirDiario, volcar, texto };
