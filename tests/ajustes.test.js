'use strict';
/**
 * El saneado de los ajustes: que un archivo roto o escrito a mano no pueda
 * dejar la app sin arrancar ni mandarle una consulta a un servidor inventado.
 */

const ajustes = require('../engine/ajustes');

module.exports = function (t) {
    t.grupo('Ajustes');

    t.test('sin archivo, todo lo de fábrica', () => {
        const a = ajustes.sanear(null);
        t.eq(a.llm.proveedor, 'ollama');
        t.eq(a.llm.ollama.url, 'http://localhost:11434');
        t.eq(a.dictado.refinar, true);
        t.deep(a.carpetasRecientes, []);
    });

    t.test('un proveedor inventado vuelve al de fábrica', () => {
        t.eq(ajustes.sanear({ llm: { proveedor: 'magia' } }).llm.proveedor, 'ollama');
    });

    t.test('la configuración del transporte apagado se conserva', () => {
        // Probar LM Studio y volver a Ollama no puede hacerte reescribir el
        // modelo que ya tenías elegido.
        const a = ajustes.sanear({
            llm: {
                proveedor: 'ollama',
                ollama: { modelo: 'qwen3:8b' },
                openai: { url: 'http://localhost:1234/v1', modelo: 'mistral' }
            }
        });
        t.eq(a.llm.openai.modelo, 'mistral');
    });

    t.test('las carpetas recientes no se repiten y tienen tope', () => {
        const muchas = Array.from({ length: 20 }, (x, i) => `/ruta/${i}`);
        const a = ajustes.sanear({ carpetasRecientes: [...muchas, '/ruta/0'] });
        t.eq(a.carpetasRecientes.length, ajustes.RECIENTES);
        t.eq(a.carpetasRecientes[0], '/ruta/0');
    });

    t.test('la basura en la lista se descarta', () => {
        t.deep(ajustes.sanear({ carpetasRecientes: [null, 3, '', '/bien'] }).carpetasRecientes, ['/bien']);
    });

    t.test('el transporte activo sale aplanado para el cliente', () => {
        const a = ajustes.sanear({
            llm: { proveedor: 'openai', openai: { url: 'http://x/v1', modelo: 'm', apiKey: 'k' } }
        });
        t.deep(ajustes.llmActivo(a), { proveedor: 'openai', url: 'http://x/v1', modelo: 'm', apiKey: 'k' });
    });

    t.test('el idioma del dictado tiene un valor siempre', () => {
        t.eq(ajustes.sanear({ dictado: { idioma: '   ' } }).dictado.idioma, 'es');
    });
};
