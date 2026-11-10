'use strict';
/**
 * main/taller.js — Reviewer haciendo de worker de render.
 *
 * Lo que hacía la ventana de Terminal: latir, empujar la cola cada quince
 * segundos y no dejar dormir al Mac. La diferencia no es dónde corre, es que
 * ahora se ve. Antes era una ventana negra que había que acordarse de abrir y
 * que no decía nada; cuando se escribió esto, el taller tenía tres trabajos en
 * error dando vueltas desde hacía días y nadie se había enterado.
 *
 * **Se respeta el protocolo de `mac_worker.sh` al pie de la letra** —el mismo
 * `macworker.alive`, el mismo `STOP_WORKER`, el mismo `macworker.log`, la
 * misma cola— y por eso la Terminal sigue sirviendo de respaldo y Claude no se
 * entera de nada. Las dos puntas se reconocen por el latido, así que no hay
 * manera de que las dos empujen la misma cola a la vez.
 *
 * Lo que este archivo NO hace es leer el taller: eso es `engine/taller.js`,
 * puro y con tests. Acá queda lo que puede romper algo, que es lanzar
 * procesos y escribir archivos.
 */

const { BrowserWindow, Notification, dialog, ipcMain, powerSaveBlocker } = require('electron');
const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const ajustesLib = require('../engine/ajustes');
const dependenciasLib = require('../engine/dependencias');
const paths = require('../engine/paths');
const tallerLib = require('../engine/taller');

/** Cada cuánto late, igual que el script: `step.py` espera 20 s. */
const LATIDO = 20_000;

/** Cada cuánto se empuja la cola cuando la pasada anterior no dejó trabajo. */
const RONDA = 15_000;

/** Cada cuánto se le manda el estado a la ventana mientras hay trabajo. */
const REFRESCO = 2_000;

/**
 * El presupuesto que se le da a `step.py`, en segundos.
 *
 * Es el mismo número absurdo del script original, y es a propósito: `step.py`
 * usa el presupuesto para decidir si le da tiempo a empezar una etapa más
 * antes de volver. Con un número gigante no se corta nunca a la mitad, que es
 * lo que uno quiere cuando el worker es la app y no una tarea de dos minutos.
 */
const PRESUPUESTO = '100000';

let puente = {
    mandar: () => {},
    anotar: () => {},
    ventanaPrincipal: () => null,
    // Quién más quiere enterarse de que Claude terminó una clase. Hoy Frame.io,
    // que la sube. Llega por el puente y no por un `require`: este módulo no
    // tiene por qué saber que existe Frame.io.
    alEntregar: () => {}
};

/** Lo que está pasando ahora. Uno solo: se renderiza la carpeta abierta. */
let actual = null;

/**
 * Cuántos procesos de ffmpeg a la vez.
 *
 * Medido en el M3 Max de 12 núcleos de rendimiento: con seis, treinta tomas
 * tardan 42,8 s; con ocho, 44,4 s; con diez y con doce, 45,3 s. O sea que
 * pasar de seis no sirve, y la razón es que cada ffmpeg ya usa varios hilos
 * para sus filtros —que es donde se va el tiempo, no en el encoder—, así que
 * sumar procesos es pelearse por la misma CPU.
 *
 * La mitad de los núcleos con tope en ocho es la regla del script original, y
 * la medición le da la razón. Se deja igual para no cambiar dos cosas a la vez.
 */
function cuantosALaVez() {
    let nucleos = 4;
    try {
        nucleos = parseInt(execFileSync('/usr/sbin/sysctl', ['-n', 'hw.perflevel0.physicalcpu'], { encoding: 'utf8' }).trim(), 10)
            || require('os').cpus().length;
    } catch (e) {
        nucleos = require('os').cpus().length;
    }
    return Math.min(8, Math.max(2, Math.floor(nucleos / 2)));
}

