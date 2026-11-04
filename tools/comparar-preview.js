'use strict';
/**
 * comparar-preview.js — ¿El preview se ve igual que el render?
 *
 * Es la única forma honesta de contestar esa pregunta. El preview compone la
 * clase en vivo a partir de los proxies; el render es el archivo que salió del
 * exportador de Claude. Que los dos "se vean bien" no alcanza: la diferencia
 * que importa —una máscara corrida seis píxeles, un zoom que llega un cuadro
 * tarde, un desenfoque que no tapa del todo una clave de API— es exactamente
 * la que no se nota mirando.
 *
 * Así que se miden. Se abre la app de verdad, se la lleva al cuadro exacto, se
 * saca el PNG del canvas, se saca el mismo cuadro del render con ffmpeg y se
 * comparan con PSNR y SSIM.
 *
 *   node tools/comparar-preview.js "/ruta/a/Clase prueba"
 *   node tools/comparar-preview.js "/ruta" --vecinos
 *   node tools/comparar-preview.js "/ruta" --fijar base.json   ← guardar referencia
 *   node tools/comparar-preview.js "/ruta" --base base.json    ← comparar contra ella
 *
 * ## Qué significan los números, que no es obvio
 *
 * La igualdad perfecta no existe ni se busca: el proxy de cámara es 720p
 * recomprimido y el render es 1080p. Lo que hay que distinguir es la
 * diferencia de COMPRESIÓN de la de COMPOSICIÓN. Medido sobre esta clase:
 *
 * - Una capa que falta —el overlay de pausa sin dibujar— da 0.51 de SSIM y
 *   7 dB de PSNR. Eso lo caza cualquier umbral.
 * - Una capa que SOBRA —la escena anterior pintada encima de un shot de
 *   pantalla— costaba 12 dB: 34 contra 22. El SSIM apenas se movió, de 0.967
 *   a 0.942, porque el cartel que sobraba caía sobre una zona oscura.
 * - La caja del profesor corrida SEIS píxeles, en un cuadro por lo demás
 *   idéntico, baja el PSNR de 32.9 a 22.6 dB: diez decibelios. El SSIM
 *   también apenas se mueve, de 0.886 a 0.835.
 * - Un cuadro bien compuesto da entre 26 y 37 dB, según cuánto haya que
 *   agrandar: `CAM_MED` estira 896x504 del proxy hasta 1920x1080 y es el que
 *   más pierde; una pantalla, que va uno a uno, es el que menos.
 *
 * Las dos cosas que hay que sacar de ahí: **el SSIM es mal detector** —se
 * queda casi quieto ante errores que se ven de lejos— y **el valor absoluto
 * del PSNR depende del contenido**, así que tampoco sirve como umbral fino.
 * Lo que sí sirve es comparar cada instante contra sí mismo en otra corrida,
 * que es para lo que están `--fijar` y `--base`.
 *
 * El umbral absoluto que queda es flojo a propósito: está para cazar lo que
 * se rompió del todo, no para firmar que está perfecto. Eso lo firma el ojo
 * mirando los PNG, una vez, y después lo cuida la referencia.
 */

const { spawn, execFile } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const { WebSocket } = require('ws');

const electron = require('electron');

const edicionLib = require('../engine/edicion');
const paths = require('../engine/paths');

/** Los siete instantes de la prueba de aceptación del formato. */
const TIEMPOS = [3.52, 13.97, 25.43, 29.33, 63.68, 368.70, 514.00];

/**
 * El piso absoluto: debajo de esto hay una capa rota, no compresión.
 *
 * Calibrado entre el peor cuadro BIEN compuesto que se midió (0.874 de SSIM y
 * 26.5 dB) y el peor cuadro ROTO (0.51 y 7.1 dB). Queda lejos de los dos a
 * propósito: es la red que caza lo que se rompió del todo, y lo fino lo caza
 * la referencia.
 */
const SSIM_MINIMO = 0.80;
const PSNR_MINIMO = 18;

/**
 * Cuánto puede empeorar un instante respecto de la referencia antes de gritar.
 *
 * Medio decibelio es más que el ruido entre dos corridas —el reescalado y la
 * decodificación son deterministas, así que la repetición da el mismo número—
 * y mucho menos que los diez que cuesta correr una capa seis píxeles.
 */
const CAIDA_MAXIMA = 0.5;

function argumento(nombre, porDefecto) {
    const i = process.argv.indexOf(`--${nombre}`);
    return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : porDefecto;
}

const tiene = nombre => process.argv.includes(`--${nombre}`);

function correr(bin, args) {
    return new Promise((resolve, reject) => {
        execFile(bin, args, { maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
            if (err) reject(new Error(`${path.basename(bin)}: ${stderr || err.message}`));
            else resolve({ stdout, stderr });
        });
    });
}

