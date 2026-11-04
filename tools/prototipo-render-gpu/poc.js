'use strict';
/**
 * poc.js — Una toma SCREEN de `render7.py`, compuesta en el navegador.
 *
 * Reproduce la ruta más pesada y más común del exportador de Claude —la mitad
 * de los cuadros de una clase—: la pantalla con subrayados temporizados y
 * zoom animado, el recuadro de la cámara con su grade de color, máscara y
 * aro, y el logo. Las mismas fórmulas que `render7.py` (`view_expr`, los
 * `fade` de los subrayados, el orden de las capas), para que la comparación
 * contra su salida sea de composición y no de interpretación.
 *
 * Lo que cambia es dónde corre cada cosa:
 *
 * - Decodificar y codificar: WebCodecs, que en Chromium sobre macOS es
 *   VideoToolbox. `mediabunny` lee y escribe el MP4.
 * - Componer: Canvas 2D, que Chromium rasteriza en la GPU.
 * - El grade: una tabla 3D de 64³ generada por ffmpeg a partir del grade
 *   real (ver `correr.js`), aplicada con un shader de WebGL2. En ffmpeg ese
 *   grade es el 65 % del tiempo de los filtros; acá es una búsqueda de
 *   textura por píxel.
 *
 * Se mide el pipeline entero, de leer el primer paquete a escribir el MP4.
 */

const fs = require('fs');
const path = require('path');
const { ipcRenderer } = require('electron');

const RAIZ_APP = path.resolve(__dirname, '..', '..');
const mb = require(path.join(RAIZ_APP, 'node_modules', 'mediabunny', 'dist', 'bundles', 'mediabunny.node.cjs'));

const P = JSON.parse(new URLSearchParams(location.search).get('poc'));
const FPS = 30;
const RAMP = 0.6;

/** Una imagen del disco lista para `drawImage`. */
async function imagen(ruta, opciones = {}) {
    return createImageBitmap(new Blob([fs.readFileSync(ruta)]), opciones);
}

/**
 * La máscara del recuadro: ffmpeg la lee en gris y la usa como alfa
 * (`format=gray` + `alphamerge`). En canvas hace falta una imagen cuyo canal
 * alfa sea ese gris, y se arma una sola vez.
 */
async function mascaraComoAlfa(ruta) {
    const gris = await imagen(ruta);
    const c = new OffscreenCanvas(gris.width, gris.height);
    const ctx = c.getContext('2d');
    ctx.drawImage(gris, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height);
    for (let i = 0; i < d.data.length; i += 4) {
        d.data[i + 3] = d.data[i];
        d.data[i] = d.data[i + 1] = d.data[i + 2] = 255;
    }
    ctx.putImageData(d, 0, 0);
    return c;
}

/**
 * El grade como tabla 3D en WebGL2.
 *
 * La imagen Hald de nivel 8 (512×512) lista los 64³ colores con el rojo
 * variando más rápido, después el verde y al final el azul: leída en orden
 * de filas es, byte a byte, una textura 3D de 64×64×64. No hay que
 * reordenar nada.
 */
function tablaDeColor(hald) {
    const c = new OffscreenCanvas(hald.width, hald.height);
    const cctx = c.getContext('2d', { willReadFrequently: true });
    cctx.drawImage(hald, 0, 0);
    const d = cctx.getImageData(0, 0, 512, 512).data;

    const lienzo = new OffscreenCanvas(P.pip.ancho, P.pip.alto);
    const gl = lienzo.getContext('webgl2', { premultipliedAlpha: false, alpha: false });
    if (!gl) throw new Error('sin WebGL2');

    const prog = programa(gl, VS_CUADRO, `#version 300 es
        precision highp float; precision highp sampler3D;
        uniform sampler2D img; uniform sampler3D lut; in vec2 uv; out vec4 o;
        void main() {
            vec3 c = texture(img, uv).rgb;
            // Del centro del primer texel al centro del último: así 0 cae en
            // la entrada 0 y 1 en la 63, sin extrapolar.
            o = vec4(texture(lut, c * (63.0 / 64.0) + 0.5 / 64.0).rgb, 1.0);
        }`);

    gl.activeTexture(gl.TEXTURE1);
    const t3 = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_3D, t3);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, 64, 64, 64, 0, gl.RGBA, gl.UNSIGNED_BYTE, d);
    for (const p of ['TEXTURE_MIN_FILTER', 'TEXTURE_MAG_FILTER']) gl.texParameteri(gl.TEXTURE_3D, gl[p], gl.LINEAR);
    for (const p of ['TEXTURE_WRAP_S', 'TEXTURE_WRAP_T', 'TEXTURE_WRAP_R']) gl.texParameteri(gl.TEXTURE_3D, gl[p], gl.CLAMP_TO_EDGE);
    gl.uniform1i(gl.getUniformLocation(prog, 'lut'), 1);

    gl.activeTexture(gl.TEXTURE0);
    const t2 = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t2);
    for (const p of ['TEXTURE_MIN_FILTER', 'TEXTURE_MAG_FILTER']) gl.texParameteri(gl.TEXTURE_2D, gl[p], gl.LINEAR);
    for (const p of ['TEXTURE_WRAP_S', 'TEXTURE_WRAP_T']) gl.texParameteri(gl.TEXTURE_2D, gl[p], gl.CLAMP_TO_EDGE);
    gl.uniform1i(gl.getUniformLocation(prog, 'img'), 0);
    gl.viewport(0, 0, lienzo.width, lienzo.height);

    return {
        lienzo,
        aplicar(fuente) {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, fuente);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
            return lienzo;
        }
    };
}

