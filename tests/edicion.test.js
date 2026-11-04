'use strict';
/**
 * Leer una carpeta de edición.
 *
 * Lo que se prueba acá es la puerta de entrada: qué se acepta, qué se rechaza
 * y con qué mensaje. Importa más de lo que parece porque del otro lado hay un
 * compositor que no puede preguntar nada: si el `edit.json` pasa, el preview
 * da por hecho que cada archivo que nombra existe y que los shots cubren la
 * línea entera.
 */

const fs = require('fs');
const path = require('path');

const comentarios = require('../engine/comentarios');
const edicion = require('../engine/edicion');
const exportar = require('../engine/exportar');
const general = require('../engine/general');
const versiones = require('../engine/versiones');
const workspace = require('../engine/workspace');
const temporal = require('./lib/temporal');

/** Un `edit.json` mínimo pero válido, con lo que se le quiera cambiar. */
function receta(cambios) {
    return {
        format: 'claude-edit-preview',
        version: 1,
        title: 'Clase de prueba',
        based_on: '03_Curso_p3_v3.mp4',
        reference_render: '../Finales/03_Curso_p3_v3.mp4',
        fps: 30,
        width: 1920,
        height: 1080,
        duration_frames: 90,
        duration: 3,
        media: {
            cam: { file: 'media/cam.mp4', original: '../Clase 3/cam.mp4', offset: 100, source_size: [1920, 1080], proxy_size: [1280, 720] },
            mix: { file: 'media/mix.m4a' }
        },
        scenes: { titulo: { file: 'scenes/titulo.webm', out: 0, dur: 2 } },
        overlays: [],
        geometry: { box: { src: [0, 0, 900, 900], dst: { SCENE: [1232, 220, 652, 668] }, mask: 'assets/boxmask.png', ring: 'assets/boxring.png' } },
        blocks: [{ id: 'A', src_a: 100, src_b: 103 }],
        shots: [
            { i: 0, out: 0, dur: 1, f0: 0, nf: 30, src: 100, layout: 'SCENE', block: 'A', scene: 'titulo' },
            { i: 1, out: 1, dur: 2, f0: 30, nf: 60, src: 101, layout: 'CAM_WIDE', block: 'A' }
        ],
        transcript: [],
        audio: [],
        ...(cambios || {})
    };
}

/** Una carpeta de edición en el disco, con todos sus archivos puestos. */
function carpetaDeEdicion(nombre, cambios, { sinArchivos = [] } = {}) {
    const curso = temporal.carpeta(nombre);
    const dir = path.join(curso, 'Clase prueba');
    fs.mkdirSync(dir, { recursive: true });

    const datos = receta(cambios);
    fs.writeFileSync(path.join(dir, 'edit.json'), JSON.stringify(datos));

    const todos = [
        'media/cam.mp4', 'media/mix.m4a', 'scenes/titulo.webm',
        'assets/boxmask.png', 'assets/boxring.png'
    ];
    for (const rel of todos) {
        if (sinArchivos.includes(rel)) continue;
        temporal.archivo(dir, rel);
    }
    return { curso, dir, datos };
}