// ─── Hablar con la ventana ────────────────────────────────────────────

function esperar(ms) {
    return new Promise(r => setTimeout(r, ms));
}

async function targets(puerto) {
    return new Promise((resolve, reject) => {
        http.get({ host: '127.0.0.1', port: puerto, path: '/json/list' }, res => {
            let cuerpo = '';
            res.on('data', d => { cuerpo += d; });
            res.on('end', () => { try { resolve(JSON.parse(cuerpo)); } catch (e) { reject(e); } });
        }).on('error', reject);
    });
}

/**
 * Una sesión de CDP contra la ventana, con `evaluar` que espera promesas.
 *
 * Es una copia chica de lo que hace `tools/cdp.js`, y es a propósito: aquella
 * es una herramienta de una sola evaluación desde la terminal, esta necesita
 * mantener la conexión abierta entre un seek y el siguiente.
 */
async function conectar(puerto) {
    let pagina = null;
    for (let i = 0; i < 40 && !pagina; i++) {
        try {
            pagina = (await targets(puerto)).find(p => p.type === 'page' && p.url.includes('index.html'));
        } catch (e) { /* todavía no levantó */ }
        if (!pagina) await esperar(400);
    }
    if (!pagina) throw new Error(`No hay ninguna ventana de Reviewer escuchando en el ${puerto}.`);

    const ws = new WebSocket(pagina.webSocketDebuggerUrl);
    await new Promise((listo, mal) => { ws.on('open', listo); ws.on('error', mal); });

    let id = 0;
    function evaluar(expresion) {
        const mio = ++id;
        return new Promise((resolve, reject) => {
            const oir = crudo => {
                const m = JSON.parse(crudo);
                if (m.id !== mio) return;
                ws.off('message', oir);
                if (m.result.exceptionDetails) {
                    const d = m.result.exceptionDetails;
                    reject(new Error((d.exception && d.exception.description) || d.text));
                } else {
                    resolve(m.result.result.value);
                }
            };
            ws.on('message', oir);
            ws.send(JSON.stringify({
                id: mio,
                method: 'Runtime.evaluate',
                params: { expression: expresion, returnByValue: true, awaitPromise: true }
            }));
        });
    }

    return { evaluar, cerrar: () => ws.close() };
}

/**
 * Levanta una instancia propia de la app.
 *
 * Propia y en un puerto propio: el editor puede tener la suya abierta con una
 * revisión a medias, y esta herramienta abre carpetas y mueve el cabezal. Se
 * cierra solo la que se abrió, por su pid.
 */
function levantar(puerto) {
    const log = fs.openSync(path.join(os.tmpdir(), 'comparar-preview.log'), 'w');
    const hijo = spawn(electron, ['.', '--dev', `--remote-debugging-port=${puerto}`], {
        cwd: path.resolve(__dirname, '..'),
        detached: true,
        stdio: ['ignore', log, log]
    });
    hijo.unref();
    return hijo;
}

// ─── Lo que se le pide a la ventana ───────────────────────────────────

/**
 * Deja la carpeta en la lista de recientes y averigua de qué clase es la
 * edición.
 *
 * Se le pasa la carpeta DE LA EDICIÓN y se abre su madre: así la edición entra
 * por el mismo camino que usa el editor —el escaneo la encuentra como una
 * versión más de su clase— en vez de por una puerta de servicio que podría
 * funcionar cuando la de verdad no.
 */
const GUION_PREPARAR = carpeta => `
(async () => {
  const r = await window.rv.abrirCarpeta(${JSON.stringify(path.dirname(carpeta))});
  if (!r.ok) return { error: r.error };
  const objetivo = ${JSON.stringify(path.join(carpeta, edicionLib.ARCHIVO))};
  const clase = r.clases.find(c => c.versiones.some(v => v.ruta === objetivo));
  if (!clase) return { error: 'Esa carpeta no se leyó como una edición.' };
  return { ok: true, clase: clase.nombre };
})()`;

/**
 * Abre la clase desde la interfaz y espera a que el motor conteste.
 *
 * Por la interfaz y no llamando a la función de adentro: lo que hay que
 * comprobar es el camino que recorre el editor. Una comparación que pasara por
 * otro lado podría dar verde con la apertura de verdad rota.
 */
const GUION_ABRIR = (raiz, nombreClase) => `
(async () => {
  const esperar = ms => new Promise(r => setTimeout(r, ms));
  const rep = await import('./js/reproductor.js');
  const reciente = [...document.querySelectorAll('.reciente')]
      .find(b => b.title === ${JSON.stringify(raiz)});
  if (!reciente) return { error: 'La carpeta no quedó en la lista de recientes.' };
  reciente.click();

  for (let i = 0; i < 40; i++) {
    const clase = [...document.querySelectorAll('.clase')].find(b => b.title.startsWith(${JSON.stringify(nombreClase)}));
    if (clase) { clase.click(); break; }
    await esperar(250);
  }
  for (let i = 0; i < 120; i++) {
    if (rep.motorActual()) return { ok: true };
    await esperar(500);
  }
  return { error: 'El preview no abrió en un minuto.' };
})()`;