/**
 * El PATH con el que corren los scripts de Claude.
 *
 * Primero el entorno de Python del taller, después el ffmpeg que trae
 * Reviewer, después Homebrew. Ese orden es lo que permite renderizar en un Mac
 * sin Homebrew: el `ffmpeg` que la app ya empaqueta tiene los filtros que
 * `render7.py` usa —`curves`, `selectivecolor`, `zoompan`, `alphamerge`,
 * `loudnorm`— y está comprobado.
 *
 * El PATH de un Electron abierto desde el Finder no es el de la terminal, así
 * que los lugares conocidos de Homebrew van escritos y no heredados.
 */
function caminoDe(taller) {
    const ffmpeg = paths.ffmpeg().path;
    return [
        path.join(taller, '.macvenv', 'bin'),
        path.join(taller, 'macbin'),
        ffmpeg ? path.dirname(ffmpeg) : null,
        '/opt/homebrew/bin',
        '/usr/local/bin',
        process.env.PATH || '/usr/bin:/bin'
    ].filter(Boolean).join(':');
}

/** El python del taller si ya existe; si no, el de la Mac. */
function pythonDe(taller) {
    const propio = path.join(taller, '.macvenv', 'bin', 'python3');
    if (fs.existsSync(propio)) return propio;
    return dependenciasLib.python3() || 'python3';
}

/**
 * Qué falta para poder renderizar en esta máquina.
 *
 * Lo que es de la Mac —Python, ffmpeg, tesseract— lo dice
 * `engine/dependencias.js`, que es la misma lista que Ajustes muestra e
 * instala; la ventana recibe la clave para ofrecer el botón de instalar ahí
 * mismo. Lo único que se mira acá son los módulos de Python, porque viven en
 * el `.macvenv` del taller y los pone Reviewer solo.
 *
 * Se separa lo que impide arrancar de lo que solo apaga una etapa: sin
 * `numpy` no se puede armar el audio de ninguna clase, pero sin `tesseract`
 * lo único que no corre es el OCR de las pantallas, y hay clases que no tienen
 * ninguna. Frenar todo por eso sería frenar de más.
 *
 * **La lista de módulos sale de leer qué importan los scripts, no de la receta
 * de instalación del skill.** Acá se avisaba por `mlx_whisper` porque el skill
 * lo manda a instalar, y era un aviso falso: la transcripción es un paso
 * aparte que Claude corre a mano. Lo que sí hacía falta y no se miraba era
 * Pillow, que es de donde `ocrplan3.py` saca las imágenes.
 */
function revisar(taller) {
    const deps = dependenciasLib.estado();
    const sin = clave => deps.find(d => d.clave === clave && !d.esta);

    const falta = ['python3', 'ffmpeg'].map(sin).filter(Boolean)
        .map(d => ({ clave: d.clave, que: d.nombre, como: (d.accion && d.accion.nota) || d.para }));
    const avisos = [];
    if (sin('tesseract')) {
        avisos.push('Falta tesseract: las clases con pantallas que haya que leer (OCR) van a quedar esperando.');
    }

    const python = pythonDe(taller);
    if (!falta.length) {
        try {
            execFileSync(python, ['-c', 'import numpy, soundfile, PIL'], { stdio: 'ignore' });
        } catch (e) {
            falta.push({ que: 'numpy, soundfile y Pillow', como: 'Reviewer los instala solo la primera vez.', armable: true });
        }
    }
    return { falta, avisos, python };
}

/**
 * Arma el entorno de Python del taller. Es lo único que tarda, y una sola vez.
 *
 * Va en `_claude_edit/.macvenv`, que es donde el script original lo ponía y
 * donde los scripts de Claude lo esperan.
 */
