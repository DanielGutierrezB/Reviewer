'use strict';
/**
 * Leer el taller de Claude: dónde está, si hay alguien trabajando y en qué.
 *
 * Los archivos no son invento nuestro —son los que `mac_worker.sh` y `step.py`
 * ya escribían—, así que estos tests arman un taller de mentira con ese mismo
 * formato. Si Claude cambia el protocolo, acá se nota.
 */

const fs = require('fs');
const path = require('path');

const taller = require('../engine/taller');
const progreso = require('../engine/progreso');
const temporal = require('./lib/temporal');

/** Un taller con una cola de trabajos, como el de un curso de verdad. */
function armar(nombre, { trabajos = [], estado = {}, cola = 'jobs8.json', log = '' } = {}) {
    const curso = temporal.carpeta(nombre);
    const dir = path.join(curso, '_claude_edit');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'step.py'), '# de mentira');
    fs.writeFileSync(path.join(dir, 'macworker_jobs.txt'), `${cola}\n`);
    fs.writeFileSync(path.join(dir, cola), JSON.stringify(trabajos));
    fs.writeFileSync(path.join(dir, 'step_status.json'), JSON.stringify(estado));
    if (log) fs.writeFileSync(path.join(dir, 'macworker.log'), log);
    return { curso, dir };
}

/** Un plan con N tomas, o con las tomas que se le pasen. */
function plan(dir, nombre, tomas, hechas = 0) {
    fs.mkdirSync(path.join(dir, 'v7'), { recursive: true });
    const shots = Array.isArray(tomas) ? tomas : Array.from({ length: tomas }, () => ({}));
    fs.writeFileSync(path.join(dir, 'v7', nombre), JSON.stringify({ shots }));
    return `v7/${nombre}`;
}

function segmentos(dir, seg, hechas) {
    fs.mkdirSync(path.join(dir, seg), { recursive: true });
    for (let i = 0; i < hechas; i++) fs.writeFileSync(path.join(dir, seg, `${String(i).padStart(4, '0')}.mp4`), 'x');
}

const latir = (dir, hace = 0) =>
    fs.writeFileSync(path.join(dir, 'macworker.alive'), String(Math.floor((Date.now() - hace) / 1000)));

