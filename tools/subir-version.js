#!/usr/bin/env node
'use strict';
/**
 * tools/subir-version.js — Sube la versión de la app en los dos archivos donde
 * vive, de una sola corrida.
 *
 *   node tools/subir-version.js          # 0.1.0 -> 0.1.1
 *   node tools/subir-version.js minor    # 0.1.7 -> 0.2.0
 *   node tools/subir-version.js major    # 0.2.3 -> 1.0.0
 *   node tools/subir-version.js --en /tmp/copia   (para probar sin tocar el repo)
 *
 * El número está duplicado porque lo leen dos cosas distintas y en dos momentos
 * distintos: `version.json` es un archivo chico que va adentro del `.pkg` y que
 * la app abre en runtime para escribir la versión en la barra de arriba, y
 * `package.json` es el que mira electron-builder para nombrar el instalador y
 * armar el bundle. No se puede dejar uno solo: la app no debería tener que
 * parsear el package entero para mostrar tres dígitos, y electron-builder no
 * sabe leer otra cosa.
 *
 * Lo que sí se puede es no moverlos a mano. Desincronizados no rompen nada
 * ruidoso: el instalador se llama `Reviewer-0.1.4` y la ventana dice `0.1.2`, y
 * eso recién se descubre cuando alguien reporta un bug contra un número de
 * versión que no existió nunca. Por eso un solo comando mueve los dos, y por eso
 * `tests/modulos.test.js` falla si alguna vez quedan distintos.
 *
 * El valor se reemplaza sobre el texto crudo en vez de parsear y volver a
 * serializar: `JSON.stringify` reordena nada pero sí reformatea —y el
 * `package.json` lo leen humanos y electron-builder, así que el diff de subir un
 * patch tiene que ser una línea y no el archivo entero—.
 */

const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ARCHIVOS = ['package.json', 'version.json'];
const NIVELES = ['major', 'minor', 'patch'];

const FORMA = /^(\d+)\.(\d+)\.(\d+)$/;

/**
 * El número que sigue. Subir `minor` pone el patch en 0 y subir `major` pone
 * los dos en 0: 0.1.7 + minor es 0.2.0 y no 0.2.7, que es lo que sale de sumar
 * sin limpiar lo de abajo.
 */
function siguiente(version, nivel = 'patch') {
    if (!NIVELES.includes(nivel)) {
        throw new Error(`Nivel desconocido «${nivel}»: esperaba ${NIVELES.join(', ')}`);
    }
    const partes = FORMA.exec(String(version).trim());
    if (!partes) {
        throw new Error(`La versión «${version}» no tiene la forma x.y.z`);
    }
    const [mayor, menor, parche] = partes.slice(1).map(Number);
    if (nivel === 'major') return `${mayor + 1}.0.0`;
    if (nivel === 'minor') return `${mayor}.${menor + 1}.0`;
    return `${mayor}.${menor}.${parche + 1}`;
}

/** La clave, con su prefijo aparte para poder devolver el texto como estaba. */
const CLAVE = /("version"\s*:\s*")([^"]*)(")/g;

/**
 * Exige que la clave `"version"` aparezca una sola vez: con dos no hay forma de
 * saber cuál es la de la app, y con cero el archivo no es el que se esperaba. En
 * los dos casos es mejor cortar acá que escribir el archivo equivocado.
 */
function version(texto) {
    const encontradas = [...texto.matchAll(CLAVE)];
    if (encontradas.length !== 1) {
        throw new Error(`Esperaba una sola clave "version" y encontré ${encontradas.length}`);
    }
    return encontradas[0][2];
}

/**
 * Deja la clave `"version"` apuntando a otro número sin tocar una coma de lo
 * demás: el orden de las claves, la indentación y el salto final quedan como
 * estaban porque el archivo nunca se vuelve a serializar, solo se le cambian
 * los dígitos de adentro de las comillas.
 */
function reemplazar(texto, nueva) {
    version(texto);
    return texto.replace(CLAVE, (_, antes, vieja, despues) => `${antes}${nueva}${despues}`);
}

/**
 * Sube la versión en los dos archivos de `raiz`.
 *
 * Primero lee y valida los dos, después calcula los dos textos nuevos, y recién
 * entonces escribe. Es el mismo criterio que `writeAtomic` en
 * `engine/workspace.js`, por el mismo motivo y en un orden más estricto: acá no
 * alcanza con que cada archivo quede entero, porque un `package.json` nuevo al
 * lado de un `version.json` viejo es justo el estado que este script existe
 * para que no pase. Si el segundo archivo va a fallar —porque no está, porque
 * no es JSON o porque su versión está mal escrita— falla antes de que el
 * primero se haya movido.
 */
function subir(nivel = 'patch', raiz = RAIZ) {
    const leidos = ARCHIVOS.map(nombre => {
        const ruta = path.join(raiz, nombre);
        if (!fs.existsSync(ruta)) throw new Error(`No encontré ${ruta}`);
        return { nombre, ruta, texto: fs.readFileSync(ruta, 'utf8') };
    });

    const actuales = leidos.map(a => version(a.texto));
    const [primera] = actuales;
    for (let i = 1; i < actuales.length; i++) {
        if (actuales[i] !== primera) {
            throw new Error(
                `Los archivos ya están desfasados: ${leidos[0].nombre} dice ${primera} y ` +
                `${leidos[i].nombre} dice ${actuales[i]}. Igualalos a mano antes de subir.`
            );
        }
    }

    const nueva = siguiente(primera, nivel);
    const escribir = leidos.map(a => ({ ...a, nuevo: reemplazar(a.texto, nueva) }));

    // Los temporales van todos antes que los renames: lo que puede fallar
    // —espacio, permisos— falla escribiendo, y los renames son lo instantáneo.
    const temporales = escribir.map(a => {
        const tmp = `${a.ruta}.tmp-${process.pid}-${Date.now()}`;
        fs.writeFileSync(tmp, a.nuevo);
        return { tmp, destino: a.ruta };
    });
    for (const { tmp, destino } of temporales) fs.renameSync(tmp, destino);

    return { anterior: primera, nueva, archivos: ARCHIVOS };
}

function main() {
    const args = process.argv.slice(2);
    let raiz = RAIZ;
    let nivel = 'patch';

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--en') {
            raiz = args[++i];
            if (!raiz) throw new Error('--en necesita una carpeta');
            continue;
        }
        nivel = args[i];
    }

    const { anterior, nueva, archivos } = subir(nivel, raiz);
    console.log(`${anterior} -> ${nueva}  (${archivos.join(' y ')})`);
}

if (require.main === module) {
    try {
        main();
    } catch (err) {
        console.error(`No subí la versión: ${err.message}`);
        process.exit(1);
    }
}

module.exports = { siguiente, version, reemplazar, subir, NIVELES };
