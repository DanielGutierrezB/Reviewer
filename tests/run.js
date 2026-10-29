'use strict';
/**
 * tests/run.js — Corredor sin dependencias, sin red y sin abrir la app. Cada
 * archivo `*.test.js` exporta una función que recibe el arnés.
 *
 *   node tests/run.js
 *   node tests/run.js feedback   (solo los que matcheen)
 */

const fs = require('fs');
const path = require('path');

const FILES = [
    'versiones.test.js',
    'tiempo.test.js',
    'formato.test.js',
    'menciones.test.js',
    'feedback.test.js',
    'comentarios.test.js',
    'frames.test.js',
    'general.test.js',
    'referencias.test.js',
    'proxy.test.js',
    'refinar.test.js',
    'media-server.test.js',
    'ajustes.test.js',
    'dictado.test.js',
    'modulos.test.js'
];

const filtro = process.argv[2] || '';
const estado = { pasaron: 0, fallaron: 0, salteados: 0, fallos: [] };
let grupoActual = '';

function igualEnProfundidad(a, b) {
    if (a === b) return true;
    if (typeof a !== typeof b) return false;
    if (a === null || b === null) return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (typeof a !== 'object') return false;
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every(k => igualEnProfundidad(a[k], b[k]));
}

function mostrar(valor) {
    if (typeof valor === 'string') return JSON.stringify(valor);
    try { return JSON.stringify(valor); } catch (e) { return String(valor); }
}

// Los tests se registran al recorrer los archivos y se corren después, en orden.
// Es lo que permite esperar a los `async` sin escribir `await t.test` en cada
// archivo: si no se esperara, la promesa se resolvería pasado el resumen y el
// test contaría como pasado aunque su aserción fallara.
const cola = [];

const t = {
    grupo(nombre) {
        grupoActual = nombre;
        cola.push({ tipo: 'grupo', nombre });
    },

    test(nombre, fn) {
        cola.push({ tipo: 'test', grupo: grupoActual, nombre, fn });
    },

    saltear(nombre, porque) {
        cola.push({ tipo: 'saltear', nombre, porque });
    },

    ok(valor, mensaje) {
        if (!valor) throw new Error(mensaje || `esperaba algo verdadero, llegó ${mostrar(valor)}`);
    },

    eq(actual, esperado, mensaje) {
        if (actual !== esperado) {
            throw new Error(`${mensaje || 'no coincide'}: esperaba ${mostrar(esperado)}, llegó ${mostrar(actual)}`);
        }
    },

    deep(actual, esperado, mensaje) {
        if (!igualEnProfundidad(actual, esperado)) {
            throw new Error(`${mensaje || 'no coincide'}: esperaba ${mostrar(esperado)}, llegó ${mostrar(actual)}`);
        }
    },

    cerca(actual, esperado, tolerancia, mensaje) {
        if (Math.abs(actual - esperado) > tolerancia) {
            throw new Error(`${mensaje || 'fuera de tolerancia'}: esperaba ${esperado}±${tolerancia}, llegó ${actual}`);
        }
    },

    tiene(texto, trozo, mensaje) {
        if (!String(texto).includes(trozo)) {
            throw new Error(`${mensaje || 'falta'}: no está ${mostrar(trozo)} en el texto`);
        }
    },

    noTiene(texto, trozo, mensaje) {
        if (String(texto).includes(trozo)) {
            throw new Error(`${mensaje || 'sobra'}: no debería estar ${mostrar(trozo)}`);
        }
    }
};

async function main() {
    // Antes y no después: si una corrida se cayó a la mitad, lo que dejó
    // adentro sigue estando para mirarlo, y recién la siguiente lo tira.
    require('./lib/temporal').limpiar();

    for (const file of FILES) {
        if (filtro && !file.includes(filtro)) continue;
        const completo = path.join(__dirname, file);
        if (!fs.existsSync(completo)) continue;
        await require(completo)(t);
    }

    for (const item of cola) {
        if (item.tipo === 'grupo') {
            console.log(`\n${item.nombre}`);
            continue;
        }
        if (item.tipo === 'saltear') {
            estado.salteados++;
            console.log(`  – ${item.nombre} (${item.porque})`);
            continue;
        }
        try {
            await item.fn();
            estado.pasaron++;
            console.log(`  ✓ ${item.nombre}`);
        } catch (err) {
            estado.fallaron++;
            estado.fallos.push({ grupo: item.grupo, nombre: item.nombre, mensaje: err.message });
            console.log(`  ✗ ${item.nombre}\n      ${err.message}`);
        }
    }

    console.log(`\n${estado.pasaron} pasaron · ${estado.fallaron} fallaron · ${estado.salteados} salteados`);
    if (estado.fallaron) {
        console.log('\nFallos:');
        for (const f of estado.fallos) console.log(`  ${f.grupo} → ${f.nombre}\n    ${f.mensaje}`);
        process.exit(1);
    }
}

main().catch(err => {
    console.error(`\nEl corredor se cayó: ${err && err.stack ? err.stack : err}`);
    process.exit(1);
});