const GUION_CUADRO = t => `
(async () => {
  const rep = await import('./js/reproductor.js');
  const m = rep.motorActual();
  if (!m) return { error: 'No hay ninguna edición abierta.' };
  const d = await m.irExacto(${t});
  return {
    png: m.canvas.toDataURL('image/png'),
    shot: d.shot.i, layout: d.shot.layout, f: d.f
  };
})()`;

// ─── Medir ────────────────────────────────────────────────────────────

/**
 * El cuadro del render en el mismo instante.
 *
 * Se pide medio cuadro adentro —`(f + 0.5)/fps`— y no en el borde: pedir el
 * límite exacto deja que un error de redondeo de milésimas devuelva el cuadro
 * anterior, que es justo el que no se está comparando.
 */
async function cuadroDelRender(ffmpeg, render, f, fps, destino) {
    await correr(ffmpeg, [
        '-hide_banner', '-loglevel', 'error',
        '-accurate_seek', '-ss', String((f + 0.5) / fps),
        '-i', render,
        '-frames:v', '1', '-y', destino
    ]);
    return destino;
}

/** PSNR y SSIM entre dos PNG del mismo tamaño. */
async function diferencia(ffmpeg, a, b) {
    const { stderr } = await correr(ffmpeg, [
        '-hide_banner', '-i', a, '-i', b,
        '-lavfi', '[0:v][1:v]ssim=stats_file=-;[0:v][1:v]psnr',
        '-f', 'null', '-'
    ]).catch(e => ({ stderr: e.message }));

    const ssim = /All:\s*([0-9.]+)/.exec(stderr);
    const psnr = /average:\s*([0-9.a-z]+)/.exec(stderr);
    return {
        ssim: ssim ? parseFloat(ssim[1]) : null,
        psnr: psnr ? parseFloat(psnr[1]) : null
    };
}