module.exports = async function (t) {
    t.grupo('Edición (leer la carpeta que trae Claude)');

    t.test('una carpeta con edit.json del formato se reconoce', () => {
        const { dir, curso } = carpetaDeEdicion('edicion-es');
        t.ok(edicion.es(dir), 'la carpeta de la edición');
        t.ok(!edicion.es(curso), 'la carpeta del curso no lo es');
    });

    t.test('un edit.json de otra cosa no se toma por una edición', () => {
        // Hay mil programas que escriben un archivo con ese nombre. Mirar solo
        // si existe haría que abrir cualquier carpeta de un proyecto web
        // intentara componer una clase.
        const dir = temporal.carpeta('edicion-ajena');
        temporal.archivo(dir, 'edit.json', JSON.stringify({ format: 'otra-cosa' }));
        t.ok(!edicion.es(dir));
        t.tiene(edicion.leer(dir).error, 'otra-cosa');
    });

    t.test('un edit.json roto no tumba el escaneo de la carpeta entera', () => {
        const dir = temporal.carpeta('edicion-rota');
        temporal.archivo(dir, 'edit.json', '{ esto no es json');
        t.eq(edicion.es(dir), false);
    });

    t.test('las rutas se resuelven contra la carpeta de la edición', () => {
        // Incluidas las que llevan al curso. `reference_render` y `original`
        // ya traen el `../` escrito adentro; resolverlas contra la carpeta del
        // curso «porque son del curso» sube un nivel de más.
        const { dir, curso } = carpetaDeEdicion('edicion-rutas');
        temporal.archivo(curso, 'Finales/03_Curso_p3_v3.mp4');

        const r = edicion.leer(dir);
        t.ok(r.ok, r.error || '');
        t.eq(r.edicion.medios.cam.ruta, path.join(dir, 'media/cam.mp4'));
        t.eq(r.edicion.escenas.titulo.ruta, path.join(dir, 'scenes/titulo.webm'));
        t.eq(r.edicion.referencia, path.join(curso, 'Finales/03_Curso_p3_v3.mp4'));
        t.eq(r.edicion.medios.cam.original, path.join(curso, 'Clase 3/cam.mp4'));
    });

    t.test('el render de referencia que no está queda en null y no rompe', () => {
        const { dir } = carpetaDeEdicion('edicion-sin-referencia');
        const r = edicion.leer(dir);
        t.ok(r.ok);
        t.eq(r.edicion.referencia, null);
    });

    t.test('si falta un medio esencial no abre, y dice cuál', () => {
        const { dir } = carpetaDeEdicion('edicion-sin-escena', null, { sinArchivos: ['scenes/titulo.webm'] });
        const r = edicion.leer(dir);
        t.eq(r.ok, false);
        t.tiene(r.error, 'scenes/titulo.webm');
        t.tiene(r.error, 'la escena titulo', 'dice para qué servía');
    });

    t.test('si falta un adorno abre igual y lo avisa', () => {
        // Sin una máscara la caja del profesor sale sin recortar: peor, no
        // imposible. Cerrarle la puerta a la clase entera por eso sería
        // cambiar un defecto por una revisión que no se puede hacer.
        const { dir } = carpetaDeEdicion('edicion-sin-mascara', null, { sinArchivos: ['assets/boxmask.png'] });
        const r = edicion.leer(dir);
        t.ok(r.ok, r.error || '');
        t.deep(r.faltan, ['assets/boxmask.png']);
    });

    t.test('un hueco entre shots se caza antes de abrir, con el número de cuadro', () => {
        // El modelo de tiempo busca el shot que contiene al cuadro `f`. Un
        // hueco deja cuadros sin shot y la pantalla se va a negro sin que nada
        // lo explique. Es mucho más barato descubrirlo acá.
        const r = edicion.leer(carpetaDeEdicion('edicion-hueco', {
            shots: [
                { i: 0, f0: 0, nf: 30, src: 100, layout: 'CAM_WIDE', out: 0, dur: 1 },
                { i: 1, f0: 40, nf: 50, src: 102, layout: 'CAM_WIDE', out: 1.33, dur: 1.67 }
            ]
        }).dir);
        t.eq(r.ok, false);
        t.tiene(r.error, '30');
        t.tiene(r.error, '40');
    });

    t.test('shots que se pisan tampoco pasan', () => {
        const r = edicion.leer(carpetaDeEdicion('edicion-pisados', {
            shots: [
                { i: 0, f0: 0, nf: 30, src: 100, layout: 'CAM_WIDE', out: 0, dur: 1 },
                { i: 1, f0: 20, nf: 70, src: 102, layout: 'CAM_WIDE', out: 0.67, dur: 2.33 }
            ]
        }).dir);
        t.eq(r.ok, false);
        t.tiene(r.error, 'shot 1');
    });

    t.test('los shots tienen que sumar los cuadros que el JSON declara', () => {
        const r = edicion.leer(carpetaDeEdicion('edicion-cuenta', { duration_frames: 120 }).dir);
        t.eq(r.ok, false);
        t.tiene(r.error, '90');
        t.tiene(r.error, '120');
    });

    t.test('lo que el preview no sabe componer se rechaza con los números', () => {
        // El compositor dibuja en 1920x1080 y los pares de video cuentan a 30
        // por segundo. Abrir otra cosa daba una imagen deformada sin decir por
        // qué; rechazarla acá dice qué es lo que falta soportar.
        const vertical = edicion.leer(carpetaDeEdicion('edicion-vertical', { width: 1080, height: 1920 }).dir);
        t.eq(vertical.ok, false);
        t.tiene(vertical.error, '1080x1920');

        const a25 = edicion.leer(carpetaDeEdicion('edicion-25fps', { fps: 25 }).dir);
        t.eq(a25.ok, false);
        t.tiene(a25.error, '25 fps');
    });

    t.test('sin el audio mezclado no hay reloj, y se dice', () => {
        const { dir } = carpetaDeEdicion('edicion-sin-mix', {
            media: { cam: receta().media.cam }
        });
        const r = edicion.leer(dir);
        t.eq(r.ok, false);
        t.tiene(r.error, 'media.mix');
    });

    t.test('el logo es un adorno y lo que el preview no usa ni se pide', () => {
        // Sin logo la clase se revisa igual. `livemix` es para el render final:
        // ni se exige ni se le habilita al protocolo.
        const { dir } = carpetaDeEdicion('edicion-logo', {
            media: {
                ...receta().media,
                logo: { file: 'assets/logo.png', pos: [0, 0] },
                livemix: { file: 'media/livemix.m4a' }
            }
        });
        const r = edicion.leer(dir);
        t.ok(r.ok, r.error || '');
        t.deep(r.faltan, ['assets/logo.png']);
        t.ok(!r.edicion.medios.livemix, 'livemix no entra');
        t.ok(!r.edicion.archivos.some(a => a.includes('livemix')));
    });

    t.test('las imágenes fijas las lista la lectura, no el que las carga', () => {
        const { dir } = carpetaDeEdicion('edicion-imagenes');
        const r = edicion.leer(dir);
        t.deep(r.edicion.imagenes.map(a => path.relative(dir, a)).sort(), ['assets/boxmask.png', 'assets/boxring.png']);
    });

    t.test('la lista blanca del protocolo lleva solo archivos que existen', () => {
        // Habilitarle al protocolo una ruta muerta es guardar un permiso sobre
        // algo que no está, y el día que aparezca un archivo con ese nombre
        // queda servido sin que nadie lo haya decidido.
        const { dir } = carpetaDeEdicion('edicion-permisos', null, { sinArchivos: ['assets/boxring.png'] });
        const r = edicion.leer(dir);
        t.ok(r.ok);
        t.ok(r.edicion.archivos.every(a => fs.existsSync(a)), 'todas existen');
        t.ok(!r.edicion.archivos.some(a => a.endsWith('boxring.png')), 'la que falta no está');
    });

    t.grupo('Edición (cómo entra en la lista de clases)');

    t.test('el feedback de una edición va adentro de su carpeta', () => {
        // Y no al lado con el nombre del archivo, que es la regla para un
        // render. `edit.json` daría una carpeta `edit/`, que no dice nada.
        const { dir } = carpetaDeEdicion('edicion-feedback');
        const ruta = path.join(dir, 'edit.json');
        t.eq(workspace.carpetaDeVersion(ruta), path.join(dir, 'feedback'));
        t.eq(workspace.archivosDeVersion(ruta).comentarios, path.join(dir, 'feedback', 'comentarios.json'));
    });

    t.test('una edición aparece como versión de la clase del render que reemplaza', async () => {
        const { curso, dir } = carpetaDeEdicion('edicion-clase');
        const leido = await versiones.escanear(curso);

        t.eq(leido.clases.length, 1);
        const clase = leido.clases[0];
        t.eq(clase.nombre, '03_Curso_p3', 'el nombre sale de based_on');
        t.eq(clase.versiones.length, 1);
        t.eq(clase.versiones[0].n, 3);
        t.eq(clase.versiones[0].edicion, true);
        t.eq(clase.versiones[0].ruta, path.join(dir, 'edit.json'));
        t.eq(clase.versiones[0].archivo, 'Clase prueba', 'se muestra el nombre de la carpeta');
    });

    t.test('la edición se abre después del render del que salió', async () => {
        // Es posterior: propone cambiarlo. Y como la que se abre al entrar es
        // la última, entrar a la clase lleva a lo que está esperando
        // respuesta.
        const { curso } = carpetaDeEdicion('edicion-orden');
        temporal.archivo(curso, '03_Curso_p3_v3.mp4');

        const leido = await versiones.escanear(curso);
        const clase = leido.clases.find(c => c.id === '03_curso_p3');
        t.eq(clase.versiones.length, 2);
        t.eq(Boolean(clase.versiones[0].edicion), false, 'primero el render');
        t.eq(clase.versiones[1].edicion, true, 'después la edición');
        t.eq(clase.ultima.edicion, true);
    });

    t.test('una edición rota se muestra en la lista con el motivo', async () => {
        // Que no se pueda abrir no es razón para que la clase desaparezca: sin
        // el renglón, el editor no tiene dónde enterarse de que hay algo mal.
        const { curso } = carpetaDeEdicion('edicion-lista-rota', null, { sinArchivos: ['media/mix.m4a'] });
        const leido = await versiones.escanear(curso);
        t.eq(leido.clases.length, 1);
        const v = leido.clases[0].versiones[0];
        t.eq(v.media.ok, false);
        t.tiene(v.media.error, 'media/mix.m4a');
    });

    t.test('una edición rota cae en el renglón de SU clase, no en uno aparte', async () => {
        // Con el render al lado: el caso real. Antes, al fallar la lectura se
        // perdía el `based_on` y la edición aparecía como una clase nueva con
        // el nombre de la carpeta, que es justo esconder que algo está mal.
        const { curso } = carpetaDeEdicion('edicion-rota-con-render', null, { sinArchivos: ['media/cam.mp4'] });
        temporal.archivo(curso, '03_Curso_p3_v3.mp4');
        const leido = await versiones.escanear(curso);
        t.eq(leido.clases.length, 1, 'una sola clase');
        const rota = leido.clases[0].versiones.find(v => v.edicion);
        t.eq(rota.media.ok, false);
        t.eq(rota.n, 3);
    });

    t.test('una edición se nombra como edición de su render, no como su render', async () => {
        // Es lo que lee Claude en el feedback y en el export. «v3» la haría
        // indistinguible del render que propone cambiar.
        const { curso, dir } = carpetaDeEdicion('edicion-etiqueta');
        temporal.archivo(curso, '03_Curso_p3_v3.mp4');
        const leido = await versiones.escanear(curso);
        const [render, ed] = leido.clases[0].versiones;
        t.eq(render.etiqueta, 'v3');
        t.eq(ed.etiqueta, 'edición de la v3');

        // Y lo que llega nuevo al disco también: partir `edit.json` por el
        // nombre daba una clase «edit» que no existe.
        const nueva = versiones.claseDeRuta(path.join(dir, 'edit.json'));
        t.eq(nueva.clase, '03_Curso_p3');
        t.eq(nueva.n, 3);
    });

    t.test('el export dice que lo último de la clase es una edición', async () => {
        // Comentarios del render que quedaron abiertos cuando ya hay una
        // edición encima: el aviso tiene que nombrar la edición, no decir «de
        // la v3 y ya hay una v3».
        const { curso } = carpetaDeEdicion('edicion-export');
        const render = temporal.archivo(curso, '03_Curso_p3_v3.mp4');
        comentarios.agregar(render, { t: 1, texto: 'Bajale a la música' }, { rutaVideo: render, media: temporal.media() });

        const leido = await versiones.escanear(curso);
        const r = exportar.exportar(curso, leido.clases);
        t.ok(r.ok, r.error || '');
        t.tiene(fs.readFileSync(r.documento, 'utf8'), 'ya hay una **edición de la v3**');
    });

    t.test('cambiar el texto general reescribe también el feedback de una edición', () => {
        // El feedback de una edición vive un nivel más adentro que el de un
        // render, y recorriendo la raíz no aparecía: quedaba con el texto
        // general viejo copiado adentro.
        const { curso, dir } = carpetaDeEdicion('edicion-general');
        const ruta = path.join(dir, 'edit.json');
        comentarios.agregar(ruta, { t: 1, texto: 'Este corte entra tarde' }, { rutaVideo: ruta, media: temporal.media() });

        general.guardar(curso, 'Los títulos van en minúscula.');
        const md = fs.readFileSync(workspace.archivosDeVersion(ruta).feedback, 'utf8');
        t.tiene(md, 'Los títulos van en minúscula.');
        t.tiene(md, '03_Curso_p3 · edición de la v3');
    });

    t.test('abrir directo la carpeta de una clase también funciona', async () => {
        const { dir } = carpetaDeEdicion('edicion-directa');
        const leido = await versiones.escanear(dir);
        t.eq(leido.clases.length, 1);
        t.eq(leido.clases[0].versiones[0].edicion, true);
    });

    t.test('el vigía cuenta la edición entre lo que hay en disco', () => {
        const { curso, dir } = carpetaDeEdicion('edicion-vigia');
        t.ok(versiones.rutasEnDisco(curso).includes(path.join(dir, 'edit.json')));
    });

    t.test('sin based_on la clase se llama como la carpeta', async () => {
        const { curso } = carpetaDeEdicion('edicion-sin-base', { based_on: null });
        const leido = await versiones.escanear(curso);
        t.eq(leido.clases[0].nombre, 'Clase prueba');
    });
};
