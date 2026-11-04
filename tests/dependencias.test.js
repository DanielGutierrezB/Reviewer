'use strict';
/**
 * Lo que la app necesita de la Mac y cómo ofrece instalarlo.
 *
 * Lo que de verdad hay en esta Mac no se puede fijar desde un test, así que
 * lo que se prueba es la forma de la lista —que es lo que la ventana pinta— y
 * la regla de qué botón se ofrece en cada caso, que es pura y se puede probar
 * entera.
 */

const dependencias = require('../engine/dependencias');

module.exports = function (t) {
    t.grupo('Dependencias de esta Mac');

    t.test('cada entrada dice qué es, para qué sirve y si es imprescindible', () => {
        for (const d of dependencias.LISTA) {
            t.ok(d.clave && d.nombre && d.para, `${d.clave}: nombre y para qué`);
            t.eq(typeof d.requerida, 'boolean', `${d.clave}: requerida es sí o no`);
        }
        // Solo lo que impide abrir una carpeta es imprescindible. Lo demás
        // apaga una función y la app sigue sirviendo para comentar.
        t.deep(dependencias.LISTA.filter(d => d.requerida).map(d => d.clave).sort(), ['ffmpeg', 'ffprobe']);
    });

    t.test('el estado dice si está, dónde, y una acción solo cuando falta', () => {
        for (const f of dependencias.estado()) {
            t.eq(typeof f.esta, 'boolean');
            if (f.esta) {
                t.ok(f.donde, `${f.clave} dice dónde está`);
                t.eq(f.accion, null, `${f.clave} no ofrece instalar lo que ya está`);
            } else {
                t.ok(f.accion && f.accion.tipo, `${f.clave} dice cómo se instala`);
            }
        }
    });

    t.test('qué botón se ofrece depende de la cosa y de si hay Homebrew', () => {
        const de = clave => dependencias.LISTA.find(d => d.clave === clave);
        t.eq(dependencias.accionDe(de('modelo-dictado')).tipo, 'descargar');
        t.ok(/488 MB/.test(dependencias.accionDe(de('modelo-dictado')).etiqueta), 'y dice cuánto pesa');
        t.eq(dependencias.accionDe(de('python3')).tipo, 'xcode', 'Python viene con las herramientas de Apple');
        t.eq(dependencias.accionDe(de('tesseract'), { hayBrew: true }).tipo, 'brew');
        t.eq(dependencias.accionDe(de('tesseract'), { hayBrew: false }).tipo, 'homebrew', 'sin Homebrew, primero Homebrew');
        t.eq(dependencias.accionDe(de('ffmpeg'), { hayBrew: true }).tipo, 'brew');
        // whisper-server se compila para la app: no hay fórmula que sirva.
        const w = dependencias.accionDe(de('whisper-server'), { hayBrew: true });
        t.eq(w.tipo, 'reinstalar');
        t.eq(w.etiqueta, null, 'y por eso no hay botón, solo la explicación');
    });

    t.test('lo que pide contraseña lo dice antes de que se apriete', () => {
        const de = clave => dependencias.LISTA.find(d => d.clave === clave);
        t.ok(/contraseña/.test(dependencias.accionDe(de('tesseract'), { hayBrew: false }).nota));
        t.ok(/instalador de Apple/.test(dependencias.accionDe(de('python3')).nota));
    });

    t.test('alcanza para abrir una carpeta solo con lo requerido presente', () => {
        const filas = [
            { clave: 'ffmpeg', requerida: true, esta: true },
            { clave: 'ffprobe', requerida: true, esta: true },
            { clave: 'tesseract', requerida: false, esta: false }
        ];
        t.eq(dependencias.alcanza(filas), true, 'sin tesseract se revisa igual');
        filas[1].esta = false;
        t.eq(dependencias.alcanza(filas), false, 'sin ffprobe no');
    });

    t.test('el modelo que se baja es exactamente el que se midió', () => {
        const m = dependencias.MODELOS['ggml-small.bin'];
        t.ok(/^[0-9a-f]{64}$/.test(m.sha256), 'con su SHA-256 escrito');
        t.ok(m.bytes > 400e6 && m.bytes < 600e6, 'y su peso, para la etiqueta y la barra');
    });
};