/** Compila y enlaza un programa de WebGL2, o dice por qué no. */
function programa(gl, vs, fsrc) {
    const compilar = (tipo, src) => {
        const s = gl.createShader(tipo);
        gl.shaderSource(s, src); gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
        return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, compilar(gl.VERTEX_SHADER, vs));
    gl.attachShader(prog, compilar(gl.FRAGMENT_SHADER, fsrc));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    return prog;
}

const VS_CUADRO = `#version 300 es
    in vec2 p; out vec2 uv;
    void main() { uv = vec2(p.x, 1.0 - p.y); gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;

/**
 * El zoom como remuestreo Lanczos-3 en la GPU.
 *
 * Canvas 2D escala con el bicúbico de Skia, que es más blando que el Lanczos
 * de ffmpeg. Sobre texto se nota: el prototipo con el escalado de Skia daba
 * VMAF 78 contra la referencia, y con nitidez devuelta a mano 94. Esto es la
 * versión honesta de eso: el mismo núcleo que usa ffmpeg, 6×6 muestras por
 * píxel de salida, que para una GPU no es nada.
 */
function escaladorLanczos() {
    const lienzo = new OffscreenCanvas(1920, 1080);
    const gl = lienzo.getContext('webgl2', { premultipliedAlpha: false, alpha: false });
    const prog = programa(gl, VS_CUADRO, `#version 300 es
        precision highp float;
        uniform sampler2D img; uniform vec4 ventana; uniform vec2 salida;
        out vec4 o;
        float L(float x) {
            x = abs(x);
            if (x < 1e-5) return 1.0;
            if (x >= 3.0) return 0.0;
            float px = 3.14159265 * x;
            return 3.0 * sin(px) * sin(px / 3.0) / (px * px);
        }
        void main() {
            // Píxel de salida con origen arriba, como la imagen.
            vec2 d = vec2(gl_FragCoord.x, salida.y - gl_FragCoord.y);
            vec2 s = ventana.xy + d / salida * ventana.zw;
            vec2 c = floor(s - 0.5) + 0.5;
            ivec2 tope = textureSize(img, 0) - 1;
            vec3 acc = vec3(0.0); float peso = 0.0;
            for (int j = -2; j <= 3; j++) for (int i = -2; i <= 3; i++) {
                vec2 p = c + vec2(float(i), float(j));
                float w = L(s.x - p.x) * L(s.y - p.y);
                acc += texelFetch(img, clamp(ivec2(p), ivec2(0), tope), 0).rgb * w;
                peso += w;
            }
            o = vec4(acc / peso, 1.0);
        }`);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    for (const p of ['TEXTURE_MIN_FILTER', 'TEXTURE_MAG_FILTER']) gl.texParameteri(gl.TEXTURE_2D, gl[p], gl.NEAREST);
    for (const p of ['TEXTURE_WRAP_S', 'TEXTURE_WRAP_T']) gl.texParameteri(gl.TEXTURE_2D, gl[p], gl.CLAMP_TO_EDGE);
    gl.uniform1i(gl.getUniformLocation(prog, 'img'), 0);
    gl.uniform2f(gl.getUniformLocation(prog, 'salida'), 1920, 1080);
    const uVentana = gl.getUniformLocation(prog, 'ventana');
    gl.viewport(0, 0, 1920, 1080);
    return {
        lienzo,
        aplicar(fuente, v) {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, fuente);
            gl.uniform4f(uVentana, v.x, v.y, v.w, v.h);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
            return lienzo;
        }
    };
}

const clip = (v, a, b) => Math.max(a, Math.min(b, v));

/**
 * La ventana de zoom en el instante T: `view_expr` de render7.py más la
 * cuantización que `zoompan` le aplica por dentro.
 *
 * Lo segundo no es opcional si se quiere la misma imagen. `zoompan` trabaja
 * sobre el cuadro ya escalado a 4K, trunca el tamaño de la ventana a entero,
 * y trunca la posición a entero PAR —por el submuestreo de croma de yuv420p—.
 * Son hasta dos píxeles de 4K, uno de 1080p. Con la trayectoria matemática
 * exacta la imagen se ve igual a ojo, pero durante el movimiento cada borde
 * de texto queda doble contra la de ffmpeg: 21 dB donde quieta da 32.
 */
function vista(T) {
    const [bx, by, bw] = P.base;
    let W = bw;
    let X = bx;
    let Y = by;
    for (const [a, b, x, y, w] of P.focus) {
        const k = clip((T - a) / RAMP, 0, 1) * clip((b - T) / RAMP, 0, 1);
        const e = k * k * (3 - 2 * k);
        W += e * (w - bw); X += e * (x - bx); Y += e * (y - by);
    }
    W = Math.min(P.wmax, W);
    const zoom = 1920 / W;
    const w4 = Math.trunc(3840 * (1 / zoom));
    const h4 = Math.trunc(2160 * (1 / zoom));
    const x4 = Math.trunc(clip(2 * clip(X, 0, 1920 - W), 0, Math.max(3840 - w4, 0))) & ~1;
    const y4 = Math.trunc(clip(2 * clip(Y, P.mb, 1080 - W * 9 / 16), 0, Math.max(2160 - h4, 0))) & ~1;
    return { x: x4 / 2, y: y4 / 2, w: w4 / 2, h: h4 / 2 };
}

/** Cuánto se ve un subrayado en el segundo t de la toma: los dos `fade`. */
function alfaDeSubrayado(h, t) {
    const [h0, h1] = h;
    const a = h0 - P.src;
    const dIn = a > 0 ? 0.25 : 0.01;
    const entra = clip((t - Math.max(0, a)) / dIn, 0, 1);
    const sale = clip((h1 - P.src - t) / 0.25, 0, 1);
    return entra * sale;
}

async function tuberia(indice) {
    const abrir = async ruta => {
        const input = new mb.Input({ source: new mb.FilePathSource(ruta), formats: mb.ALL_FORMATS });
        const pista = await input.getPrimaryVideoTrack();
        return new mb.VideoSampleSink(pista, { hardwareAcceleration: 'prefer-hardware' });
    };
    const [cam, scr] = await Promise.all([abrir(P.cam), abrir(P.scr)]);

    const [mascara, aro, logo, hald] = await Promise.all([
        mascaraComoAlfa(P.pip.mascara),
        imagen(P.pip.aro),
        imagen(P.logo),
        imagen(P.lut, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' })
    ]);
    const subrayados = await Promise.all(P.hls.map(h => imagen(path.join(P.hl, `hl${h[6] || 'g'}_${h[4]}x${h[5]}.png`))));
    const grade = tablaDeColor(hald);
    const zoom = escaladorLanczos();

    const salida = new OffscreenCanvas(1920, 1080);
    const ctx = salida.getContext('2d', { alpha: false });
    const recuadro = new OffscreenCanvas(P.pip.ancho, P.pip.alto);
    const rctx = recuadro.getContext('2d', { alpha: false });
    const enmascarado = new OffscreenCanvas(P.pip.ancho, P.pip.alto);
    const mctx = enmascarado.getContext('2d');
    for (const c of [ctx, rctx, mctx]) { c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high'; }

    const output = new mb.Output({ format: new mb.Mp4OutputFormat(), target: new mb.BufferTarget() });
    const fuente = new mb.CanvasSource(salida, {
        codec: 'avc',
        fullCodecString: 'avc1.640028',
        bitrate: P.bitrate,
        hardwareAcceleration: 'prefer-hardware',
        latencyMode: 'quality',
        keyFrameInterval: 2
    });
    output.addVideoTrack(fuente, { frameRate: FPS });
    await output.start();

    // ffmpeg con `-ss` entrega el primer cuadro cuyo tiempo es ≥ src. El
    // iterador de mediabunny arranca en el cuadro que CONTIENE src, que es
    // uno antes; se salta lo que quede por debajo.
    const desde = ruta => ruta.samples(P.src - 0.05);
    const siguiente = async (it, minimo) => {
        for (;;) {
            const { value, done } = await it.next();
            if (done) return null;
            if (value.timestamp >= minimo - 1e-3) return value;
            value.close();
        }
    };
    const itCam = desde(cam);
    const itScr = desde(scr);

    const t0 = performance.now();
    let cuadros = 0;
    for (let k = 0; k < P.nf; k++) {
        const t = k / FPS;
        const [fc, fp] = await Promise.all([siguiente(itCam, P.src + t), siguiente(itScr, P.src + P.scroff + t)]);
        if (!fc || !fp) break;

        // 1. El zoom: el recorte de la pantalla llevado a 1920×1080 con
        //    Lanczos en la GPU, desde el cuadro decodificado directo a la
        //    textura. (Con `ctx.drawImage(pantalla, v.x, v.y, v.w, v.h, 0, 0,
        //    1920, 1080)` sale más blando, VMAF 78 contra 90; y pasando por
        //    un canvas 2D intermedio se pierde un tercio de la velocidad en
        //    la copia entre contextos.)
        const v = vista(P.src + t);
        if (P.modo === 'crudo') {
            // Solo para medir el techo: decodificar y codificar, sin componer.
            fp.draw(ctx, 0, 0);
            await fuente.add(t, 1 / FPS);
            fc.close(); fp.close();
            cuadros++;
            continue;
        }
        const cuadro = fp.toVideoFrame();
        ctx.drawImage(zoom.aplicar(cuadro, v), 0, 0);
        cuadro.close();

        // 2. Los subrayados van DENTRO de la capa de pantalla, así que se
        //    acercan con el zoom: se dibujan ya transformados por la ventana.
        const escala = 1920 / v.w;
        P.hls.forEach((h, i) => {
            const a = alfaDeSubrayado(h, t);
            if (a <= 0) return;
            const img = subrayados[i];
            ctx.globalAlpha = a;
            ctx.drawImage(img, (h[2] - 6 - v.x) * escala, (h[3] - 6 - v.y) * escala, img.width * escala, img.height * escala);
            ctx.globalAlpha = 1;
        });

        // 3. El recuadro de la cámara: recorte, escala, grade, máscara, aro.
        fc.draw(rctx, P.pip.crop[2], P.pip.crop[3], P.pip.crop[0], P.pip.crop[1], 0, 0, P.pip.ancho, P.pip.alto);
        const graduado = grade.aplicar(recuadro);
        mctx.globalCompositeOperation = 'source-over';
        mctx.clearRect(0, 0, P.pip.ancho, P.pip.alto);
        mctx.drawImage(graduado, 0, 0);
        mctx.globalCompositeOperation = 'destination-in';
        mctx.drawImage(mascara, 0, 0);
        ctx.drawImage(enmascarado, P.pip.en[0], P.pip.en[1]);
        ctx.drawImage(aro, P.pip.aroEn[0], P.pip.aroEn[1]);

        // 4. El logo.
        ctx.drawImage(logo, 0, 0);

        await fuente.add(t, 1 / FPS);
        fc.close(); fp.close();
        cuadros++;
    }
    fuente.close();
    await output.finalize();
    const ms = performance.now() - t0;

    const archivo = P.salida.replace(/\.mp4$/, indice ? `-${indice}.mp4` : '.mp4');
    fs.writeFileSync(archivo, Buffer.from(output.target.buffer));
    return { archivo, cuadros, ms };
}

(async () => {
    try {
        const t0 = performance.now();
        const resultados = await Promise.all(Array.from({ length: P.paralelo || 1 }, (_, i) => tuberia(i)));
        const ms = performance.now() - t0;
        const cuadros = resultados.reduce((a, r) => a + r.cuadros, 0);
        ipcRenderer.send('poc-listo', { ok: true, paralelo: P.paralelo || 1, cuadros, ms, fps: cuadros / (ms / 1000), tuberias: resultados });
    } catch (e) {
        ipcRenderer.send('poc-listo', { error: `${e.message}\n${e.stack}` });
    }
})();
