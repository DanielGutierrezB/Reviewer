'use strict';
/**
 * El skill de Reviewer para Claude.
 *
 * Es un documento, y los documentos mienten sin que nada falle: el código
 * cambia una frase que Claude tiene que buscar en un archivo y el skill sigue
 * diciendo la vieja. Así que acá no se prueba solo que se rellene bien; se
 * prueba que las frases que el código escribe y lee de verdad —los rótulos de
 * los adjuntos, la casilla de hecho, el formato del error del taller, los
 * nombres de carpeta— estén en el skill tal cual. Si una de estas falla, o se
 * cambió el código y hay que actualizar el skill, o al revés.
 */

const fs = require('fs');

const skill = require('../engine/skill');
const adjuntos = require('../engine/adjuntos');
const workspace = require('../engine/workspace');
const entrega = require('../engine/entrega');
const taller = require('../engine/taller');

module.exports = function (t) {
    t.grupo('El skill de Reviewer para Claude');

    const version = JSON.parse(fs.readFileSync(`${__dirname}/../version.json`, 'utf8')).version;

    t.test('la plantilla está, empaquetada, y tiene nombre y descripción', () => {
        t.ok(fs.existsSync(skill.PLANTILLA), 'skill/SKILL.md existe');
        const paquete = JSON.parse(fs.readFileSync(`${__dirname}/../package.json`, 'utf8'));
        t.ok(paquete.build.files.includes('skill/**/*'), 'viaja dentro de la app empaquetada');
        const cabecera = skill.encabezado();
        t.eq(cabecera.name, 'reviewer');
        t.ok(cabecera.description && cabecera.description.length > 40, 'con una descripción que diga cuándo usarlo');
    });

    t.test('lleva la versión de la app y la fecha, y no deja huecos', () => {
        const texto = skill.armar({ version, fecha: new Date(2026, 10, 4) });
        t.ok(texto.includes(`Reviewer v${version}`), 'el título dice la versión');
        t.ok(texto.includes('2026-11-04'), 'la fecha corta');
        t.ok(!/\{\{/.test(texto), 'ningún {{hueco}} sin rellenar');
    });

    t.test('un hueco desconocido o una versión ausente cortan en vez de salir rotos', () => {
        const falla = (fn, patron) => {
            try { fn(); } catch (e) { return patron.test(e.message); }
            return false;
        };
        t.ok(falla(() => skill.armar({ version, texto: 'hola {{cosa}}' }), /cosa/), 'un hueco que no existe se nombra');
        t.ok(falla(() => skill.armar({ version: '' }), /versión/), 'sin versión no hay skill');
    });

    t.test('las frases que el código escribe están en el skill tal cual', () => {
        const texto = skill.plantilla();
        // Los dos usos de un adjunto son lo que Claude lee en el feedback.md,
        // y el skill tiene que decirlos con las mismas palabras.
        for (const uso of Object.values(adjuntos.USOS)) {
            t.ok(texto.includes(uso.titulo), `el rótulo «${uso.titulo}» está`);
        }
        t.ok(texto.includes('- [ ] Hecho · ['), 'la casilla tal como la escribe el export');
        t.ok(texto.includes(`{${entrega.VARIABLE}}`), 'la variable de las rutas del documento');
        for (const nombre of [workspace.PREVIAS_DIR, workspace.EXPORTACION_DIR, workspace.GENERAL_DIR,
            workspace.REFERENCIAS_DIR, workspace.FRAMES_DIR, workspace.DIBUJOS_DIR, workspace.ADJUNTOS_DIR]) {
            t.ok(texto.includes(`${nombre}/`), `la carpeta ${nombre}/`);
        }
        t.ok(texto.includes(workspace.EDICION_ARCHIVO), 'el edit.json del preview');
        t.ok(texto.includes('claude-edit-preview'), 'y su marca de formato');
    });

    t.test('y las del taller, que Reviewer lee del disco', () => {
        const texto = skill.plantilla();
        for (const archivo of [taller.LATIDO, taller.PARAR, taller.COLA, taller.ESTADO, taller.LOG, `${taller.TAREAS}/`]) {
            t.ok(texto.includes(archivo), `nombra ${archivo}`);
        }
        t.ok(texto.includes(' ERROR '), 'el formato del renglón de error');
        t.ok(texto.includes(`${taller.FRESCO / 1000} s`), 'cuánto vive un latido');
        for (const etapa of taller.ETAPAS) t.ok(texto.includes(`\`${etapa}\``), `la etapa ${etapa}`);
    });
};
