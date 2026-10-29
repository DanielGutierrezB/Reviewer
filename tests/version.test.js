'use strict';
/**
 * Subir la versión de la app.
 *
 * El número vive duplicado en `package.json` y en `version.json`, y
 * `tests/modulos.test.js` ya falla si quedan distintos. Lo que se prueba acá es
 * lo de antes: que la cuenta esté bien y que el reemplazo no reescriba el
 * archivo entero, que son las dos formas en que `tools/subir-version.js` puede
 * romper algo sin que ningún test de los otros se entere.
 *
 * Nada de esto toca los archivos de verdad: se prueban las funciones puras
 * contra texto escrito acá adentro. Un test que subiera la versión real dejaría
 * el repo modificado cada vez que se corre la suite.
 */

const subirVersion = require('../tools/subir-version');

module.exports = function (t) {
    t.grupo('Versión');

    t.test('sin argumento sube el patch', () => {
        // Es el caso de todos los días: cada cambio que se commitea mueve este
        // dígito y ninguno de los otros dos.
        t.eq(subirVersion.siguiente('0.1.0'), '0.1.1');
        t.eq(subirVersion.siguiente('0.1.9'), '0.1.10', 'y 9 + 1 es 10, no 2.0');
    });

    t.test('el patch se cuenta como número y no como texto', () => {
        // Con concatenación en vez de suma, 0.1.9 saldría 0.1.91.
        t.eq(subirVersion.siguiente('1.2.19'), '1.2.20');
        t.eq(subirVersion.siguiente('0.9.99'), '0.9.100');
    });

    t.test('subir minor deja el patch en 0', () => {
        // Sumar sin limpiar lo de abajo daría 0.2.7, que se lee como si la
        // 0.2 hubiera tenido siete arreglos antes de existir.
        t.eq(subirVersion.siguiente('0.1.7', 'minor'), '0.2.0');
    });

    t.test('subir major deja minor y patch en 0', () => {
        t.eq(subirVersion.siguiente('0.2.3', 'major'), '1.0.0');
        t.eq(subirVersion.siguiente('1.4.9', 'major'), '2.0.0');
    });

    t.test('una versión mal escrita corta con un mensaje que dice cuál', () => {
        // El script escribe dos archivos: si la versión de entrada no se
        // entiende tiene que fallar ANTES de tocar ninguno, y el error tiene que
        // nombrar el valor para no obligar a abrir los dos JSON a ver cuál era.
        const malas = ['0.1', '1.2.3.4', 'v0.1.0', '0.1.x', '', '0.1.0-beta'];
        for (const mala of malas) {
            let error = null;
            try { subirVersion.siguiente(mala); } catch (e) { error = e; }
            t.ok(error, `«${mala}» no pasa`);
            t.tiene(error.message, 'x.y.z', 'y el mensaje dice qué forma esperaba');
            t.tiene(error.message, mala, 'nombrando el valor que llegó');
        }
    });

    t.test('un nivel que no existe no se trata como patch', () => {
        // Un `node tools/subir-version.js mayor` —en español, sin querer— no
        // puede subir el patch calladamente y hacer creer que subió el major.
        let error = null;
        try { subirVersion.siguiente('0.1.0', 'mayor'); } catch (e) { error = e; }
        t.ok(error, 'corta');
        t.tiene(error.message, 'mayor');
        t.tiene(error.message, 'patch', 'y lista los niveles que sí valen');
    });

    t.test('el reemplazo no mueve el orden de las claves ni la indentación', () => {
        // Parsear y volver a serializar sería más corto, pero el diff de subir
        // un patch tiene que ser una línea: el `package.json` lo leen personas.
        const antes = [
            '{',
            '  "name": "reviewer",',
            '  "version": "0.1.0",',
            '  "main": "main.js"',
            '}',
            ''
        ].join('\n');

        const despues = subirVersion.reemplazar(antes, '0.1.1');

        t.eq(despues, antes.replace('0.1.0', '0.1.1'), 'cambió exactamente eso y nada más');
        t.tiene(despues, '\n  "version"', 'sigue con dos espacios de indentación');
        t.ok(despues.endsWith('}\n'), 'y con el salto de línea final');
    });

    t.test('no confunde el ${version} del artifactName con la clave', () => {
        // `package.json` nombra el instalador con `Reviewer-${version}`. Un
        // reemplazo que buscara la palabra «version» a secas pisaría eso y
        // electron-builder armaría un .pkg con el nombre literal adentro.
        const pkg = [
            '{',
            '  "version": "0.1.0",',
            '  "build": {',
            '    "pkg": { "artifactName": "Reviewer-${version}-arm64.${ext}" }',
            '  }',
            '}',
            ''
        ].join('\n');

        const despues = subirVersion.reemplazar(pkg, '0.1.1');

        t.tiene(despues, '"version": "0.1.1"');
        t.tiene(despues, 'Reviewer-${version}-arm64', 'el nombre del artefacto quedó intacto');
    });

    t.test('un JSON sin la clave version no se escribe a ciegas', () => {
        // Si el archivo no es el que se esperaba, agregarle la clave o dejarlo
        // igual son las dos peores salidas: la app seguiría mostrando el número
        // viejo sin que nada se queje.
        let error = null;
        try { subirVersion.reemplazar('{\n  "name": "reviewer"\n}\n', '0.1.1'); } catch (e) { error = e; }
        t.ok(error, 'corta');
        t.tiene(error.message, 'encontré 0');
    });

    t.test('lee la versión que está escrita en el texto', () => {
        t.eq(subirVersion.version('{\n  "version": "2.5.9"\n}\n'), '2.5.9');
    });
};