async function main() {
    const carpeta = process.argv[2] && !process.argv[2].startsWith('--')
        ? path.resolve(process.argv[2])
        : null;
    if (!carpeta) {
        console.error('Uso: node tools/comparar-preview.js "<carpeta de la edición>" [--tiempos 3.52,63.68] [--salida dir]');
        process.exit(2);
    }

    // Por el mismo `leer` que usa la app: si la edición no se puede abrir acá,
    // tampoco se puede abrir allá, y conviene saberlo con el mismo mensaje.
    const leido = edicionLib.leer(carpeta);
    if (!leido.ok) {
        console.error(leido.error);
        process.exit(2);
    }
    const edit = leido.edicion;
    const render = edit.referencia;
    if (!render) {
        console.error('No está el render de referencia que nombra el edit.json.');
        process.exit(2);
    }

    const ffmpeg = paths.ffmpeg().path;
    if (!ffmpeg) {
        console.error('Falta ffmpeg.');
        process.exit(2);
    }

    const tiempos = (argumento('tiempos', '') || '').trim()
        ? argumento('tiempos').split(',').map(Number)
        : TIEMPOS;
    const salida = path.resolve(argumento('salida', path.join(os.tmpdir(), 'comparar-preview')));
    fs.mkdirSync(salida, { recursive: true });

    const puerto = Number(argumento('puerto', 0)) || 9400 + Math.floor(Math.random() * 100);
    const propia = !tiene('usar-abierta');
    const hijo = propia ? levantar(puerto) : null;

    let sesion = null;
    try {
        sesion = await conectar(puerto);
        await esperar(600);

        const preparado = await sesion.evaluar(GUION_PREPARAR(carpeta));
        if (preparado.error) throw new Error(preparado.error);

        // Se recarga para entrar por la pantalla de inicio con la carpeta ya
        // en recientes, que es el camino que recorre el editor.
        await sesion.evaluar('location.reload()').catch(() => {});
        sesion.cerrar();
        await esperar(2500);
        sesion = await conectar(puerto);

        const listo = await sesion.evaluar(GUION_ABRIR(path.dirname(carpeta), preparado.clase));
        if (listo.error) throw new Error(listo.error);

        const filas = [];
        for (const t of tiempos) {
            const r = await sesion.evaluar(GUION_CUADRO(t));
            if (r.error) throw new Error(r.error);

            const nombre = String(t).replace('.', '_');
            const dePreview = path.join(salida, `${nombre}-preview.png`);
            const deRender = path.join(salida, `${nombre}-render.png`);
            fs.writeFileSync(dePreview, Buffer.from(r.png.split(',')[1], 'base64'));
            await cuadroDelRender(ffmpeg, render, r.f, edit.fps, deRender);

            const d = await diferencia(ffmpeg, dePreview, deRender);
            const fila = { t, shot: r.shot, layout: r.layout, ...d, dePreview, deRender };

            // Con `--vecinos` se mide también contra el cuadro de antes y el
            // de después. Es la forma de distinguir las dos causas que se ven
            // iguales en el número: si el vecino gana por mucho, el modelo de
            // tiempo está corrido un cuadro; si los tres dan parecido y el del
            // medio gana, lo que queda es el reescalado del proxy, que no se
            // puede arreglar y no hace falta.
            if (tiene('vecinos')) {
                fila.vecinos = {};
                for (const salto of [-1, 1]) {
                    const otro = path.join(salida, `${nombre}-render${salto > 0 ? '+' : ''}${salto}.png`);
                    await cuadroDelRender(ffmpeg, render, r.f + salto, edit.fps, otro);
                    fila.vecinos[salto] = (await diferencia(ffmpeg, dePreview, otro)).ssim;
                }
            }
            filas.push(fila);
        }

        const archivoBase = argumento('base', null) || argumento('fijar', null);
        const base = argumento('base', null) && fs.existsSync(argumento('base'))
            ? JSON.parse(fs.readFileSync(argumento('base'), 'utf8'))
            : null;

        console.log('');
        console.log('  tiempo    shot  layout      SSIM     PSNR');
        const problemas = [];
        for (const f of filas) {
            if (f.ssim == null || f.ssim < SSIM_MINIMO || f.psnr < PSNR_MINIMO) {
                problemas.push(`${f.t}s está por el piso (${f.ssim} / ${f.psnr} dB): falta una capa.`);
            }
            const antes = base && base[f.t];
            let caida = '';
            if (antes && f.psnr != null && antes.psnr - f.psnr > CAIDA_MAXIMA) {
                caida = `  ↓ ${(antes.psnr - f.psnr).toFixed(2)} dB`;
                problemas.push(`${f.t}s empeoró ${(antes.psnr - f.psnr).toFixed(2)} dB respecto de la referencia.`);
            }
            const vecinos = f.vecinos
                ? `   (−1: ${(f.vecinos[-1] || 0).toFixed(4)}  +1: ${(f.vecinos[1] || 0).toFixed(4)})`
                : '';
            console.log(
                `  ${String(f.t).padStart(7)}  ${String(f.shot).padStart(4)}  ${f.layout.padEnd(10)}`
                + `  ${f.ssim == null ? '   ?  ' : f.ssim.toFixed(4)}`
                + `  ${f.psnr == null ? '  ?  ' : `${f.psnr.toFixed(2)} dB`}${caida}${vecinos}`
            );
        }

        if (argumento('fijar', null)) {
            const guardar = {};
            for (const f of filas) guardar[f.t] = { ssim: f.ssim, psnr: f.psnr, shot: f.shot, layout: f.layout };
            fs.writeFileSync(archivoBase, `${JSON.stringify(guardar, null, 2)}\n`);
            console.log(`\n  Referencia guardada en ${archivoBase}`);
        }

        console.log(`\n  Los PNG quedaron en ${salida}`);
        if (problemas.length) {
            console.log('');
            for (const p of problemas) console.log(`  ✗ ${p}`);
        } else if (base) {
            console.log('\n  Sin caídas respecto de la referencia.');
        }
        process.exitCode = problemas.length ? 1 : 0;
    } finally {
        if (sesion) sesion.cerrar();
        // Solo la que levantó esta herramienta, y por su pid: el editor puede
        // tener la suya abierta con una revisión a medio hacer, y Cursor y
        // Claude también son Electron. Nunca por nombre.
        //
        // Dos tiros porque uno no alcanzaba: el primero le pide al grupo que
        // cierre, y si el proceso sigue vivo medio segundo después se lo baja
        // de verdad. Una instancia que sobrevive se queda con una edición
        // abierta y ocho decodificadores, y le roba el rendimiento a la
        // corrida siguiente — que fue exactamente cómo apareció una medición
        // mala que no tenía nada que ver con el código.
        if (hijo) {
            for (const señal of ['SIGTERM', 'SIGKILL']) {
                try { process.kill(-hijo.pid, señal); } catch (e) {
                    try { process.kill(hijo.pid, señal); } catch (e2) { break; }
                }
                await esperar(500);
                try { process.kill(hijo.pid, 0); } catch (e) { break; }
            }
        }
    }
}

main().catch(e => {
    console.error(`\n${e.message}`);
    process.exit(1);
});
