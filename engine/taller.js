'use strict';
/**
 * taller.js — El taller de Claude: dónde renderiza y qué está haciendo ahora.
 *
 * Claude no entrega de una vez. Deja planes en `_claude_edit/`, los pone en una
 * cola, y una máquina de etapas los va empujando: OCR, render de tomas, audio,
 * unión, mux, control de calidad y entrega. Eso corría en una ventana de
 * Terminal que el editor tenía que acordarse de abrir, y que no decía nada
 * salvo tres renglones de log cada quince segundos.
 *
 * El costo de no verlo es alto y medido: cuando se escribió este módulo había
 * tres trabajos en `error` dando vueltas desde hacía días. El worker los
 * reintentaba cada quince segundos, fallaba, y volvía a empezar. Nadie se
 * enteró porque no había dónde enterarse.
 *
 * Acá se lee ese taller. **Solo se lee**: ni se escribe, ni se lanza nada, ni
 * se importa `child_process`. Eso lo hace `main/taller.js`, que es el que puede
 * romper algo. La separación es la que permite que todo esto tenga tests sobre
 * carpetas de mentira.
 *
 * El formato no lo inventamos nosotros: son los archivos que `mac_worker.sh` y
 * `step.py` ya usaban. Leerlos en vez de cambiarlos es lo que permite que la
 * Terminal siga sirviendo de respaldo y que Claude no se entere de nada.
 */

const fs = require('fs');
const path = require('path');

const nombres = require('./nombres');
const progresoLib = require('./progreso');

/** La carpeta de trabajo de Claude dentro del curso. */
const TALLER = '_claude_edit';

/** Los archivos del protocolo, tal como los escribe `mac_worker.sh`. */
const LATIDO = 'macworker.alive';
const PARAR = 'STOP_WORKER';
const COLA = 'macworker_jobs.txt';
const ESTADO = 'step_status.json';
const LOG = 'macworker.log';
const TAREAS = 'mac_tasks';

/**
 * Cuánto puede tardar un latido antes de dar al worker por muerto.
 *
 * Late cada 20 s. Noventa son cuatro latidos perdidos: suficiente para no
 * declararlo muerto porque el Mac se trabó un segundo con un render pesado, y
 * poco para que «está corriendo» signifique algo.
 *
 * Es el mismo número que usa `step.py` para decidir si se aparta, así que las
 * dos puntas opinan igual sobre quién está vivo.
 */
const FRESCO = 90_000;

/**
 * Las etapas por las que pasa un trabajo, en orden.
 *
 * Son las de `step.py`. Se listan acá porque la ventana dibuja la fila de
 * etapas con la actual marcada, y para eso hace falta saber cuáles son y en
 * qué orden van, no solo en cuál está.
 */
const ETAPAS = ['ocr', 'render', 'audio', 'video', 'mux', 'qa', 'delivered'];

/** Cómo se llama cada etapa en la ventana. */
const NOMBRES = {
    ocr: 'Leer pantallas',
    render: 'Render',
    audio: 'Audio',
    video: 'Unir',
    mux: 'Armar',
    qa: 'Revisar',
    delivered: 'Entregado',
    error: 'Error',
    unchanged: 'Sin cambios'
};

/** Cuánto del final del log se lee. El archivo crece a miles de renglones. */
const COLA_LOG = 64 * 1024;

/**
 * Y cuánto se lee cuando hay que ir a buscar el motivo de un error.
 *
 * El worker escribe un `STATUS` cada quince segundos pase lo que pase, así que
 * un error de ayer queda sepultado bajo miles de renglones que no dicen nada:
 * en el taller donde se probó esto, los tres errores estaban a 300 KB del
 * final. Con la cola corta el motivo se perdía justo cuando más falta hacía.
 * Esta lectura más grande solo pasa si hay un trabajo en error.
 */
const BUSQUEDA_LOG = 8 * 1024 * 1024;

function leerJSON(ruta) {
    try {
        return JSON.parse(fs.readFileSync(ruta, 'utf8'));
    } catch (e) {
        return null;
    }
}

/**
 * El final de un archivo de texto, sin cargarlo entero.
 *
 * `macworker.log` tenía doce mil renglones cuando se escribió esto y crece con
 * cada pasada. La ventana lo relee cada pocos segundos, así que leerlo entero
 * sería megabytes por minuto para mostrar las últimas diez líneas.
 */
