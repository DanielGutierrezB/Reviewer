'use strict';
/**
 * Cómo se agrupan las versiones. Es lo primero que hace la app al abrir una
 * carpeta y de lo que dependen todas las pantallas.
 */

const path = require('path');

const versiones = require('../engine/versiones');

module.exports = function (t) {
    t.grupo('Versiones: partir el nombre');

    t.test('sin sufijo es la v1', () => {
        t.deep(versiones.partir('Clase 03 - Hooks'), { clase: 'Clase 03 - Hooks', version: 1, explicita: false });
    });

    t.test('los tres separadores valen', () => {
        for (const nombre of ['Clase 03 v2', 'Clase 03_v2', 'Clase 03-v2']) {
            const r = versiones.partir(nombre);
            t.eq(r.version, 2, nombre);
            t.eq(r.clase, 'Clase 03', nombre);
        }
    });

    t.test('la V mayúscula también', () => {
        t.eq(versiones.partir('Intro V12').version, 12);
    });

    t.test('un número pegado a una palabra NO es una versión', () => {
        // «Entrevista Nivel 2» leída como la versión 2 de «Entrevista Nivel»
        // partiría en dos una clase que no tiene versiones.
        t.deep(versiones.partir('Entrevista Nivel 2'), { clase: 'Entrevista Nivel 2', version: 1, explicita: false });
    });

    t.test('el guion del nombre no se come', () => {
        const r = versiones.partir('Clase 03 - Hooks - v4');
        t.eq(r.clase, 'Clase 03 - Hooks');
        t.eq(r.version, 4);
    });

    t.test('la clave ignora mayúsculas y espacios de más', () => {
        t.eq(versiones.clave('Clase  03 - HOOKS'), versiones.clave('clase 03 - hooks'));
    });

    t.grupo('Versiones: agrupar una carpeta');

    const temporal = require('./lib/temporal');

    t.test('cuatro archivos, dos clases, y la extensión no agrupa', async () => {
        const dir = temporal.carpeta('versiones');
        temporal.archivo(dir, 'Clase 03 - Hooks.mp4');
        temporal.archivo(dir, 'Clase 03 - Hooks v2.mov');
        temporal.archivo(dir, 'Clase 03 - Hooks v3.mp4');
        temporal.archivo(dir, 'Clase 04 - Estado_v2.mp4');
        temporal.archivo(dir, 'notas.txt');

        const r = await versiones.escanear(dir);
        t.eq(r.clases.length, 2, 'dos clases');
        t.eq(r.clases[0].nombre, 'Clase 03 - Hooks');
        t.deep(r.clases[0].versiones.map(v => v.n), [1, 2, 3]);
        t.eq(r.clases[0].ultima.n, 3, 'la última es la que se abre');
        t.deep(r.clases[1].versiones.map(v => v.n), [2], 'un hueco es un hueco: no se inventa la v1');
    });

    t.test('las clases salen en orden humano: la 10 después de la 9', async () => {
        const dir = temporal.carpeta('orden');
        for (const n of [1, 2, 9, 10, 11]) temporal.archivo(dir, `Clase ${n}.mp4`);
        const r = await versiones.escanear(dir);
        t.deep(r.clases.map(c => c.nombre), ['Clase 1', 'Clase 2', 'Clase 9', 'Clase 10', 'Clase 11']);
    });

    t.test('una carpeta que no está no explota', async () => {
        const r = await versiones.escanear('/no/existe/esto');
        t.ok(r.error, 'dice el motivo');
        t.deep(r.clases, []);
    });

    t.grupo('Versiones: las guardadas en Pre versions');

    const workspaceLib = require('../engine/workspace');

    t.test('las archivadas son de la misma clase y quedan marcadas', async () => {
        // El punto entero de la carpeta: la raíz muestra una fila con lo
        // final, pero la historia de la clase sigue completa adentro.
        const dir = temporal.carpeta('previas');
        temporal.archivo(dir, 'Clase 01 v3.mp4');
        temporal.archivo(dir, `${workspaceLib.PREVIAS_DIR}/Clase 01.mp4`);
        temporal.archivo(dir, `${workspaceLib.PREVIAS_DIR}/Clase 01 v2.mp4`);

        const r = await versiones.escanear(dir);
        t.eq(r.clases.length, 1, 'una sola clase, no cuatro');
        t.deep(r.clases[0].versiones.map(v => v.n), [1, 2, 3]);
        t.deep(r.clases[0].versiones.map(v => v.archivada), [true, true, false]);
        t.eq(r.clases[0].ultima.n, 3, 'se abre la de la raíz');
    });

    t.test('una clase que vive entera en Pre versions se sigue viendo', async () => {
        // Pasa con una clase que salió del curso: lo último que quedó está
        // archivado y no hay en la raíz ninguna clase de la que sea historia.
        // Esconderla sería perderla de vista sin haberla borrado.
        const dir = temporal.carpeta('previas-solas');
        temporal.archivo(dir, 'Clase 09.mp4');
        temporal.archivo(dir, `${workspaceLib.PREVIAS_DIR}/Clase 20 v2.mp4`);

        const r = await versiones.escanear(dir);
        t.deep(r.clases.map(c => c.nombre), ['Clase 09', 'Clase 20']);
        t.eq(r.clases[1].ultima.archivada, true);
    });

    t.test('un «_V2» que es nombre de la serie no se lee como versión', async () => {
        // El curso real: la serie se llama `…_V2` y sus versiones van con «v»
        // chica. La primera, sin número, quedó en Pre versions. Leída sola era
        // «la v2 de 01_Curso»: una clase fantasma con un único archivo viejo,
        // al lado de la de verdad, y lo que se comentaba ahí caía en el render
        // archivado.
        const dir = temporal.carpeta('serie-v2');
        temporal.archivo(dir, '01_Curso_V2_v4.mp4');
        temporal.archivo(dir, `${workspaceLib.PREVIAS_DIR}/01_Curso_V2.mp4`);
        temporal.archivo(dir, `${workspaceLib.PREVIAS_DIR}/01_Curso_V2_v2.mp4`);
        temporal.archivo(dir, `${workspaceLib.PREVIAS_DIR}/01_Curso_V2_v3.mp4`);

        const r = await versiones.escanear(dir);
        t.deep(r.clases.map(c => c.nombre), ['01_Curso_V2'], 'una sola clase');
        t.deep(r.clases[0].versiones.map(v => v.n), [1, 2, 3, 4]);
        t.eq(r.clases[0].ultima.archivo, '01_Curso_V2_v4.mp4', 'se abre la de la raíz');
    });

    t.test('el «V2» de la serie vale para toda la carpeta, aunque no tenga hermanos', async () => {
        // `12_Curso_p1_V2` no tiene ninguna versión con su mismo nombre —la
        // clase entera quedó archivada—, pero en esta carpeta «V2» es nombre y
        // no versión, como en todas las otras.
        const dir = temporal.carpeta('serie-v2-sola');
        temporal.archivo(dir, '01_Curso_V2_v4.mp4');
        temporal.archivo(dir, `${workspaceLib.PREVIAS_DIR}/12_Curso_p1_V2.mp4`);

        const r = await versiones.escanear(dir);
        t.deep(r.clases.map(c => c.nombre), ['01_Curso_V2', '12_Curso_p1_V2']);
        t.eq(r.clases[1].versiones[0].n, 1);
    });

    t.test('la «v» chica sigue siendo versión aunque la serie use «V» grande', async () => {
        // Es lo que hace segura la regla: en la misma carpeta, `Clase_v2` es
        // la v2 de `Clase`.
        const dir = temporal.carpeta('serie-v2-minuscula');
        temporal.archivo(dir, '01_Curso_V2_v4.mp4');
        temporal.archivo(dir, 'Clase.mp4');
        temporal.archivo(dir, 'Clase_v2.mp4');

        const r = await versiones.escanear(dir);
        const clase = r.clases.find(c => c.nombre === 'Clase');
        t.deep(clase.versiones.map(v => v.n), [1, 2]);
    });

    t.test('sin una serie que lo diga, «V2» al final sigue siendo la versión 2', async () => {
        const dir = temporal.carpeta('v2-version');
        temporal.archivo(dir, 'Intro.mp4');
        temporal.archivo(dir, 'Intro V2.mp4');

        const r = await versiones.escanear(dir);
        t.deep(r.clases.map(c => c.nombre), ['Intro']);
        t.deep(r.clases[0].versiones.map(v => v.n), [1, 2]);
    });

    t.test('las partes viejas de una clase que se juntó son versiones de ella', async () => {
        // Claude entregó la 08 en dos partes y después las juntó. Las partes
        // viejas no tienen ninguna versión con su nombre en la raíz: son la v1
        // de la clase de ahora, que por eso empieza en v2. Se llega a ellas
        // desde los botones de versión, no desde la lista.
        const dir = temporal.carpeta('partes-juntas');
        temporal.archivo(dir, '08_Curso_V2_v3.mp4');
        temporal.archivo(dir, `${workspaceLib.PREVIAS_DIR}/08_Curso_V2_v2.mp4`);
        temporal.archivo(dir, `${workspaceLib.PREVIAS_DIR}/08_Curso_p1_V2.mp4`);
        temporal.archivo(dir, `${workspaceLib.PREVIAS_DIR}/08_Curso_p2_V2.mp4`);

        const r = await versiones.escanear(dir);
        t.deep(r.clases.map(c => c.nombre), ['08_Curso_V2'], 'una sola clase en la lista');
        t.deep(r.clases[0].versiones.map(v => v.etiqueta), ['v1 p1', 'v1 p2', 'v2', 'v3'], 'cada parte dice cuál es');
        t.eq(r.clases[0].ultima.archivo, '08_Curso_V2_v3.mp4');
    });

    t.test('una clase entera que se partió es la v1 de cada parte', async () => {
        const dir = temporal.carpeta('clase-partida');
        temporal.archivo(dir, '06_Curso_p1_V2_v2.mp4');
        temporal.archivo(dir, '06_Curso_p2_V2_v2.mp4');
        temporal.archivo(dir, `${workspaceLib.PREVIAS_DIR}/06_Curso_V2.mp4`);

        const r = await versiones.escanear(dir);
        t.deep(r.clases.map(c => c.nombre), ['06_Curso_p1_V2', '06_Curso_p2_V2']);
        for (const c of r.clases) t.deep(c.versiones.map(v => v.n), [1, 2], c.nombre);
    });

    t.test('dos clases que siguen vivas no se mezclan aunque se parezcan', async () => {
        // La regla de las partes es solo para lo archivado: una p1 y una p2
        // que siguen en la raíz son dos clases, como siempre.
        const dir = temporal.carpeta('partes-vivas');
        temporal.archivo(dir, '07_Curso_p1_V2_v3.mp4');
        temporal.archivo(dir, '07_Curso_p2_V2_v3.mp4');
        const r = await versiones.escanear(dir);
        t.eq(r.clases.length, 2);
    });

    t.test('lo que llega nuevo se nombra como lo nombra el escaneo', async () => {
        // El aviso de «entrega nueva» pinta de verde la clase por su id. Si lo
        // leyera solo, marcaría la clase fantasma y no la de verdad.
        const dir = temporal.carpeta('serie-v2-nueva');
        temporal.archivo(dir, '02_Curso_V2_v3.mp4');
        const { clases } = await versiones.escanear(dir);
        const nueva = versiones.claseDeRuta(path.join(dir, '02_Curso_V2.mp4'), clases);
        t.eq(nueva.clase, '02_Curso_V2');
        t.eq(nueva.n, 1);
    });

    t.test('si el archivo se copió en vez de moverse, no sale dos veces', async () => {
        // El error probable del que mueve los archivos. Una versión duplicada
        // mostraría dos botones `v2`, y uno de los dos abriría el video sin
        // los comentarios al lado.
        const dir = temporal.carpeta('previas-copia');
        temporal.archivo(dir, 'Clase 01 v2.mp4');
        temporal.archivo(dir, `${workspaceLib.PREVIAS_DIR}/Clase 01 v2.mp4`);

        const r = await versiones.escanear(dir);
        t.deep(r.clases[0].versiones.map(v => v.n), [2]);
        t.eq(r.clases[0].versiones[0].archivada, false, 'gana la que está a la vista');
    });

    t.test('el nombre de la carpeta no depende de las mayúsculas', async () => {
        // En un disco con formato sensible a mayúsculas, un `Pre Versions`
        // escrito distinto dejaría las versiones viejas invisibles y sin un
        // solo error que lo explique.
        const dir = temporal.carpeta('previas-mayusculas');
        temporal.archivo(dir, 'Clase 01 v2.mp4');
        temporal.archivo(dir, 'PRE VERSIONS/Clase 01.mp4');

        const r = await versiones.escanear(dir);
        t.deep(r.clases[0].versiones.map(v => v.n), [1, 2]);
    });

    t.test('la carpeta de comentarios de una archivada se busca donde está', () => {
        // Es la razón por la que la carpeta tiene que mudarse con el video: la
        // ruta sale del archivo, no de la raíz del curso.
        const dir = temporal.carpeta('previas-carpeta');
        const video = temporal.archivo(dir, `${workspaceLib.PREVIAS_DIR}/Clase 01 v2.mp4`);
        t.eq(workspaceLib.carpetaDeVersion(video), path.join(dir, workspaceLib.PREVIAS_DIR, 'Clase 01 v2'));
    });

    t.test('sin esa carpeta todo sigue como antes', async () => {
        const dir = temporal.carpeta('previas-sin');
        temporal.archivo(dir, 'Clase 01 v2.mp4');
        t.eq(workspaceLib.carpetaPrevias(dir), null);
        const r = await versiones.escanear(dir);
        t.deep(r.clases[0].versiones.map(v => v.archivada), [false]);
    });

    t.grupo('Versiones: cuántos comentarios tiene cada una');

    const workspace = require('../engine/workspace');

    /** Deja un `comentarios.json` al lado de un render, con n comentarios. */
    function conComentarios(rutaVideo, n) {
        const archivos = workspace.asegurarCarpeta(rutaVideo);
        const lista = Array.from({ length: n }, (_, i) => ({ id: `c0${i + 1}`, t: i, texto: 'algo' }));
        require('fs').writeFileSync(archivos.comentarios, JSON.stringify({ comentarios: lista }));
    }

    t.test('una versión sin revisar cuenta cero y no se queja', () => {
        // Es el estado normal de casi toda la carpeta, no un error: la carpeta
        // de una versión ni siquiera existe hasta que hay un comentario.
        const dir = temporal.carpeta('cuenta-vacia');
        t.eq(workspace.cuantosComentarios(temporal.archivo(dir, 'Clase 01.mp4')), 0);
    });

    t.test('un comentarios.json roto cuenta cero en vez de tumbar el escaneo', () => {
        // Un archivo cortado a la mitad por un cierre a destiempo no puede
        // dejar la lista de clases sin dibujar.
        const dir = temporal.carpeta('cuenta-rota');
        const video = temporal.archivo(dir, 'Clase 01.mp4');
        require('fs').writeFileSync(workspace.asegurarCarpeta(video).comentarios, '{"comentarios": [');
        t.eq(workspace.cuantosComentarios(video), 0);
    });

    t.test('el escaneo trae la cuenta de cada versión por separado', async () => {
        // Por versión y no por clase: el renglón muestra la de la última, que
        // es la que se abre al tocarla, y una v1 con ocho comentarios no dice
        // nada sobre si alguien miró la v2.
        const dir = temporal.carpeta('cuenta-escaneo');
        const v1 = temporal.archivo(dir, 'Clase 01.mp4');
        temporal.archivo(dir, 'Clase 01 v2.mp4');
        conComentarios(v1, 3);

        const r = await versiones.escanear(dir);
        t.deep(r.clases[0].versiones.map(v => v.comentarios), [3, 0]);
        t.eq(r.clases[0].versiones[0].tieneComentarios, true, 'y la marca sigue andando');
        t.eq(r.clases[0].versiones[1].tieneComentarios, false);
    });
};
