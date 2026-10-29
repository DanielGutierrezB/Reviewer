'use strict';
/**
 * llm.js — Hablar con el modelo local, por los dos caminos que hay.
 *
 * Acá el modelo no decide nada: reescribe un texto que el editor ya escribió y
 * lo que vuelve pasa por `prompts.verificar` antes de tocar ningún campo. Esa
 * es toda la relación de confianza. Si el modelo no está, la app sigue andando
 * entera: se escriben los comentarios a mano, que es como se escriben igual.
 *
 * **Dos transportes y un solo contrato.** Ollama tiene su propia API y casi
 * todo lo demás —LM Studio, llama.cpp con su servidor, vLLM, un OpenRouter si
 * alguien quiere— habla el dialecto de OpenAI. Son dos funciones de veinte
 * líneas cada una y evitan la pregunta "¿por qué no puedo usar el servidor que
 * ya tengo levantado?".
 *
 * **Sin streaming.** Refinar un comentario son dos frases: el texto aparece de
 * una y no hay nada que mirar crecer. Y sin streaming el error de un modelo que
 * no existe llega como un error y no como media respuesta.
 */

const DEFAULTS = {
    // Reescribir no es inventar: cuanto más bajo, menos se aleja de lo que el
    // editor dijo. No es cero porque con cero algunos modelos chicos se quedan
    // repitiendo la última frase.
    temperatura: 0.2,
    // Un comentario refinado no puede ser más largo que un comentario. El tope
    // existe para que un modelo que se va por las ramas se corte solo en vez de
    // tener al editor dos minutos mirando un botón girar.
    maxTokens: 800,
    timeoutMs: 90000
};

function url(base, cola) {
    return `${String(base || '').replace(/\/+$/, '')}${cola}`;
}

async function pedir(destino, opciones, timeoutMs) {
    const control = new AbortController();
    const reloj = setTimeout(() => control.abort(), timeoutMs || DEFAULTS.timeoutMs);
    try {
        const r = await fetch(destino, { ...opciones, signal: control.signal });
        const cuerpo = await r.text();
        if (!r.ok) {
            // El cuerpo del error dice lo único útil ("model not found"), así
            // que viaja recortado en vez de un "500" pelado.
            throw new Error(`${r.status} ${cuerpo.slice(0, 300).trim() || r.statusText}`);
        }
        return JSON.parse(cuerpo);
    } catch (e) {
        if (e.name === 'AbortError') throw new Error('El modelo tardó demasiado y se cortó la consulta.');
        if (e instanceof SyntaxError) throw new Error('El servidor contestó algo que no es JSON.');
        throw e;
    } finally {
        clearTimeout(reloj);
    }
}

/** Los modelos que tiene instalados ese servidor, para el selector de Ajustes. */
async function modelos(config) {
    const c = config || {};
    if (c.proveedor === 'openai') {
        const data = await pedir(url(c.url, '/models'), {
            headers: c.apiKey ? { Authorization: `Bearer ${c.apiKey}` } : {}
        }, 15000);
        return (data.data || []).map(m => m.id).filter(Boolean).sort();
    }
    const data = await pedir(url(c.url, '/api/tags'), {}, 15000);
    return (data.models || []).map(m => m.name).filter(Boolean).sort();
}

/**
 * Una consulta. Devuelve el texto y nada más.
 *
 * @param {object} config `{ proveedor, url, modelo, apiKey }`
 * @param {{sistema:string, usuario:string}} mensajes
 */
async function preguntar(config, mensajes, opciones) {
    const c = config || {};
    const o = { ...DEFAULTS, ...(opciones || {}) };
    if (!c.modelo) throw new Error('No hay modelo elegido en Ajustes.');

    const messages = [
        { role: 'system', content: mensajes.sistema },
        { role: 'user', content: mensajes.usuario }
    ];

    const empezo = Date.now();

    if (c.proveedor === 'openai') {
        const data = await pedir(url(c.url, '/chat/completions'), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(c.apiKey ? { Authorization: `Bearer ${c.apiKey}` } : {})
            },
            body: JSON.stringify({
                model: c.modelo,
                messages,
                temperature: o.temperatura,
                max_tokens: o.maxTokens,
                stream: false
            })
        }, o.timeoutMs);
        const texto = ((data.choices || [])[0] || {}).message || {};
        return { texto: String(texto.content || ''), modelo: c.modelo, ms: Date.now() - empezo };
    }

    const data = await pedir(url(c.url, '/api/chat'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: c.modelo,
            messages,
            stream: false,
            options: {
                temperature: o.temperatura,
                num_predict: o.maxTokens,
                // La misma frase refinada dos veces tiene que dar lo mismo: sin
                // semilla, apretar ✨ dos veces es tirar el dado dos veces, y
                // el editor no puede saber si el segundo resultado es mejor o
                // es otro.
                seed: 7
            }
        })
    }, o.timeoutMs);
    return { texto: String((data.message && data.message.content) || ''), modelo: c.modelo, ms: Date.now() - empezo };
}

/**
 * ¿Está vivo el servidor y existe el modelo? Es el botón «Probar» de Ajustes.
 *
 * Pregunta de verdad en vez de mirar solo la lista: un modelo que figura
 * instalado y no entra en memoria falla recién al usarlo, que es a mitad de un
 * refinado.
 */
async function probar(config) {
    try {
        const lista = await modelos(config);
        if (!config.modelo) {
            return { ok: false, error: 'Elegí un modelo.', modelos: lista };
        }
        if (lista.length && !lista.includes(config.modelo)) {
            return { ok: false, error: `Ese servidor no tiene «${config.modelo}».`, modelos: lista };
        }
        const r = await preguntar(config, {
            sistema: 'Contestá con una sola palabra.',
            usuario: 'Decí: listo'
        }, { maxTokens: 16, timeoutMs: 60000 });
        return { ok: true, modelos: lista, ms: r.ms, dijo: r.texto.trim().slice(0, 40) };
    } catch (e) {
        return { ok: false, error: e.message, modelos: [] };
    }
}

module.exports = { DEFAULTS, modelos, preguntar, probar };
