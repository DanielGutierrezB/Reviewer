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

    t.test('buscar actualizaciones al arrancar viene encendido', () => {
        // Un `ajustes.json` escrito antes de que este ajuste existiera no tiene
        // la clave. Si la ausencia se leyera como "apagado", la comprobación
        // quedaría muerta justo en las instalaciones que ya están en la calle,
        // que son las únicas que tienen algo que actualizar.
        t.eq(ajustes.sanear(null).actualizaciones.alArrancar, true);
        t.eq(ajustes.sanear({ dictado: { idioma: 'es' } }).actualizaciones.alArrancar, true, 'y con un archivo viejo también');
        t.eq(ajustes.sanear({ actualizaciones: { alArrancar: false } }).actualizaciones.alArrancar, false, 'apagarla se respeta');
    });

    t.test('los paneles de los costados arrancan a la vista', () => {
        // Es la misma trampa que `alArrancar`: un `ajustes.json` de antes de que
        // esta clave existiera no la tiene, y si la ausencia se leyera como
        // «plegado», la app abriría sin la lista de clases y sin la columna de
        // comentarios en todas las instalaciones que ya están en la calle —que
        // es exactamente el estado al que se llega apretando ⌘S y ⌘E, así que
        // nada en pantalla explicaría que no fue nadie.
        t.eq(ajustes.sanear(null).paneles.clases, true);
        t.eq(ajustes.sanear(null).paneles.comentarios, true);
        t.eq(ajustes.sanear({ dictado: { idioma: 'es' } }).paneles.clases, true, 'y con un archivo viejo también');
    });

    t.test('plegar un panel se recuerda, y uno solo', () => {
        // Los dos lados son independientes: el editor que cierra las clases y
        // deja los comentarios tiene que encontrar eso mismo mañana.
        const a = ajustes.sanear({ paneles: { clases: false } });
        t.eq(a.paneles.clases, false);
        t.eq(a.paneles.comentarios, true);
    });

    t.test('cualquier cosa en paneles que no sea false deja el panel a la vista', () => {
        // Un archivo escrito a mano con `"clases": "no"` no puede dejar la app
        // abriendo con una columna de 16 px y ninguna explicación.
        t.eq(ajustes.sanear({ paneles: { clases: 'no' } }).paneles.clases, true);
        t.eq(ajustes.sanear({ paneles: null }).paneles.comentarios, true);
    });

    t.test('el idioma del dictado tiene un valor siempre', () => {
        t.eq(ajustes.sanear({ dictado: { idioma: '   ' } }).dictado.idioma, 'es');
    });

    // ─── Parchear ─────────────────────────────────────────────────────
    //
    // Es el único camino de escritura que tiene la ventana, y lo que tiene que
    // garantizar es una sola cosa: guardar algo no puede borrar otra cosa. Eso
    // era un bug latente —cinco módulos armaban el documento entero cada uno
    // sobre su copia cacheada, y dos de los cinco reemplazaban el sub-objeto
    // completo en vez de fundirlo—, así que se prueba la fusión y no solo que
    // la clave pedida haya quedado escrita.
    //
    // Se prueba `fundir` y no `parchear` porque el segundo lee y escribe el
    // archivo de verdad en `~/Library`, y ningún test puede tocar los ajustes
    // del editor que está corriendo la app. `parchear` es exactamente
    // `guardar(fundir(leer(), parcial))`, y `guardar`/`sanear`/`leer` ya tienen
    // los suyos arriba.

    t.test('parchear un panel no se lleva puesto el otro', () => {
        const base = ajustes.sanear(null);
        const salida = ajustes.sanear(ajustes.fundir(base, { paneles: { clases: false } }));
        t.eq(salida.paneles.clases, false);
        t.eq(salida.paneles.comentarios, true, 'el hermano sigue ahí');
    });

    t.test('parchear una clave no toca ningún otro grupo', () => {
        // El caso que se perdía: plegar un panel mientras se elige una pantalla.
        const antes = ajustes.sanear({
            pantalla: { destino: 'Sidecar Display (AirPlay)' },
            dictado: { microfono: 'abc123', idioma: 'en', refinar: false },
            llm: { proveedor: 'openai', openai: { url: 'http://x/v1', modelo: 'm', apiKey: 'k' } },
            carpetasRecientes: ['/renders/curso']
        });
        const salida = ajustes.sanear(ajustes.fundir(antes, { paneles: { comentarios: false } }));

        t.eq(salida.paneles.comentarios, false, 'lo pedido se escribió');
        t.eq(salida.pantalla.destino, 'Sidecar Display (AirPlay)');
        t.eq(salida.dictado.microfono, 'abc123');
        t.eq(salida.dictado.idioma, 'en');
        t.eq(salida.dictado.refinar, false);
        t.eq(salida.llm.proveedor, 'openai');
        t.eq(salida.llm.openai.modelo, 'm');
        t.deep(salida.carpetasRecientes, ['/renders/curso']);
    });

    t.test('elegir micrófono no borra el idioma ni el refinado', () => {
        const antes = ajustes.sanear({ dictado: { microfono: '', idioma: 'en', refinar: false } });
        const salida = ajustes.sanear(ajustes.fundir(antes, { dictado: { microfono: 'nuevo' } }));
        t.eq(salida.dictado.microfono, 'nuevo');
        t.eq(salida.dictado.idioma, 'en');
        t.eq(salida.dictado.refinar, false);
    });

    t.test('cambiar de transporte deja en pie la configuración de los otros', () => {
        // Lo mismo que ya probaba `sanear`, pero por el camino que usa la
        // pantalla de Ajustes: manda solo `proveedor` y el transporte activo.
        const antes = ajustes.sanear({
            llm: {
                proveedor: 'ollama',
                ollama: { modelo: 'qwen3:8b' },
                openai: { url: 'http://x/v1', modelo: 'mistral', apiKey: 'k' }
            }
        });
        const salida = ajustes.sanear(ajustes.fundir(antes, {
            llm: { proveedor: 'openai', openai: { url: 'http://y/v1', modelo: 'llama', apiKey: 'k2' } }
        }));
        t.eq(salida.llm.proveedor, 'openai');
        t.eq(salida.llm.openai.modelo, 'llama', 'el activo se reemplaza entero');
        t.eq(salida.llm.ollama.modelo, 'qwen3:8b', 'y el apagado queda como estaba');
    });

    t.test('la lista de recientes se reemplaza y no se funde', () => {
        // El orden ES el dato —primera es la última abierta—, así que fundirla
        // elemento por elemento no querría decir nada.
        const antes = ajustes.sanear({ carpetasRecientes: ['/a', '/b', '/c'] });
        const salida = ajustes.sanear(ajustes.fundir(antes, { carpetasRecientes: ['/z'] }));
        t.deep(salida.carpetasRecientes, ['/z']);
    });

    t.test('un parche vacío no cambia nada', () => {
        const base = ajustes.sanear({ pantalla: { destino: 'Odyssey G81SF' } });
        t.deep(ajustes.sanear(ajustes.fundir(base, {})), base);
        t.deep(ajustes.sanear(ajustes.fundir(base, null)), base);
    });
};
