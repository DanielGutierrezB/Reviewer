'use strict';
/**
 * cdp.js — Hablarle a la ventana desde afuera mientras la app corre.
 *
 * Solo para desarrollo. Con `npm run dev` la app abre el puerto 9222 y esto se
 * conecta ahí para evaluar algo adentro de la ventana y ver qué contesta —o
 * qué excepción tira, que es lo que más sirve: un error en un `addEventListener`
 * no se ve en ningún lado, la app simplemente deja de responder a ese botón—.
 *
 *   node tools/cdp.js "document.querySelectorAll('.comentario').length"
 *   node tools/cdp.js --errores
 */

const http = require('http');
const { WebSocket } = require('ws');

/**
 * El puerto, con `REVIEWER_CDP` para apuntar a otra instancia.
 *
 * Hace falta desde que puede haber dos Reviewer abiertos a la vez —uno que el
 * editor está usando con el iPad y otro que alguien levantó para probar algo—.
 * Sin esto, esta herramienta siempre habla con el 9222 y un `pkill` o una
 * prueba a ciegas se lleva puesta la sesión del otro.
 */
const PUERTO = Number(process.env.REVIEWER_CDP) || 9222;

function pedir(ruta) {
    return new Promise((resolve, reject) => {
        http.get({ host: '127.0.0.1', port: PUERTO, path: ruta }, res => {
            let cuerpo = '';
            res.on('data', d => { cuerpo += d; });
            res.on('end', () => {
                try { resolve(JSON.parse(cuerpo)); } catch (e) { reject(e); }
            });
        }).on('error', reject);
    });
}

async function main() {
    const expresion = process.argv.slice(2).join(' ');
    const paginas = (await pedir('/json/list')).filter(p => p.type === 'page');
    if (!paginas.length) throw new Error('No hay ninguna ventana abierta en el 9222.');

    for (const pagina of paginas) {
        const ws = new WebSocket(pagina.webSocketDebuggerUrl);
        const quien = pagina.url.split('/').pop();
        await new Promise(listo => ws.on('open', listo));

        const errores = [];
        ws.on('message', crudo => {
            const m = JSON.parse(crudo);
            if (m.method === 'Runtime.exceptionThrown') {
                const d = m.params.exceptionDetails;
                errores.push(`${d.text} ${(d.exception || {}).description || ''}`.trim());
            }
            if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
                errores.push(m.params.args.map(a => a.value || a.description).join(' '));
            }
        });

        ws.send(JSON.stringify({ id: 1, method: 'Runtime.enable' }));
        await new Promise(r => setTimeout(r, 400));

        if (expresion && expresion !== '--errores') {
            const respuesta = await new Promise(resolve => {
                const escuchar = crudo => {
                    const m = JSON.parse(crudo);
                    if (m.id === 2) {
                        ws.off('message', escuchar);
                        resolve(m.result);
                    }
                };
                ws.on('message', escuchar);
                ws.send(JSON.stringify({
                    id: 2,
                    method: 'Runtime.evaluate',
                    params: { expression: expresion, returnByValue: true, awaitPromise: true }
                }));
            });
            console.log(`[${quien}]`, JSON.stringify(
                respuesta.exceptionDetails || respuesta.result.value, null, 2
            ));
        }

        if (errores.length) console.log(`[${quien}] errores:\n  ${errores.join('\n  ')}`);
        ws.close();
    }
}

main().catch(e => {
    console.error(e.message);
    process.exit(1);
});