function prepararEntorno(taller, avisar) {
    const venv = path.join(taller, '.macvenv');
    const base = pythonDe(taller);
    try {
        avisar('Preparando Python, solo la primera vez…');
        if (!fs.existsSync(path.join(venv, 'bin', 'python3'))) {
            execFileSync(base, ['-m', 'venv', venv], { stdio: 'ignore' });
        }
        const pip = path.join(venv, 'bin', 'pip');
        avisar('Instalando numpy, soundfile y Pillow…');
        execFileSync(pip, ['install', '-q', '--upgrade', 'pip'], { stdio: 'ignore' });
        execFileSync(pip, ['install', '-q', 'numpy', 'soundfile', 'pillow'], { stdio: 'ignore' });
        return { ok: true };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

function anotarLog(taller, texto) {
    try {
        fs.appendFileSync(path.join(taller, tallerLib.LOG), `${texto}\n`);
    } catch (e) { /* si el disco no deja escribir el log, el render importa más */ }
}

/**
 * Avisa por fuera de la app cuando una clase se entrega o un trabajo falla.
 *
 * Solo con la ventana atrás, que es todo el punto: renderizar un curso son
 * veinte minutos y nadie se queda mirando la pestaña. Con Reviewer adelante no
 * hace falta —la insignia ya cambió— y una notificación encima de la ventana
 * que ya lo dice es ruido.
 *
 * Se compara contra la pasada anterior para no repetir: el estado se relee
 * cada dos segundos y sin esto cada clase entregada avisaría cientos de veces.
 */
function avisarAfuera(estado) {
    if (!actual) return;
    const antes = actual.visto;
    actual.visto = {
        entregados: new Set(estado.entregados.map(j => j.nombre)),
        errores: new Set(estado.errores.map(j => j.nombre))
    };

    // La primera lectura solo deja la foto de cómo estaba: lo que ya estaba
    // entregado cuando se abrió la carpeta no es noticia de nadie.
    if (!antes) return;

    const listas = estado.entregados.filter(j => !antes.entregados.has(j.nombre));
    const fallados = estado.errores.filter(j => !antes.errores.has(j.nombre));

    // Lo que acaba de entregarse se avisa SIEMPRE, antes de la guarda de la
    // notificación: quien lo escucha lo sube a Frame.io, y eso tiene que pasar
    // esté la ventana en foco o no. Antes de separarlo, una entrega hecha con
    // Reviewer adelante no se subía y la de un minuto después sí, sin que nada
    // explicara la diferencia.
    if (listas.length) puente.alEntregar(listas.map(j => ({ nombre: j.nombre, clase: j.clase, ruta: j.ruta })));

    const ventana = BrowserWindow.getAllWindows()[0];
    if ((ventana && ventana.isFocused()) || !Notification.isSupported()) return;

    for (const j of fallados) {
        new Notification({ title: 'Un render falló', body: `${j.clase} se cortó. Mirá la pestaña Render.` }).show();
    }
    if (listas.length) {
        new Notification({
            title: listas.length === 1 ? 'Clase lista' : `${listas.length} clases listas`,
            body: listas.map(j => j.clase).join(', ')
        }).show();
    }
}

/** Le cuenta a la ventana todo lo que está pasando. */
function avisarEstado() {
    if (!actual) {
        puente.mandar('taller-estado', null);
        return;
    }
    const estado = tallerLib.estadoDe(actual.taller);
    avisarAfuera(estado);
    puente.mandar('taller-estado', {
        ...estado,
        // La insignia se calcula de este lado para que la regla de qué es
        // urgente viva en un solo archivo, con sus tests, y no duplicada en la
        // ventana — que además no puede importar del motor.
        resumen: tallerLib.resumen(estado),
        etapas: tallerLib.ETAPAS,
        nombresDeEtapa: tallerLib.NOMBRES,
        // Quién está empujando: nosotros, una Terminal, o nadie. La ventana lo
        // dice con todas las letras, porque «vivo» a secas no deja decidir
        // nada: si el worker es ajeno, el botón de arrancar no va a servir.
        nuestro: Boolean(actual.proceso) || actual.encendido,
        ajeno: estado.vivo && !actual.encendido,
        encendido: actual.encendido,
        despierto: actual.bloqueo !== null,
        aLaVez: actual.aLaVez,
        avisos: actual.avisos,
        falta: actual.falta,
        // De qué curso es: desde que el render no depende de la carpeta
        // abierta, la pestaña tiene que decir qué está renderizando.
        curso: path.basename(path.dirname(actual.taller))
    });
}

/**
 * Que el Mac no se duerma mientras hay trabajo, y que se pueda dormir cuando no.
 *
 * `prevent-app-suspension` y no `prevent-display-sleep`: lo que no puede
 * pasar es que se suspenda el proceso: la pantalla que se apague es justo lo
 * que uno quiere si deja renderizando y se va.
 *
 * Se suelta en cuanto la cola queda vacía. Un bloqueo que no se suelta es una
 * batería que se gasta de noche sin que nadie entienda por qué.
 */
function despierto(encender) {
    if (!actual) return;
    if (encender && actual.bloqueo === null) {
        actual.bloqueo = powerSaveBlocker.start('prevent-app-suspension');
    } else if (!encender && actual.bloqueo !== null) {
        powerSaveBlocker.stop(actual.bloqueo);
        actual.bloqueo = null;
    }
}

function latir() {
    if (!actual || !actual.encendido) return;
    try {
        fs.writeFileSync(path.join(actual.taller, tallerLib.LATIDO), String(Math.floor(Date.now() / 1000)));
    } catch (e) { /* el disco se fue; la próxima ronda lo nota */ }
}

/**
 * Una pasada de la cola.
 *
 * No se encadena con un `setInterval`: si una pasada tarda tres minutos, el
 * intervalo habría disparado doce veces y habría doce `step.py` peleándose por
 * el mismo `step_status.json`. Cada pasada agenda la siguiente cuando termina.
 */
function pasada() {
    if (!actual || !actual.encendido || actual.proceso) return;

    const { taller } = actual;
    if (tallerLib.detenido(taller)) {
        parar('alguien dejó un STOP_WORKER en la carpeta');
        return;
    }

    const cola = tallerLib.colaActual(taller);
    if (!cola || !fs.existsSync(path.join(taller, cola))) {
        agendar(RONDA);
        return;
    }

    const proceso = spawn(actual.python, ['step.py', cola, PRESUPUESTO], {
        cwd: taller,
        env: {
            ...process.env,
            PATH: caminoDe(taller),
            // `WORKER=1` es lo que le dice a `step.py` que no se aparte por el
            // latido —el latido es nuestro— y que arranque las tareas sueltas
            // de `mac_tasks/`.
            WORKER: '1',
            NP: String(actual.aLaVez)
        },
        // Grupo propio: así al cerrar se puede matar al `step.py` Y a los
        // ffmpeg que colgó de él, sin tocar ningún otro proceso de la máquina.
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe']
    });
    actual.proceso = proceso;
    puente.anotar('taller.pasada', { cola, aLaVez: actual.aLaVez });

    let salida = '';
    const juntar = trozo => {
        salida += trozo;
        anotarLog(taller, String(trozo).replace(/\n$/, ''));
    };
    proceso.stdout.on('data', juntar);
    proceso.stderr.on('data', juntar);

    proceso.on('close', codigo => {
        if (!actual || actual.proceso !== proceso) return;
        actual.proceso = null;
        if (codigo) {
            puente.anotar('taller.pasada-falla', { codigo, cola: salida.slice(-300) });
            anotarLog(taller, `Reviewer: step.py terminó con código ${codigo}`);
        }
        const estado = tallerLib.estadoDe(taller);
        despierto(estado.pendientes > 0);
        avisarEstado();
        // Sin trabajo se espera la ronda entera; con trabajo, se vuelve ya.
        agendar(estado.pendientes ? 500 : RONDA);
    });

    avisarEstado();
}

function agendar(ms) {
    if (!actual || !actual.encendido) return;
    clearTimeout(actual.proximaRonda);
    actual.proximaRonda = setTimeout(pasada, ms);
    if (actual.proximaRonda.unref) actual.proximaRonda.unref();
}

/**
 * Enciende el worker sobre la carpeta abierta.
 *
 * Si hay otro worker vivo no se arranca. Dos empujando la misma cola es lo
 * único que puede corromper de verdad el trabajo de Claude: los dos leen el
 * mismo `step_status.json`, los dos lo reescriben, y una clase termina con la
 * mitad de las tomas de otra versión.
 */
function arrancar({ forzar = false } = {}) {
    if (!actual) return { ok: false, error: 'No hay ninguna carpeta con taller abierta.' };
    if (actual.encendido) return { ok: true, ya: true };

    if (!forzar && tallerLib.vivo(actual.taller)) {
        return {
            ok: false,
            ajeno: true,
            error: 'Ya hay un worker corriendo, seguramente en una Terminal. Cerralo con Ctrl+C antes de encender este.'
        };
    }

    const { falta, avisos, python } = revisar(actual.taller);
    actual.avisos = avisos;
    actual.falta = falta.filter(f => !f.armable);
    if (actual.falta.length) {
        avisarEstado();
        return { ok: false, falta: actual.falta, error: `Falta ${actual.falta.map(f => f.que).join(' y ')}.` };
    }
    if (falta.length) {
        puente.mandar('taller-preparando', { texto: 'Preparando Python, solo la primera vez…' });
        const r = prepararEntorno(actual.taller, texto => puente.mandar('taller-preparando', { texto }));
        puente.mandar('taller-preparando', null);
        if (!r.ok) return { ok: false, error: `No se pudo preparar Python: ${r.error}` };
    }

    actual.python = pythonDe(actual.taller);
    actual.encendido = true;
    try {
        fs.rmSync(path.join(actual.taller, tallerLib.PARAR), { force: true });
    } catch (e) { /* no estaba */ }

    latir();
    actual.reloj = setInterval(latir, LATIDO);
    if (actual.reloj.unref) actual.reloj.unref();
    actual.refresco = setInterval(avisarEstado, REFRESCO);
    if (actual.refresco.unref) actual.refresco.unref();

    anotarLog(actual.taller, `== Reviewer tomó el worker ${new Date().toISOString()} (NP ${actual.aLaVez})`);
    puente.anotar('taller.arranca', { aLaVez: actual.aLaVez, python: actual.python });
    pasada();
    return { ok: true };
}

/**
 * Apaga el worker y no deja nada corriendo.
 *
 * Se mata el GRUPO del `step.py` que lanzamos, por su PID en negativo, y nada
 * más: los ffmpeg cuelgan de él y se van con él. Nunca por nombre, que se
 * llevaría puesto el worker de una Terminal o un ffmpeg de otra app.
 */
function parar(porque) {
    if (!actual) return { ok: true };
    clearInterval(actual.reloj);
    clearInterval(actual.refresco);
    clearTimeout(actual.proximaRonda);
    actual.reloj = actual.refresco = actual.proximaRonda = null;

    if (actual.proceso) {
        const pid = actual.proceso.pid;
        actual.proceso = null;
        try { process.kill(-pid, 'SIGTERM'); } catch (e) { /* ya terminó */ }
        setTimeout(() => { try { process.kill(-pid, 'SIGKILL'); } catch (e) { /* ya no está */ } }, 2500).unref();
    }
    despierto(false);
    if (actual.encendido) {
        try { fs.rmSync(path.join(actual.taller, tallerLib.LATIDO), { force: true }); } catch (e) { /* ya no está */ }
        anotarLog(actual.taller, `== Reviewer soltó el worker${porque ? ` (${porque})` : ''}`);
    }
    actual.encendido = false;
    puente.anotar('taller.para', { porque: porque || 'a mano' });
    avisarEstado();
    return { ok: true };
}

/**
 * Tomar un taller: dejarlo listo y, si el ajuste lo dice, encenderlo.
 *
 * Si es el mismo que ya se tenía, no se hace nada más que recordar la raíz:
 * abrir para revisar la carpeta del curso que ya se está renderizando no
 * puede cortar una pasada a la mitad para volver a arrancar la misma.
 */
function adoptar(taller, raiz) {
    if (actual && actual.taller === taller) {
        actual.raiz = raiz;
        avisarEstado();
        return taller;
    }
    cerrar();
    actual = {
        raiz,
        taller,
        encendido: false,
        proceso: null,
        bloqueo: null,
        reloj: null,
        refresco: null,
        proximaRonda: null,
        python: pythonDe(taller),
        aLaVez: cuantosALaVez(),
        avisos: [],
        falta: [],
        // La foto de la lectura anterior, para avisar solo de lo que cambió.
        visto: null
    };
    // Se recuerda para la próxima vez que se abra la app sin carpeta: la
    // pestaña Render tiene que tener de dónde sacar el curso.
    ajustesLib.parchear({ taller: { ultimo: taller } });
    puente.anotar('taller.encontrado', { taller, aLaVez: actual.aLaVez });
    if (ajustesLib.leer().taller.arranque === 'solo') arrancar();
    avisarEstado();
    return taller;
}

/** La carpeta abierta cambió: se busca su taller y se adopta. */
function abrir(raiz) {
    const taller = tallerLib.buscar(raiz);
    if (!taller) {
        // Sin taller en esta carpeta se sigue con el que hubiera: abrir una
        // carpeta suelta para mirar un video no tiene por qué apagar el
        // render de otro curso.
        avisarEstado();
        return null;
    }
    return adoptar(taller, raiz);
}

/**
 * Al abrir la app: volver al último taller y, si no hay uno recordado,
 * deducirlo de las carpetas recientes.
 *
 * Es lo que hace que el render esté activo desde que la app abre, sin esperar
 * a que alguien abra una carpeta. El render no depende de lo que el editor
 * esté mirando, pero Reviewer tiene que saber en qué curso está trabajando
 * Claude, y eso no lo puede adivinar: lo aprende. Primero de lo que recordó la
 * última vez; si no hay nada —la app recién actualizada, o un ajuste
 * borrado— de las carpetas que el editor abrió antes, que casi siempre son
 * las de renders de ese mismo curso y tienen el taller dos niveles arriba.
 * Recién si nada de eso da, la pestaña pide elegirlo.
 *
 * Si el taller ya no está —se movió el curso, se borró— se sigue con el
 * siguiente candidato.
 */
function restaurar() {
    const ajustes = ajustesLib.leer();
    const candidatos = [
        ajustes.taller.ultimo ? path.dirname(ajustes.taller.ultimo) : null,
        ...ajustes.carpetasRecientes
    ].filter(Boolean);
    for (const raiz of candidatos) {
        const taller = tallerLib.buscar(raiz);
        if (taller) return adoptar(taller, raiz);
    }
    return null;
}

/**
 * Elegir el curso a mano, desde la pestaña Render.
 *
 * Vale la carpeta del curso, la del taller o cualquiera de hasta tres niveles
 * adentro: `buscar` sube. Lo que no se encuentra se dice con el nombre de la
 * carpeta, que es lo que el editor va a mirar para entender qué eligió mal.
 */
async function elegir() {
    const r = await dialog.showOpenDialog(puente.ventanaPrincipal(), {
        properties: ['openDirectory'],
        buttonLabel: 'Renderizar acá',
        message: 'La carpeta del curso: la que tiene _claude_edit adentro, o una de sus carpetas de renders.'
    });
    if (r.canceled || !r.filePaths.length) return { ok: false, cancelado: true };
    const elegida = r.filePaths[0];
    const taller = tallerLib.buscar(elegida);
    if (!taller) {
        return { ok: false, error: `«${path.basename(elegida)}» no tiene un taller de Claude: hace falta _claude_edit con step.py adentro.` };
    }
    adoptar(taller, elegida);
    return { ok: true, taller };
}

/** Se cerró la carpeta o la app. */
function cerrar() {
    if (!actual) return;
    parar('se cerró la carpeta');
    actual = null;
}

function registrar(dependencias) {
    puente = { ...puente, ...dependencias };

    ipcMain.handle('taller-estado', () => {
        avisarEstado();
        return actual ? tallerLib.estadoDe(actual.taller) : null;
    });
    ipcMain.handle('taller-arrancar', (e, opciones) => arrancar(opciones || {}));
    ipcMain.handle('taller-parar', () => parar());
    ipcMain.handle('taller-log', () => (actual ? tallerLib.colaDe(path.join(actual.taller, tallerLib.LOG), 256 * 1024) : []));
    ipcMain.handle('taller-carpeta', () => (actual ? actual.taller : null));
    ipcMain.handle('taller-elegir', () => elegir());
}

module.exports = { registrar, abrir, restaurar, cerrar, arrancar, parar };