function colaDe(ruta, bytes = COLA_LOG) {
    let fd = null;
    try {
        const total = fs.statSync(ruta).size;
        const desde = Math.max(0, total - bytes);
        const buffer = Buffer.alloc(Math.min(bytes, total));
        fd = fs.openSync(ruta, 'r');
        fs.readSync(fd, buffer, 0, buffer.length, desde);
        const texto = buffer.toString('utf8');
        // El primer renglón puede venir cortado a la mitad de un carácter.
        return (desde > 0 ? texto.slice(texto.indexOf('\n') + 1) : texto).split('\n');
    } catch (e) {
        return [];
    } finally {
        if (fd !== null) try { fs.closeSync(fd); } catch (e) { /* ya se fue */ }
    }
}

/**
 * Busca el taller desde la carpeta que el editor abrió.
 *
 * Se abre `Clases_Finales/V2`, y el taller está dos niveles más arriba, en la
 * raíz del curso. Se sube de a uno hasta encontrarlo, con tope: sin tope, un
 * curso sin taller haría subir hasta `/` y podría encontrar el taller de otro
 * curso que esté más arriba en el disco.
 *
 * Tiene que tener `step.py`, que es lo que se va a correr, y el apuntador a la
 * cola. Una carpeta `_claude_edit` sin eso es de un curso viejo o a medio
 * copiar, y lanzarle un worker encima no haría nada bueno.
 */
function buscar(raiz, niveles = 3) {
    let actual = path.resolve(raiz);
    for (let i = 0; i <= niveles; i++) {
        const candidato = path.join(actual, TALLER);
        if (fs.existsSync(path.join(candidato, 'step.py')) && fs.existsSync(path.join(candidato, COLA))) {
            return candidato;
        }
        const padre = path.dirname(actual);
        if (padre === actual) break;
        actual = padre;
    }
    return null;
}

/**
 * Hace cuánto late el worker, en milisegundos, o `null` si no hay nadie.
 *
 * El archivo tiene la hora Unix en segundos, que es lo que escribe el `date
 * +%s` del script. Se lee el contenido y no la fecha del archivo porque un
 * `rsync` o un respaldo pueden tocarle la fecha a un archivo que quedó de una
 * sesión de ayer, y entonces un worker muerto se vería vivo.
 */
function latido(taller) {
    try {
        const segundos = parseInt(fs.readFileSync(path.join(taller, LATIDO), 'utf8').trim(), 10);
        if (!Number.isFinite(segundos)) return null;
        return Math.max(0, Date.now() - segundos * 1000);
    } catch (e) {
        return null;
    }
}

/** Si hay un worker vivo, sea el nuestro o el de una Terminal abierta. */
function vivo(taller) {
    const edad = latido(taller);
    return edad !== null && edad < FRESCO;
}

/** Si alguien pidió que el worker se detenga. */
function detenido(taller) {
    return fs.existsSync(path.join(taller, PARAR));
}

/** El nombre del archivo de cola: `jobs8.json` y mañana otro. */
function colaActual(taller) {
    try {
        return fs.readFileSync(path.join(taller, COLA), 'utf8').trim() || null;
    } catch (e) {
        return null;
    }
}

/**
 * El último error de un trabajo, sacado del log.
 *
 * `step_status.json` guarda que la etapa es `error`, pero no por qué, y el «por
 * qué» es justo lo único que sirve para arreglarlo. El motivo solo queda en el
 * log, en un renglón que empieza con el nombre del trabajo.
 *
 * Se busca desde el final: un trabajo que falló cinco veces tiene cinco
 * renglones y el que importa es el último.
 */
function errorDe(renglones, nombre) {
    const marca = `${nombre} ERROR `;
    for (let i = renglones.length - 1; i >= 0; i--) {
        const j = renglones[i].indexOf(marca);
        if (j !== -1) return renglones[i].slice(j + marca.length).trim();
    }
    return null;
}

/**
 * Las tareas sueltas que Claude le deja al Mac.
 *
 * Son los `mac_tasks/*.sh`: renderizar las gráficas con un navegador,
 * transcribir con Whisper, concatenar partes. Corren de a una y en orden
 * alfabético, y `step.py` las renombra a `.run` mientras corren y a `.done`
 * cuando terminan. O sea que el estado de cada una es su extensión.
 */