module.exports = async function (t) {
    t.grupo('El taller de Claude: encontrarlo y leerlo');

    t.test('se encuentra desde la carpeta de renders, dos niveles más abajo', () => {
        const { curso, dir } = armar('taller-buscar');
        const v2 = path.join(curso, 'Clases_Finales', 'V2');
        fs.mkdirSync(v2, { recursive: true });
        t.eq(taller.buscar(v2), dir, 'abrir V2 encuentra el taller en la raíz del curso');
        t.eq(taller.buscar(curso), dir, 'y abrir la raíz también');
    });

    t.test('una carpeta sin taller no inventa uno de otro curso', () => {
        // Sin tope, subir hasta la raíz del disco podría encontrar el taller de
        // un curso vecino y lanzarle un worker encima.
        const suelta = temporal.carpeta('taller-sin');
        t.eq(taller.buscar(suelta), null);
    });

    t.test('un _claude_edit a medio copiar no cuenta como taller', () => {
        const curso = temporal.carpeta('taller-incompleto');
        fs.mkdirSync(path.join(curso, '_claude_edit'), { recursive: true });
        fs.writeFileSync(path.join(curso, '_claude_edit', 'step.py'), '# sin cola');
        t.eq(taller.buscar(curso), null, 'sin el apuntador a la cola no hay nada que correr');
    });

    t.test('el worker está vivo según su latido, no según la fecha del archivo', () => {
        const { dir } = armar('taller-vivo');
        t.eq(taller.vivo(dir), false, 'sin latido no hay nadie');
        latir(dir);
        t.eq(taller.vivo(dir), true);
        // Un respaldo que toca el archivo le cambia la fecha pero no lo que
        // dice adentro: el worker de ayer tiene que seguir viéndose muerto.
        latir(dir, 10 * 60 * 1000);
        fs.utimesSync(path.join(dir, 'macworker.alive'), new Date(), new Date());
        t.eq(taller.vivo(dir), false, 'diez minutos sin latir es un worker muerto');
    });

    t.test('el progreso del render se cuenta en tomas terminadas', () => {
        const { dir } = armar('taller-progreso', {
            trabajos: [{ name: 'V2/09_curso_V2_v4.mp4', tag: 'c9', seg: 'segs_c9', plan: 'v7/plan_c9.json' }],
            estado: { 'V2/09_curso_V2_v4.mp4': { stage: 'render' } }
        });
        plan(dir, 'plan_c9.json', 80);
        segmentos(dir, 'segs_c9', 34);
        // Una toma a medio escribir es `0034.tmp.mp4` y no cuenta hasta que
        // `render7.py` la renombra. Si contara, la barra iría más adelante de
        // lo que está y al final sobraría una.
        fs.writeFileSync(path.join(dir, 'segs_c9', '0034.tmp.mp4'), 'x');

        // Con el worker apagado un trabajo a medias no es trabajo en curso:
        // la insignia decía «trabajando · 0 %» con el render en pausa.
        const quieto = taller.estadoDe(dir);
        t.eq(taller.resumen(quieto).tono, 'nada');
        t.eq(taller.resumen(quieto).texto, 'En pausa · 1 por hacer');

        latir(dir);
        const e = taller.estadoDe(dir);
        t.deep(e.trabajos[0].tomas, { hechas: 34, total: 80 });
        t.eq(e.actual.clase, '09_curso_V2_v4', 'la clase se nombra como en la lista');
        t.eq(taller.resumen(e).texto, '09_curso_V2_v4 · Render · 34 de 80 tomas');
        // El porcentaje es del trabajo entero y no del render solo: el OCR ya
        // pasó, y lo que falta después del render también cuenta.
        const { ocr, render } = progreso.PESOS;
        t.eq(taller.resumen(e).porcentaje, Math.round(ocr + render * 34 / 80));
    });

    t.test('la barra avanza por etapas, pesadas por lo que tarda cada una', () => {
        // Repartir en partes iguales haría que el render —que es casi todo el
        // tiempo de reloj— pareciera un séptimo del trabajo.
        const { dir } = armar('taller-pesos', {
            trabajos: [{ name: 'a.mp4', tag: 'a', seg: 'segs_a', plan: 'v7/p.json' }],
            estado: { 'a.mp4': { stage: 'qa' } }
        });
        plan(dir, 'p.json', 10);
        segmentos(dir, 'segs_a', 10);

        const e = taller.estadoDe(dir);
        const P = progreso.PESOS;
        const antesDeQa = (P.ocr + P.render + P.audio + P.video + P.mux) / 100;
        t.eq(e.trabajos[0].progreso.fraccion, antesDeQa, 'en revisión ya está todo menos revisar');
        t.ok(P.render > P.ocr + P.audio + P.video + P.mux + P.qa, 'el render pesa más que todo el resto junto');
    });

    t.test('la revisión no inventa avance mientras lee el archivo', () => {
        // `qa2.py` lee el video entero sin escribir nada, así que no hay nada
        // que medir. La barra se queda quieta en el borde de la etapa en vez
        // de arrastrarse sola hasta el 99%, que es la mentira de siempre.
        const { dir } = armar('taller-qa-quieta', {
            trabajos: [{ name: 'a.mp4', tag: 'a', seg: 'segs_a', plan: 'v7/p.json' }],
            estado: { 'a.mp4': { stage: 'qa' } }
        });
        plan(dir, 'p.json', 10);
        segmentos(dir, 'segs_a', 10);
        const antes = taller.estadoDe(dir).trabajos[0].progreso.fraccion;
        const despues = taller.estadoDe(dir).trabajos[0].progreso.fraccion;
        t.eq(antes, despues, 'dos lecturas seguidas dan lo mismo');
        t.eq(taller.estadoDe(dir).trabajos[0].progreso.detalle, null, 'y no se muestra un número falso');
    });

    t.test('el OCR avanza con los tramos que anota ocrplan3', () => {
        // El script guarda cuántos tramos lleva, pero no cuántos hay: el total
        // se recalcula del plan con la misma regla que usa él.
        const pantalla = (src, segundos) => ({ layout: 'SCREEN', src, nf: segundos * 30 });
        const { dir } = armar('taller-ocr', {
            trabajos: [{ name: 'a.mp4', tag: 'a', seg: 'segs_a', plan: 'v7/plan_c1.json' }],
            estado: { 'a.mp4': { stage: 'ocr' } }
        });
        // Un tramo de 100 s se parte en 45+45+10; el de 20 s es uno solo.
        plan(dir, 'plan_c1.json', [pantalla(0, 100), { layout: 'CAM', src: 200, nf: 300 }, pantalla(400, 20)]);
        fs.writeFileSync(path.join(dir, 'v7', 'ocr3_c1.json'), JSON.stringify({ done: 2 }));

        const j = taller.estadoDe(dir).trabajos[0];
        t.eq(j.progreso.detalle, '2 de 4 tramos');
        t.eq(j.progreso.fraccion, progreso.PESOS.ocr * (2 / 4) / 100);
    });

    t.test('las tomas sin pantalla no generan tramos de OCR', () => {
        t.eq(progreso.tramosDeOCR([{ layout: 'CAM', src: 0, nf: 3000 }]), 0);
        // Dos pantallas pegadas son un tramo solo: `ocrplan3.py` las junta si
        // están a menos de 0,6 s una de otra.
        t.eq(progreso.tramosDeOCR([
            { layout: 'SCREEN', src: 0, nf: 300 },
            { layout: 'SCREEN', src: 10.2, nf: 300 }
        ]), 1, 'diez segundos y pico entran en un tramo de 45');
    });

    t.test('la unión se mide en bytes escritos, que es exactamente lo que va', () => {
        // Concatenar es copiar los segmentos tal cual, así que el archivo
        // final pesa lo que pesan todos juntos y lo escrito ES el avance.
        const { dir } = armar('taller-union', {
            trabajos: [{ name: 'a.mp4', tag: 'tg', seg: 'segs_a', plan: 'v7/p.json' }],
            estado: { 'a.mp4': { stage: 'video' } }
        });
        plan(dir, 'p.json', 4);
        fs.mkdirSync(path.join(dir, 'segs_a'), { recursive: true });
        for (let i = 0; i < 4; i++) {
            fs.writeFileSync(path.join(dir, 'segs_a', `${String(i).padStart(4, '0')}.mp4`), 'x'.repeat(100));
        }
        fs.writeFileSync(path.join(dir, 'tg_video.mp4'), 'x'.repeat(100));

        const j = taller.estadoDe(dir).trabajos[0];
        t.eq(j.progreso.detalle, '25%', 'un cuarto de los bytes');
    });

    t.test('un trabajo con error trae el motivo, que solo está en el log', () => {
        // `step_status.json` guarda que falló, nunca por qué. El motivo es lo
        // único que sirve para arreglarlo, y vive en el log.
        const nombre = 'V2/_x/02a3.mp4';
        const { dir } = armar('taller-error', {
            trabajos: [{ name: nombre, tag: 'x', seg: 'segs_x', plan: 'v7/plan_x.json' }],
            estado: { [nombre]: { stage: 'error' } },
            log: [
                `${nombre} ERROR primera vez que falló`,
                'otra cosa cualquiera',
                `${nombre} ERROR [Errno 2] No such file or directory`,
                // El worker escribe un STATUS cada quince segundos pase lo que
                // pase, así que para cuando uno mira, el motivo quedó cientos
                // de kilobytes atrás. En el taller real estaba a 300 KB.
                ...Array.from({ length: 12000 }, () => `STATUS {'${nombre}': 'error'} 0`)
            ].join('\n')
        });
        plan(dir, 'plan_x.json', 5);

        const e = taller.estadoDe(dir);
        t.eq(e.errores.length, 1);
        t.eq(e.trabajos[0].error, '[Errno 2] No such file or directory', 'el último intento, no el primero');
        t.eq(e.actual, null, 'un trabajo en error no es trabajo en curso');
        t.eq(taller.resumen(e).tono, 'mal');
    });

    t.test('el error se muestra aunque otra clase esté renderizando bien', () => {
        const { dir } = armar('taller-prioridad', {
            trabajos: [
                { name: 'a.mp4', tag: 'a', seg: 'segs_a', plan: 'v7/p.json' },
                { name: 'b.mp4', tag: 'b', seg: 'segs_b', plan: 'v7/p.json' }
            ],
            estado: { 'a.mp4': { stage: 'error' }, 'b.mp4': { stage: 'render' } }
        });
        plan(dir, 'p.json', 10);
        latir(dir);
        t.eq(taller.resumen(taller.estadoDe(dir)).tono, 'mal', 'es lo único que pide una decisión');
    });

    t.test('sin trabajo pendiente la insignia distingue apagado de esperando', () => {
        const { dir } = armar('taller-espera', {
            trabajos: [{ name: 'a.mp4', tag: 'a', seg: 'segs_a', plan: 'v7/p.json' }],
            estado: { 'a.mp4': { stage: 'delivered', qa: { PASS: true } } }
        });
        plan(dir, 'p.json', 10);
        t.eq(taller.resumen(taller.estadoDe(dir)).tono, 'nada');
        latir(dir);
        const e = taller.estadoDe(dir);
        t.eq(taller.resumen(e).tono, 'espera');
        t.eq(e.entregados.length, 1, 'y lo entregado queda a la vista con su control de calidad');
        t.eq(e.entregados[0].qa.PASS, true);
    });

    t.test('las partes de una clase se juntan en un grupo con su avance', () => {
        // La pregunta que se hace quien espera una clase es «¿ya está?», y
        // una clase partida en tres son tres trabajos sueltos en la cola.
        const { dir } = armar('taller-partes', {
            trabajos: [
                { name: 'V2/06_curso_p2_V2_v3.mp4', tag: 'b', seg: 'segs_b', plan: 'v7/p.json' },
                { name: 'V2/06_curso_p1_V2_v3.mp4', tag: 'a', seg: 'segs_a', plan: 'v7/p.json' }
            ],
            estado: {
                'V2/06_curso_p1_V2_v3.mp4': { stage: 'delivered' },
                'V2/06_curso_p2_V2_v3.mp4': { stage: 'render' }
            }
        });
        plan(dir, 'p.json', 10);
        segmentos(dir, 'segs_b', 5);

        const g = taller.estadoDe(dir).grupos;
        t.eq(g.length, 1, 'las dos partes son una sola clase');
        t.eq(g[0].clase, '06_curso_V2', 'el nombre es el de la clase, sin la marca de parte');
        t.eq(g[0].version, 3);
        t.deep(g[0].partes.map(j => j.parte), ['p1', 'p2'], 'ordenadas por parte y no por la cola');
        t.eq(g[0].estado, 'trabajando');
        t.eq(g[0].etapa, 'render', 'la etapa es la de la parte más atrasada');

        const P = progreso.PESOS;
        const dos = (P.ocr + P.render * 0.5) / 100;
        t.eq(g[0].fraccion, (1 + dos) / 2, 'el avance de la clase es el promedio de sus partes');
    });

    t.test('dos versiones de la misma clase no comparten barra', () => {
        // Mezclarlas diría que la v6 va por la mitad porque la v5 ya salió.
        const { dir } = armar('taller-versiones', {
            trabajos: [
                { name: '07_curso_v5.mp4', tag: 'a', seg: 's', plan: 'v7/p.json' },
                { name: '07_curso_v6.mp4', tag: 'b', seg: 's', plan: 'v7/p.json' }
            ],
            estado: { '07_curso_v5.mp4': { stage: 'delivered' }, '07_curso_v6.mp4': { stage: 'ocr' } }
        });
        plan(dir, 'p.json', 10);

        const g = taller.estadoDe(dir).grupos;
        t.eq(g.length, 2);
        t.deep(g.map(x => x.version).sort(), [5, 6]);
    });

    t.test('una clase con una parte en error se marca en error, no trabajando', () => {
        const { dir } = armar('taller-grupo-error', {
            trabajos: [
                { name: '08_curso_p1_v2.mp4', tag: 'a', seg: 's', plan: 'v7/p.json' },
                { name: '08_curso_p2_v2.mp4', tag: 'b', seg: 's', plan: 'v7/p.json' }
            ],
            estado: { '08_curso_p1_v2.mp4': { stage: 'error' }, '08_curso_p2_v2.mp4': { stage: 'render' } }
        });
        plan(dir, 'p.json', 10);
        const g = taller.estadoDe(dir).grupos[0];
        t.eq(g.estado, 'error', 'lo que pide una decisión gana');
        t.eq(g.errores, 1);
    });

    t.test('un trabajo cortado conserva el avance que había hecho', () => {
        // Ponerlo en cero escondería que había renderizado 116 tomas antes de
        // fallar en el último paso, que es justo lo que dice si vale la pena
        // reintentarlo o rehacerlo.
        const { dir } = armar('taller-error-avance', {
            trabajos: [{ name: 'a.mp4', tag: 'a', seg: 'segs_a', plan: 'v7/p.json' }],
            estado: { 'a.mp4': { stage: 'error' } }
        });
        plan(dir, 'p.json', 10);
        segmentos(dir, 'segs_a', 10);
        t.ok(taller.estadoDe(dir).trabajos[0].progreso.fraccion > 0.5);
    });

    t.test('las tareas sueltas se leen por su extensión', () => {
        // `step.py` renombra el `.sh` a `.run` mientras corre y a `.done` al
        // terminar, así que la extensión ES el estado.
        const { dir } = armar('taller-tareas');
        const tareas = path.join(dir, 'mac_tasks');
        fs.mkdirSync(tareas, { recursive: true });
        fs.writeFileSync(path.join(tareas, '10_escenas.done'), '');
        fs.writeFileSync(path.join(tareas, '20_asr.run'), '');
        fs.writeFileSync(path.join(tareas, '20_asr.log'), 'transcribiendo\nva por la mitad\n');
        fs.writeFileSync(path.join(tareas, '30_concat.sh'), '');

        const r = taller.estadoDe(dir).tareas;
        t.deep(r.pendientes, ['30_concat']);
        t.eq(r.corriendo.nombre, '20_asr');
        t.eq(r.corriendo.ultima, 'va por la mitad', 'con la última línea de su log, que es lo que dice cómo va');
        t.deep(r.hechas, ['10_escenas']);
    });

    t.test('del log gigante solo se lee el final', () => {
        // Doce mil renglones y creciendo, releído cada pocos segundos: leerlo
        // entero serían megabytes por minuto para mostrar diez líneas.
        const { dir } = armar('taller-log');
        const ruta = path.join(dir, 'macworker.log');
        fs.writeFileSync(ruta, Array.from({ length: 20000 }, (_, i) => `renglon ${i}`).join('\n'));
        const leido = taller.colaDe(ruta);
        t.ok(leido.length < 20000, 'no se leyó entero');
        t.eq(leido[leido.length - 1], 'renglon 19999', 'pero el final está completo');
        t.eq(taller.estadoDe(dir).log.length, 12);
    });

    t.test('un taller a medio arrancar se lee sin reventar', () => {
        // Primera vez en un curso: están los scripts y no hay nada más.
        const curso = temporal.carpeta('taller-vacio');
        const dir = path.join(curso, '_claude_edit');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'step.py'), '#');
        fs.writeFileSync(path.join(dir, 'macworker_jobs.txt'), 'jobs8.json\n');

        const e = taller.estadoDe(dir);
        t.deep(e.trabajos, []);
        t.eq(e.actual, null);
        t.eq(e.vivo, false);
        t.eq(taller.resumen(e).tono, 'nada');
    });
};
