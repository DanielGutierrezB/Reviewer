'use strict';
/**
 * El cuadro de un comentario y el cuadro con el dibujo encima.
 *
 * Estos corren ffmpeg de verdad contra un video de verdad, porque lo que se
 * quiere comprobar no es que se llame a ffmpeg: es que el PNG que termina en la
 * carpeta tenga la imagen adentro. El modo de falla que motivó este archivo —el
 * trazo rojo flotando sobre transparente— pasaba todas las comprobaciones que no
 * miraban los píxeles.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const frames = require('../engine/frames');
const paths = require('../engine/paths');
const temporal = require('./lib/temporal');
const workspace = require('../engine/workspace');

/** Un PNG de 1920×1080 con un trazo opaco en el medio y el resto transparente. */
function capaDeTrazo(destino, ffmpeg) {
    execFileSync(ffmpeg, [
        '-nostdin', '-v', 'error', '-y',
        '-f', 'lavfi', '-i', 'color=c=red@1.0:s=200x40,format=rgba',
        '-f', 'lavfi', '-i', 'color=c=black@0.0:s=1920x1080,format=rgba',
        '-filter_complex', '[1:v][0:v]overlay=860:520',
        '-frames:v', '1', destino
    ]);
    return fs.readFileSync(destino);
}

/** El color de un píxel del PNG, leído con ffmpeg como un rgba crudo. */
function pixel(archivo, x, y, ffmpeg) {
    const crudo = execFileSync(ffmpeg, [
        '-nostdin', '-v', 'error',
        '-i', archivo,
        '-vf', `crop=1:1:${x}:${y}`,
        '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'
    ], { maxBuffer: 1024 });
    return [...crudo];
}

module.exports = async function (t) {
    t.grupo('Cuadros que llegan hechos (los de una edición)');

    // Estos no necesitan ffmpeg: una edición no tiene archivo del que sacar el
    // cuadro, la ventana lo compone y lo manda. Lo que hay que vigilar es que
    // lo que llega por el puente sea una imagen y caiga donde tiene que caer.
    const deEdicion = path.join(temporal.carpeta('frames-edicion'), 'Clase prueba', 'edit.json');
    const FIRMA = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    t.test('un PNG compuesto se guarda en frames/ de la edición', () => {
        const r = frames.guardarCuadro(deEdicion, { id: 'c01', t: 2, fps: 30 }, Buffer.concat([FIRMA, Buffer.from('resto')]));
        t.ok(r.ok, r.error || '');
        t.eq(path.dirname(r.absoluta), path.join(path.dirname(deEdicion), 'feedback', workspace.FRAMES_DIR));
        t.eq(r.relativa, path.join(workspace.FRAMES_DIR, frames.nombreDe('c01', 2, 30)));
        t.ok(fs.existsSync(r.absoluta));
    });

    t.test('lo que no es un PNG no se escribe', () => {
        // Viene por el puente y termina en la carpeta que abre Claude. Cualquier
        // cosa que no empiece como un PNG no tiene por qué estar ahí.
        const r = frames.guardarCuadro(deEdicion, { id: 'c02', t: 2, fps: 30 }, Buffer.from('<html>'));
        t.eq(r.ok, false);
        t.ok(!fs.existsSync(path.join(path.dirname(deEdicion), 'feedback', workspace.FRAMES_DIR, frames.nombreDe('c02', 2, 30))));
        t.eq(frames.guardarCuadro(deEdicion, { id: 'c03', t: 2, fps: 30 }, Buffer.alloc(0)).ok, false, 'ni uno vacío');
    });

    t.grupo('Cuadros');

    const ffmpeg = paths.ffmpeg().path;
    if (!ffmpeg) {
        t.saltear('los cuadros de un comentario', 'no hay ffmpeg en esta máquina');
        return;
    }

    const dir = temporal.carpeta('frames');
    const video = path.join(dir, 'Clase 01 v1.mp4');
    execFileSync(ffmpeg, [
        '-nostdin', '-v', 'error', '-y',
        '-f', 'lavfi', '-i', 'color=c=#1040c0:s=1920x1080:r=25:d=3',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video
    ]);

    let cuadro;

    t.test('el cuadro sale del video y se llama por su timecode', async () => {
        cuadro = await frames.sacar(video, { id: 'c01', t: 1.24, fps: 25 });
        t.eq(cuadro.ok, true, cuadro.error);
        t.eq(path.basename(cuadro.absoluta), 'c01-00h00m01s06f.png');
        t.ok(fs.statSync(cuadro.absoluta).size > 0);
    });

    t.test('y tiene la imagen adentro, no un PNG en blanco', () => {
        const [r, g, b, a] = pixel(cuadro.absoluta, 960, 540, ffmpeg);
        t.eq(a, 255, 'opaco');
        t.ok(b > r && b > g, `el azul del video, no vacío: rgba ${[r, g, b, a]}`);
    });

    t.test('el dibujo se pega SOBRE el cuadro, no sobre nada', () => {
        // Es el test que faltaba: la ventana manda el trazo con fondo
        // transparente, y si el fondo no se pone en ningún lado el PNG sale
        // siendo un trazo flotando en el aire.
        const capa = capaDeTrazo(path.join(dir, 'capa.png'), ffmpeg);
        return frames.guardarDibujo(video, { id: 'c01', t: 1.24, fps: 25 }, capa, cuadro.absoluta)
            .then(r => {
                const encima = pixel(r.absoluta, 960, 540, ffmpeg);
                t.ok(encima[0] > 200 && encima[1] < 80, `donde pasa el trazo, rojo: ${encima}`);
                const afuera = pixel(r.absoluta, 200, 200, ffmpeg);
                t.eq(afuera[3], 255, 'y afuera del trazo no queda transparente');
                t.ok(afuera[2] > afuera[0], `afuera del trazo, el cuadro: ${afuera}`);
            });
    });

    t.test('no deja la capa suelta en la carpeta', () => {
        const sobras = fs.readdirSync(workspace.archivosDeVersion(video).dibujos)
            .filter(n => n.startsWith('.trazo-') || n.includes('.tmp-'));
        t.deep(sobras, []);
    });

    t.test('sin cuadro sobre el que pegarlo, no escribe nada', async () => {
        let motivo = null;
        try {
            await frames.guardarDibujo(video, { id: 'c09', t: 0, fps: 25 }, Buffer.from('x'), '/no/existe.png');
        } catch (e) {
            motivo = e.message;
        }
        t.tiene(motivo || '', 'el cuadro');
    });

    t.test('un dibujo vacío se rechaza', async () => {
        let motivo = null;
        try {
            await frames.guardarDibujo(video, { id: 'c09', t: 0, fps: 25 }, Buffer.alloc(0), cuadro.absoluta);
        } catch (e) {
            motivo = e.message;
        }
        t.tiene(motivo || '', 'vacío');
    });
};
