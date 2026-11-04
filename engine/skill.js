'use strict';
/**
 * skill.js — El skill de Reviewer para Claude: lo que Claude tiene que saber
 * para trabajar con esta app, exportable desde la app misma.
 *
 * El texto vive en `skill/SKILL.md`, en el repo, y viaja adentro de la app
 * empaquetada. No es casualidad que esté acá y no en la carpeta de un curso:
 * cada cosa que la app empieza a hacer —leer casillas, renderizar, mostrar
 * errores del taller— cambia lo que Claude tiene que saber, y la única forma
 * de que ese texto no quede atrás es que se versione con el código que
 * describe. Por eso lleva la versión de la app adentro: un skill exportado de
 * la 0.1.12 dice 0.1.12, y si el editor actualiza, exporta otro.
 *
 * Lo que hace este archivo es poco a propósito: leer la plantilla y rellenar
 * los dos huecos. Escribirlo a disco, elegir dónde y mostrarlo en el Finder
 * es de `main/skill.js`, que es el que puede tocar el sistema.
 */

const fs = require('fs');
const path = require('path');

/** Dónde está la plantilla, tanto en el repo como dentro del `.app`. */
const PLANTILLA = path.join(__dirname, '..', 'skill', 'SKILL.md');

/** Cómo se llama el archivo exportado: el nombre que esperan los skills de Claude. */
const ARCHIVO = 'SKILL.md';

/** Los huecos que la plantilla puede traer y con qué se rellenan. */
const HUECOS = ['version', 'fecha'];

function plantilla() {
    return fs.readFileSync(PLANTILLA, 'utf8');
}

/** `2026-11-04`: la fecha sin hora ni zona, que es lo que se lee en un documento. */
function fechaCorta(fecha) {
    const d = fecha instanceof Date ? fecha : new Date(fecha);
    const dos = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
}

/**
 * El skill listo para escribir.
 *
 * Falla si queda un hueco sin rellenar: un `{{version}}` que llega a Claude
 * tal cual no es un detalle cosmético, es un skill que dice que no sabe de
 * qué versión habla, y eso se descubre acá y no leyéndolo.
 *
 * @param {{version: string, fecha?: Date|string|number, texto?: string}} de
 */
function armar({ version, fecha = new Date(), texto = plantilla() }) {
    if (!version) throw new Error('El skill necesita la versión de la app.');
    const valores = { version, fecha: fechaCorta(fecha) };
    const salida = texto.replace(/\{\{\s*([a-z]+)\s*\}\}/g, (todo, nombre) => {
        if (!HUECOS.includes(nombre)) throw new Error(`La plantilla del skill tiene un hueco que no se conoce: ${todo}`);
        return valores[nombre];
    });
    return salida;
}

/**
 * El `name` y la `description` del encabezado, que es lo que Claude lista.
 *
 * Se leen para que los tests y la ventana puedan decir qué se va a exportar
 * sin reinterpretar el YAML: dos líneas `clave: valor` entre dos `---`.
 */
function encabezado(texto = plantilla()) {
    const m = /^---\n([\s\S]*?)\n---/.exec(texto);
    if (!m) return null;
    const campos = {};
    for (const linea of m[1].split('\n')) {
        const i = linea.indexOf(':');
        if (i > 0) campos[linea.slice(0, i).trim()] = linea.slice(i + 1).trim();
    }
    return campos;
}

module.exports = { PLANTILLA, ARCHIVO, HUECOS, plantilla, armar, encabezado, fechaCorta };