function tareasDe(taller) {
    const dir = path.join(taller, TAREAS);
    let archivos;
    try {
        archivos = fs.readdirSync(dir).sort();
    } catch (e) {
        return { pendientes: [], corriendo: null, hechas: [] };
    }
    const nombre = f => f.replace(/\.(sh|run|done)$/, '');
    const ultimaLinea = f => colaDe(path.join(dir, `${nombre(f)}.log`), 4096).filter(l => l.trim()).pop() || '';
    return {
        pendientes: archivos.filter(f => f.endsWith('.sh')).map(nombre),
        corriendo: archivos.filter(f => f.endsWith('.run')).map(f => ({ nombre: nombre(f), ultima: ultimaLinea(f) }))[0] || null,
        // De las terminadas solo interesan las últimas: hay cursos con cien.
        hechas: archivos.filter(f => f.endsWith('.done')).map(nombre).slice(-8)
    };
}

/**
 * Qué clase es este trabajo, para mostrarlo como lo muestra el resto de la app.
 *
 * El nombre de un trabajo es la ruta de entrega (`V2/09_curso_p3_V2_v4.mp4`).
 * En la ventana se muestra solo el archivo, sin extensión, que es el mismo
 * texto que el editor ve en la lista de clases.
 */
function claseDe(nombre) {
    return path.basename(nombre, path.extname(nombre));
}

/**
 * Dónde va a quedar el archivo de un trabajo cuando se entregue.
 *
 * El nombre del trabajo es relativo a `Clases_Finales/`, que es adonde
 * `step.py` lo mueve al terminar. Hace falta entero para que el botón de
 * «Revisar» pueda abrir esa versión: la ventana tiene rutas absolutas.
 */
function entregaDe(taller, nombre) {
    return path.join(path.dirname(taller), 'Clases_Finales', nombre);
}

/**
 * Los trabajos juntados por clase, que es la unidad que al editor le importa.
 *
 * Una clase larga se entrega en partes —`06_Curso_p1`, `06_Curso_p2`— y cada
 * parte es un trabajo suelto en la cola. Mirándolos sueltos no hay forma de
 * contestar «¿ya está la clase?», que es la única pregunta que se hace quien
 * está esperando para revisarla: hay que sumar a mano tres barras que además
 * no están una al lado de la otra.
 *
 * La versión entra en la clave además de la clase. Dos versiones de la misma
 * clase en la cola son dos entregas distintas, y una barra que las mezclara
 * diría que la v6 va por la mitad porque la v5 ya se entregó.
 *
 * El avance del grupo es el promedio de sus partes y no la suma de sus tomas:
 * una parte de veinte tomas y otra de ciento veinte tardan parecido igual,
 * porque la larga se reparte entre los seis renders que corren a la vez.
 */
function agrupar(lista) {
    const porClave = new Map();
    for (const j of lista) {
        const llave = `${nombres.clave(j.serie)}\u0000${j.version}`;
        if (!porClave.has(llave)) {
            porClave.set(llave, { llave, clase: j.serie, version: j.version, partes: [] });
        }
        porClave.get(llave).partes.push(j);
    }

    return [...porClave.values()].map(g => {
        const partes = g.partes;
        const fraccion = partes.reduce((a, j) => a + j.progreso.fraccion, 0) / partes.length;
        const errores = partes.filter(j => j.etapa === 'error');
        const activas = partes.filter(j => !['delivered', 'error', 'unchanged'].includes(j.etapa));
        return {
            ...g,
            // El orden de las partes es el del nombre y no el de la cola: la
            // p2 arriba de la p1 se lee como un error aunque sea el orden en
            // que Claude las encoló.
            partes: [...partes].sort((a, b) => (a.parte || '').localeCompare(b.parte || '')),
            fraccion,
            // En qué está la clase: lo que pide atención primero.
            estado: errores.length ? 'error' : (activas.length ? 'trabajando' : 'listo'),
            // La etapa de la parte que va más atrasada, que es la que manda
            // cuándo va a estar lista la clase entera.
            etapa: activas.length
                ? activas.reduce((a, b) => (a.progreso.fraccion <= b.progreso.fraccion ? a : b)).etapa
                : null,
            errores: errores.length,
            activas: activas.length
        };
    });
}

/**
 * Todo lo que está pasando en el taller, de una sola lectura del disco.
 *
 * Es lo que dibuja la pestaña de Render y lo que decide la insignia. Se llama
 * seguido, así que no hace nada caro: lee JSONs chicos, cuenta archivos y lee
 * el final del log.
 */
