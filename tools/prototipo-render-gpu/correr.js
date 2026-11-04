'use strict';
/**
 * correr.js — Mide el prototipo contra ffmpeg sobre una toma real.
 *
 *   node tools/prototipo-render-gpu/correr.js <taller> <plan> <toma> [cuadros] [paralelo]
 *   node tools/prototipo-render-gpu/correr.js \
 *       ~/Movies/CUR/2610_NemoClaw_Course/_claude_edit v7/plan_c5p1c.json 53 300 3
 *
 * Hace, en orden:
 *  1. Le pide a `render7.py` los parámetros exactos de la toma (recortes,
 *     zoom, subrayados), para no reinterpretarlos.
 *  2. Genera la tabla 3D del grade con el propio ffmpeg: aplica el grade real
 *     sobre una imagen Hald y la salida ES la tabla.
 *  3. Renderiza la toma con ffmpeg sin pérdida (ffv1): la referencia.
 *  4. Renderiza la toma con ffmpeg como en producción, y mide.
 *  5. Corre el prototipo en Electron, solo y en paralelo, y mide.
 *  6. Compara contra la referencia con VMAF y PSNR, y deja un cuadro lado a
 *     lado para mirar.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const [taller, plan, toma, cuadrosArg = '300', paraleloArg = '3'] = process.argv.slice(2);
if (!taller || !plan || !toma) {
    console.error('uso: correr.js <taller> <plan> <toma> [cuadros] [paralelo]');
    process.exit(1);
}
const NF = parseInt(cuadrosArg, 10);
const PARALELO = parseInt(paraleloArg, 10);
const SALIDA = path.join(os.tmpdir(), 'poc-gpu');
fs.rmSync(SALIDA, { recursive: true, force: true });
fs.mkdirSync(SALIDA, { recursive: true });

const RAIZ_APP = path.resolve(__dirname, '..', '..');
const electron = path.join(RAIZ_APP, 'node_modules', 'electron', 'dist',
    fs.readFileSync(path.join(RAIZ_APP, 'node_modules', 'electron', 'path.txt'), 'utf8').trim());

const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 26, ...opts });

// ── 1. Los parámetros de la toma, de boca de render7.py ──────────────
const PY = `
import os, sys, json, importlib
os.chdir(${JSON.stringify(taller)}); sys.path.insert(0, '.')
os.environ['SCNDIR'] = 'scn/_poc'; os.environ['SEGDIR'] = '../../../../../../${path.relative('/', SALIDA)}/segs'
sys.argv = ['render7.py', ${JSON.stringify(plan)}, '100000']
m = importlib.import_module('render7')
i = ${parseInt(toma, 10)}; s = m.P['shots'][i]
assert s['layout'] == 'SCREEN', 'el prototipo cubre SCREEN'
c = m.build(i, s); k = c.index('-frames:v'); c[k + 1] = str(min(${NF}, s['nf']))
crop = [int(x) for x in m.PIP.split(',')[0].split('=')[1].split(':')]
print(json.dumps({
  'cmd': c, 'nf': min(${NF}, s['nf']), 'src': s['src'], 'scroff': s['opts'].get('scroff', 0),
  'cam': m.CAM, 'scr': (m.E + s['opts']['scrfile']) if s['opts'].get('scrfile') else m.SCR,
  'base': s['opts'].get('base') or [(1920 - m.WMAX) // 2, m.MB, m.WMAX], 'focus': s['opts'].get('focus') or [],
  'hls': [h for h in (s['opts'].get('hls') or []) if h[1] > s['src'] and h[0] < s['src'] + s['dur']],
  'blur': s['opts'].get('blur') or [], 'scene': s['opts'].get('scene'), 'nopip': s['opts'].get('nopip'),
  'wmax': m.WMAX, 'mb': m.MB, 'grade': m.GRADE, 'hl': m.A3 + 'hl', 'logo': m.A3 + 'logo_r.png',
  'pip': {'crop': crop, 'ancho': 264, 'alto': 266, 'mascara': m.A + 'pipmask.png', 'aro': m.A + 'pipring.png', 'en': [1566, 766], 'aroEn': [1560, 760]}
}))
`;
const T = JSON.parse(sh('python3', ['-c', PY]));
if (T.blur.length || T.scene || T.nopip) {
    console.error('Esta toma usa blur, escena o nopip; el prototipo todavía no los cubre. Elegí otra.');
    process.exit(1);
}
console.log(`Toma ${toma}: ${T.nf} cuadros, ${T.focus.length} zooms, ${T.hls.length} subrayados`);

// ── 2. La tabla 3D del grade ─────────────────────────────────────────
const lut = path.join(SALIDA, 'grade_hald.png');
sh('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'haldclutsrc=8', '-vf', T.grade, '-frames:v', '1', lut]);

// ── 3 y 4. ffmpeg: la referencia sin pérdida y el render de producción ──
const j = T.cmd.indexOf('-c:v');
const ref = path.join(SALIDA, 'ref.mkv');
sh('ffmpeg', [...T.cmd.slice(1, j), '-c:v', 'ffv1', '-level', '3', '-an', ref]);

function medirFfmpeg(n) {
    const t0 = Date.now();
    const hijos = Array.from({ length: n }, (_, i) => T.cmd.slice(0, -1).concat(path.join(SALIDA, `ffmpeg-${i}.mp4`)));
    if (n === 1) {
        sh(hijos[0][0], hijos[0].slice(1));
    } else {
        // Varios a la vez, como el worker con NP.
        const r = spawnSync('sh', ['-c', hijos.map(c => c.map(a => `'${a.replace(/'/g, "'\\''")}'`).join(' ')).join(' & ') + ' & wait']);
        if (r.status) throw new Error('ffmpeg en paralelo falló');
    }
    const ms = Date.now() - t0;
    return { ms, fps: n * T.nf / (ms / 1000) };
}
const ff1 = medirFfmpeg(1);
const ffN = medirFfmpeg(PARALELO);
const ffmpegMp4 = path.join(SALIDA, 'ffmpeg-0.mp4');

// ── 5. El prototipo ──────────────────────────────────────────────────
function medirPoc(paralelo) {
    const bitrate = Math.round(8 * fs.statSync(ffmpegMp4).size / (T.nf / 30));
    const poc = {
        ...T, cmd: undefined, lut, bitrate, paralelo, modo: process.env.POC_MODO || 'completo',
        salida: path.join(SALIDA, paralelo === 1 ? 'poc.mp4' : `poc-x${paralelo}.mp4`)
    };
    const r = spawnSync(electron, [path.join(__dirname, 'main.js')], {
        env: { ...process.env, POC: JSON.stringify(poc) }, encoding: 'utf8', maxBuffer: 1 << 26
    });
    const linea = (r.stdout || '').trim().split('\n').pop();
    let res;
    try { res = JSON.parse(linea); } catch (e) { res = { error: `sin respuesta: ${r.stderr}` }; }
    if (res.error) throw new Error(`prototipo: ${res.error}\n${r.stderr}`);
    return { ...res, bitrate };
}
const poc1 = medirPoc(1);
const pocN = medirPoc(PARALELO);

// ── 6. Calidad ───────────────────────────────────────────────────────
function calidad(a) {
    const out = spawnSync('ffmpeg', ['-v', 'info', '-i', a, '-i', ref, '-lavfi', '[0:v][1:v]libvmaf=n_threads=8;[0:v][1:v]psnr', '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
    const vmaf = /VMAF score: ([\d.]+)/.exec(out);
    const psnr = /PSNR .*average:([\d.]+)/.exec(out);
    return { vmaf: vmaf ? +vmaf[1] : null, psnr: psnr ? +psnr[1] : null };
}
const qFf = calidad(ffmpegMp4);
const qPoc = calidad(poc1.tuberias[0].archivo);
const mb = f => (fs.statSync(f).size / 1e6).toFixed(2);

const medio = Math.floor(T.nf / 2);
sh('ffmpeg', ['-v', 'error', '-y', '-i', poc1.tuberias[0].archivo, '-i', ref,
    '-filter_complex', `[0:v]select=eq(n\\,${medio})[a];[1:v]select=eq(n\\,${medio})[b];[a][b]hstack`,
    '-frames:v', '1', path.join(SALIDA, 'lado-a-lado.png')]);

console.log('');
console.log(`${'Velocidad'.padEnd(34)}${'tiempo'.padStart(9)}${'cuadros/s'.padStart(11)}`);
console.log(`${`ffmpeg, 1 proceso`.padEnd(34)}${(ff1.ms / 1000).toFixed(1).padStart(8)}s${ff1.fps.toFixed(0).padStart(11)}`);
console.log(`${`ffmpeg, ${PARALELO} a la vez`.padEnd(34)}${(ffN.ms / 1000).toFixed(1).padStart(8)}s${ffN.fps.toFixed(0).padStart(11)}`);
console.log(`${`prototipo GPU, 1 tubería`.padEnd(34)}${(poc1.ms / 1000).toFixed(1).padStart(8)}s${poc1.fps.toFixed(0).padStart(11)}`);
console.log(`${`prototipo GPU, ${PARALELO} tuberías`.padEnd(34)}${(pocN.ms / 1000).toFixed(1).padStart(8)}s${pocN.fps.toFixed(0).padStart(11)}`);
console.log('');
console.log(`${'Calidad contra la referencia sin pérdida'.padEnd(34)}${'VMAF'.padStart(9)}${'PSNR'.padStart(9)}${'MB'.padStart(8)}`);
console.log(`${'ffmpeg (VideoToolbox)'.padEnd(34)}${String(qFf.vmaf).padStart(9)}${String(qFf.psnr).padStart(9)}${mb(ffmpegMp4).padStart(8)}`);
console.log(`${'prototipo GPU'.padEnd(34)}${String(qPoc.vmaf).padStart(9)}${String(qPoc.psnr).padStart(9)}${mb(poc1.tuberias[0].archivo).padStart(8)}`);
console.log('');
console.log(`Cuadro ${medio} lado a lado (prototipo | ffmpeg): ${path.join(SALIDA, 'lado-a-lado.png')}`);
