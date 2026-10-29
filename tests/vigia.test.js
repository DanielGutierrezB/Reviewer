'use strict';
/**
 * El vigía: qué cuenta como novedad mientras Claude trabaja al lado.
 *
 * Lo que se prueba acá es la decisión —qué es nuevo, qué es una mudanza, qué
 * todavía se está escribiendo—, que es lo único que puede estar mal de un modo
 * que nadie note: un falso aviso se ve y se ignora, pero un render que llegó y
 * no avisó deja al editor mirando la lista de hace una hora.
 */

const fs = require('fs');
const path = require('path');

const vigia = require('../engine/vigia');
const workspace = require('../engine/workspace');
const temporal = require('./lib/temporal');

module.exports = async function (t) {
    t.grupo('Vigía: qué cambió');

    t.test('lo que aparece es nuevo y lo que se va es un faltante', () => {
        const r = vigia.comparar(['/r/a.mp4', '/r/b.mp4'], ['/r/b.mp4', '/r/c.mp4']);
        t.deep(r.nuevas, ['/r/c.mp4']);
        t.deep(r.faltantes, ['/r/a.mp4']);
        t.deep(r.movidas, []);
    });

    t.test('archivar una versión es una mudanza, no una entrega', () => {
        // El caso de todos los días con `Pre versions`: el mismo archivo
        // cambia de carpeta. Hay que releer, pero esa clase no tiene nada
        // nuevo para mirar y no se puede pintar como si lo tuviera.
        const r = vigia.comparar(
            ['/r/Clase 01 v2.mp4'],
            ['/r/Pre versions/Clase 01 v2.mp4']
        );
        t.deep(r.nuevas, []);
        t.deep(r.faltantes, []);
        t.eq(r.movidas.length, 1);
        t.eq(r.movidas[0].de, '/r/Clase 01 v2.mp4');
        t.eq(r.movidas[0].a, '/r/Pre versions/Clase 01 v2.mp4');
    });

    t.test('la entrega que archiva la anterior es las dos cosas', () => {
        // Lo que de verdad hace Claude: deja la v3 y manda la v2 adentro. Una
        // novedad y una mudanza en el mismo movimiento.
        const r = vigia.comparar(
            ['/r/Clase 01 v2.mp4'],
            ['/r/Clase 01 v3.mp4', '/r/Pre versions/Clase 01 v2.mp4']
        );
        t.deep(r.nuevas, ['/r/Clase 01 v3.mp4']);
        t.eq(r.movidas.length, 1);
        t.deep(r.faltantes, []);
    });

    t.test('sin cambios no hay nada de nada', () => {
        const r = vigia.comparar(['/r/a.mp4'], ['/r/a.mp4']);
        t.deep([r.nuevas, r.movidas, r.faltantes], [[], [], []]);
    });

    t.grupo('Vigía: esperar a que el archivo esté escrito');

    t.test('un archivo que todavía crece no se reporta', () => {
        // `fs.watch` avisa al crearse, no al terminar. Medir un render a medio
        // escribir da una duración corta que se queda en la lista hasta la
        // próxima recarga a mano.
        const dir = temporal.carpeta('vigia-creciendo');
        const ruta = temporal.archivo(dir, 'Clase 01.mp4', 'a'.repeat(100));

        const primera = vigia.asentadas([ruta], new Map());
        t.deep(primera.quietas, [], 'la primera vez no hay con qué comparar');
        t.eq(primera.creciendo, true);

        fs.appendFileSync(ruta, 'b'.repeat(900));
        const segunda = vigia.asentadas([ruta], primera.tamanos);
        t.deep(segunda.quietas, [], 'creció entre una mirada y la otra');
        t.eq(segunda.creciendo, true);

        const tercera = vigia.asentadas([ruta], segunda.tamanos);
        t.deep(tercera.quietas, [ruta], 'quieta: ya se puede medir');
        t.eq(tercera.creciendo, false);
    });

    t.test('un archivo de cero bytes no cuenta como escrito', () => {
        // El primer instante de una copia: el archivo existe y está vacío.
        const dir = temporal.carpeta('vigia-vacio');
        const ruta = temporal.archivo(dir, 'Clase 01.mp4', '');
        const primera = vigia.asentadas([ruta], new Map());
        const segunda = vigia.asentadas([ruta], primera.tamanos);
        t.deep(segunda.quietas, [], 'cero bytes sigue sin ser un render');
    });

    t.test('un archivo que se borró entre el readdir y el stat no explota', () => {
        t.deep(vigia.asentadas(['/no/existe/esto.mp4'], new Map()).quietas, []);
    });

    t.grupo('Vigía: mirando una carpeta de verdad');

    t.test('ve la entrega nueva, incluida la que cae en Pre versions', () => {
        const dir = temporal.carpeta('vigia-disco');
        const v2 = temporal.archivo(dir, 'Clase 01 v2.mp4', 'x'.repeat(50));

        // Lo que la ventana ya tiene cargado. No cambia en este test: es
        // justamente lo que pasa mientras el editor no recarga.
        const conocidas = () => [v2];

        const avisos = [];
        const ojo = vigia.mirar(dir, conocidas, aviso => avisos.push(aviso));

        try {
            temporal.archivo(dir, 'Clase 01 v3.mp4', 'y'.repeat(50));
            temporal.archivo(dir, `${workspace.PREVIAS_DIR}/Clase 01.mp4`, 'z'.repeat(50));

            ojo.revisar(); // primera pasada: los dos recién aparecieron
            t.deep(avisos, [], 'todavía no, hasta saber que dejaron de crecer');

            ojo.revisar(); // segunda: siguen pesando lo mismo
            t.eq(avisos.length, 1, 'un solo aviso con las dos');
            t.deep(avisos[0].nuevas.map(r => path.basename(r)).sort(),
                ['Clase 01 v3.mp4', 'Clase 01.mp4']);

            ojo.revisar();
            t.eq(avisos.length, 1, 'y no se repite el mismo aviso');
        } finally {
            ojo.parar();
        }
    });

    t.test('parar deja de avisar', () => {
        const dir = temporal.carpeta('vigia-parar');
        const avisos = [];
        const ojo = vigia.mirar(dir, () => [], aviso => avisos.push(aviso));
        ojo.parar();

        temporal.archivo(dir, 'Clase 01.mp4', 'x');
        ojo.revisar();
        ojo.revisar();
        t.deep(avisos, []);
    });

    t.test('una carpeta que no está no tumba nada', () => {
        const ojo = vigia.mirar('/no/existe/esto', () => [], () => {
            t.ok(false, 'no debería avisar de una carpeta que no está');
        });
        ojo.revisar();
        ojo.parar();
        t.ok(true, 'ni al mirarla ni al revisarla');
    });
};