function estadoDe(taller) {
    const cola = colaActual(taller);
    const trabajos = (cola && leerJSON(path.join(taller, cola))) || [];
    const porNombre = leerJSON(path.join(taller, ESTADO)) || {};
    const renglones = colaDe(path.join(taller, LOG));

    // Los motivos de los errores suelen estar más atrás que la cola corta, así
    // que se relee más hondo. Se hace una sola vez y solo si hay errores.
    const hayError = trabajos.some(j => (porNombre[j.name] || {}).stage === 'error');
    const hondo = hayError ? colaDe(path.join(taller, LOG), BUSQUEDA_LOG) : renglones;

    const lista = trabajos.map(job => {
        const guardado = porNombre[job.name] || {};
        const etapa = guardado.stage || 'ocr';
        const progreso = progresoLib.progresoDe(taller, job, etapa);
        const nombreBase = claseDe(job.name);
        const { clase, version } = nombres.partir(nombreBase);
        return {
            nombre: job.name,
            clase: nombreBase,
            // De qué clase es y qué parte: dos trabajos `_p1` y `_p2` son la
            // misma clase partida en dos, y lo que el editor quiere saber es
            // cuándo está lista la clase, no cuándo está listo un pedazo.
            serie: nombres.sinParte(clase),
            parte: nombres.parteDe(clase),
            version,
            ruta: entregaDe(taller, job.name),
            tag: job.tag,
            etapa,
            // Las tomas se cuentan siempre y no solo durante el render: al
            // volver de un error uno quiere saber cuánto se había avanzado.
            tomas: progreso.tomas,
            progreso: { fraccion: progreso.fraccion, detalle: progreso.detalle },
            qa: guardado.qa || null,
            error: etapa === 'error' ? errorDe(hondo, job.name) : null
        };
    });

    const corriendo = lista.filter(j => !['delivered', 'error', 'unchanged'].includes(j.etapa));
    return {
        taller,
        cola,
        vivo: vivo(taller),
        detenido: detenido(taller),
        edadDelLatido: latido(taller),
        trabajos: lista,
        grupos: agrupar(lista),
        // El que está empujando ahora es el primero sin terminar: `step.py`
        // recorre la cola en orden y se queda en el primero que tenga trabajo.
        actual: corriendo[0] || null,
        pendientes: corriendo.length,
        entregados: lista.filter(j => j.etapa === 'delivered'),
        errores: lista.filter(j => j.etapa === 'error'),
        tareas: tareasDe(taller),
        log: renglones.filter(l => l.trim()).slice(-12)
    };
}

/**
 * Una frase y un color para la insignia de la pestaña.
 *
 * La pestaña tiene que decir si hace falta mirarla sin que uno la abra, y para
 * eso alcanzan cuatro estados. El orden importa: un error se muestra aunque
 * haya otra clase renderizando bien, porque es lo único que pide una decisión.
 */
function resumen(estado) {
    if (!estado) return { tono: 'nada', texto: 'Sin taller' };
    if (estado.errores.length) {
        return { tono: 'mal', texto: `${estado.errores.length} con error`, cuantos: estado.errores.length };
    }
    // «Trabajando» solo si alguien está empujando. Un trabajo a medias con el
    // worker apagado no es trabajo en curso, es trabajo esperando: la insignia
    // latía en azul al 0 % con el render en pausa, y eso dice lo contrario de
    // lo que pasa.
    if (estado.actual && estado.vivo) {
        const p = estado.actual.progreso || {};
        return {
            tono: 'trabajando',
            texto: `${estado.actual.clase} · ${NOMBRES[estado.actual.etapa] || estado.actual.etapa}`
                + (p.detalle ? ` · ${p.detalle}` : ''),
            porcentaje: Math.round(100 * (p.fraccion || 0))
        };
    }
    if (estado.vivo) return { tono: 'espera', texto: 'Esperando trabajo' };
    if (estado.actual) {
        return { tono: 'nada', texto: `En pausa · ${estado.pendientes} por hacer`, cuantos: estado.pendientes };
    }
    return { tono: 'nada', texto: 'En pausa' };
}

module.exports = {
    TALLER, LATIDO, PARAR, COLA, ESTADO, LOG, TAREAS, FRESCO, ETAPAS, NOMBRES,
    buscar, latido, vivo, detenido, colaActual, colaDe, errorDe, tareasDe, claseDe, entregaDe,
    agrupar, estadoDe, resumen
};
