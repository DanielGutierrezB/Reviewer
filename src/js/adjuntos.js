'use strict';
/**
 * adjuntos.js — Colgarle archivos a un comentario: pegarlos, soltarlos o
 * elegirlos, y decir para qué sirve cada uno.
 *
 * El pedido era poder mandarle a Claude «una imagen de referencia» o «el logo
 * que va en el video», y que no se confundan. Acá adentro está la parte de la
 * ventana; la decisión de diseño entera —por qué esto no son las referencias
 * del curso— está en `engine/adjuntos.js`.
 *
 * **Lo que se está redactando vive en memoria.** La regla del proyecto es que
 * nada se crea en el disco hasta que hay un comentario de verdad, así que un
 * archivo soltado en el redactor no se copia a ningún lado: queda en `borrador`
 * con su ruta de origen (o con sus bytes, si vino del portapapeles) y recién
 * cuando se aprieta Comentar viaja al motor. Cancelar el redactor no tiene que
 * dejar una carpeta `adjuntos/` al lado de un render sin comentarios.
 *
 * **La miniatura se saca del archivo donde está.** Para un archivo del disco se
 * pide una url del protocolo propio (`adjuntoOjear`); para una imagen pegada,
 * que no tiene ruta, se arma un `data:`. Un `blob:` sería lo natural y no se
 * puede: la CSP de la ventana deja pasar `self`, `data:` y `reviewer:` y nada
 * más, y un `blob:` saldría como imagen rota sin decir por qué.
 *
 * **Las dos listas se pintan con la misma función.** El renglón del borrador y
 * el de un adjunto ya guardado se ven igual —miniatura, nombre, selector de
 * uso, ✕— porque son la misma cosa en dos momentos; que se vieran distinto
 * obligaría a aprender dos veces dónde está el selector que importa.
 */

import { $, avisar, escapar } from './chrome.js';

/**
 * Lo más pesado que puede cruzar el puente como bytes. **Son los mismos 64 MB
 * que `engine/adjuntos.js`, y si cambia uno cambian los dos.**
 *
 * Está escrito dos veces porque la ventana no tiene `require` y no hay canal
 * que lo traiga; hay un test que compara los dos archivos
 * (`tests/adjuntos.test.js`), por la misma razón por la que `formato.js` tiene
 * uno contra `engine/tiempo.js`.
 *
 * El motor lo vuelve a mirar y eso no sobra: el de allá es el que sostiene la
 * regla —escribe en la carpeta del editor y no puede confiar en que la ventana
 * haya chequeado—, y el de acá existe para no hacer el trabajo caro. Ver la
 * decisión completa en la cabecera de `TOPE_BYTES` en el motor.
 */
const TOPE_BYTES = 64 * 1024 * 1024;

/**
 * Cuánto pesa, para el cartel que dice que no entró.
 *
 * No es el `pesa` de `formato.js`, que redondea al MB más cercano: con ese, un
 * archivo de 64 MB y un byte se anuncia como «pesa 64 MB y no pueden pasar más
 * de 64 MB», un mensaje que se contradice solo. Acá se redondea para arriba
 * para que el número siempre caiga del lado correcto del tope. Es la misma
 * función que `enMB` en el motor y por el mismo motivo; están las dos porque la
 * ventana no tiene `require`, igual que las dos copias de `tiempo.js`.
 */
function enMB(bytes) {
    const mb = Math.ceil((Number(bytes || 0) / 1024 / 1024) * 10) / 10;
    return `${mb.toFixed(1).replace(/\.0$/, '')} MB`;
}

/**
 * La tabla de usos, tal como la escribió el motor.
 *
 * Se pide una vez y se guarda. No se escriben acá los dos rótulos a mano: son
 * los mismos que el motor va a poner en el `feedback.md`, y dos copias del
 * texto que distingue «mirá esto» de «usá esto» es cómo se consigue que el
 * editor elija una cosa y Claude lea otra.
 */
let USOS = null;

export async function cargarUsos() {
    if (!USOS) USOS = await window.rv.adjuntosUsos();
    return USOS;
}

export function usos() {
    return USOS || {};
}

function usoDe(id) {
    return usos()[id] || usos().referencia || { rotulo: id, ayuda: '' };
}

/** El uso con el que entra un adjunto nuevo. Lo decide el motor; ver su cabecera. */
function porDefecto() {
    return usos().referencia ? 'referencia' : Object.keys(usos())[0];
}

// ─── Lo que se está redactando ────────────────────────────────────────

/**
 * Los adjuntos del comentario que se está escribiendo.
 *
 * Fuera del módulo del redactor porque los recibe de tres lados (⌘V, soltar,
 * el botón) y los lee uno solo al guardar.
 */
const borrador = [];

export function hayEnBorrador() {
    return borrador.length;
}

export function vaciarBorrador() {
    borrador.length = 0;
}

/** Lo que hay que mandarle al motor. Sin la miniatura, que era solo para mirar. */
export function recogerBorrador() {
    return borrador.map(a => ({ nombre: a.nombre, uso: a.uso, origen: a.origen, bytes: a.bytes }));
}

/**
 * Suma archivos al borrador y repinta.
 *
 * Devuelve cuántos entraron, que es lo que el que llama necesita para decir
 * algo: un ⌘V sobre un portapapeles con texto no tiene que hacer nada y
 * tampoco tiene que mentir diciendo que adjuntó.
 */
export function sumarAlBorrador(entradas) {
    for (const entrada of entradas) borrador.push({ ...entrada, uso: entrada.uso || porDefecto() });
    pintarBorrador();
    return entradas.length;
}

// ─── Qué llegó: del portapapeles, de un arrastre o del diálogo ────────

/** El nombre de una imagen pegada, que viene sin ninguno. */
function nombrePegado(tipo) {
    const ext = (String(tipo || '').split('/')[1] || 'png').replace(/[^a-z0-9]/g, '').slice(0, 5);
    const ahora = new Date();
    const dos = n => String(n).padStart(2, '0');
    return `pegado-${ahora.getFullYear()}${dos(ahora.getMonth() + 1)}${dos(ahora.getDate())}`
        + `-${dos(ahora.getHours())}${dos(ahora.getMinutes())}${dos(ahora.getSeconds())}.${ext}`;
}

/**
 * Un `File` o `Blob` → bytes y una miniatura, los dos de la misma lectura.
 *
 * **El tamaño se mira antes del `arrayBuffer()`, que es el punto.** `blob.size`
 * está disponible sin leer nada; después ya se pagó todo —el archivo entero en
 * memoria, el base64 de 1,33× para la miniatura, el viaje por el puente— y lo
 * único que falta es el error. Con una imagen de 300 MB arrastrada desde Safari
 * eso son varios segundos de ventana congelada para no adjuntar nada.
 *
 * Lo que no entra vuelve con un `falla` y no como adjunto: `admitidos` lo saca
 * de la lista y lo dice. Tirar acá se llevaría puestos a los otros cuatro
 * archivos del mismo arrastre, que es la misma decisión que ya toma `escribir`
 * en el motor con lo que no se pudo copiar.
 */
async function deBlob(blob, nombre) {
    if (blob.size > TOPE_BYTES) {
        // Con el camino que sí funciona al lado del número: un archivo que está
        // en el disco se adjunta sin tope ninguno, y decir solo «no entra» deja
        // al editor creyendo que el archivo no se puede adjuntar nunca.
        const falla = `pesa ${enMB(blob.size)} y pegado o arrastrado desde otra app no pueden pasar más de `
            + `${enMB(TOPE_BYTES)}. Si está en el disco, arrastralo desde el Finder y va entero`;
        return { nombre, origen: null, bytes: null, vista: null, falla };
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const esImagen = /^image\//.test(blob.type || '');
    return {
        nombre,
        bytes,
        origen: null,
        // El `data:` se arma a mano desde los bytes que ya se leyeron, en vez
        // de con un segundo `FileReader`: leer dos veces un pegado de 8 MB se
        // nota en el tiempo que tarda en aparecer la miniatura, que es lo único
        // que el editor mira después de apretar ⌘V.
        vista: esImagen ? `data:${blob.type};base64,${base64(bytes)}` : null
    };
}

/** Bytes → base64 sin pasar por un string gigante de un solo golpe. */
function base64(bytes) {
    const TROZO = 0x8000;
    let texto = '';
    for (let i = 0; i < bytes.length; i += TROZO) {
        texto += String.fromCharCode.apply(null, bytes.subarray(i, i + TROZO));
    }
    return btoa(texto);
}

/**
 * Deja pasar lo que puede cruzar el puente, y dice lo que no.
 *
 * El aviso se da acá y no en quien llama porque los dos llamadores reparten las
 * entradas a sitios distintos —el borrador del redactor y el motor, por la
 * tarjeta de un comentario— y ninguno de los dos sabe que un archivo nunca
 * llegó a leerse. Quedarse callado sería lo peor de los dos mundos: la ventana
 * no se congela, pero soltar un archivo grande no hace absolutamente nada.
 *
 * Los rechazados van en UN solo cartel. `avisar` muestra de a uno y el último
 * tapa al anterior, así que un arrastre con tres archivos pesados diría nada
 * más que el nombre del tercero. Es la misma regla que ya sigue `app.js` al
 * juntar lo que falló al guardar un comentario.
 */
function admitidos(entradas) {
    const rechazados = entradas.filter(e => e.falla);
    if (rechazados.length) {
        avisar(rechazados.map(e => `«${e.nombre}» ${e.falla}.`).join(' '), 'mal');
    }
    return entradas.filter(e => !e.falla);
}

/**
 * Lo que trae un `paste`: las imágenes del portapapeles.
 *
 * Solo las imágenes. Un ⌘V con texto adentro del campo tiene que escribir el
 * texto como siempre —pegar una ruta copiada del Finder es algo que se hace— y
 * por eso el que llama solo corta el evento si de acá sale algo.
 */
export async function delPortapapeles(dataTransfer) {
    const salida = [];
    for (const item of [...(dataTransfer.items || [])]) {
        if (item.kind !== 'file') continue;
        const file = item.getAsFile();
        if (!file || !/^image\//.test(file.type || '')) continue;
        salida.push(await deBlob(file, file.name || nombrePegado(file.type)));
    }
    return admitidos(salida);
}

/**
 * Lo que trae un `drop`: archivos del Finder, o una imagen arrastrada de otra app.
 *
 * Para los del Finder alcanza con la ruta y se copian desde el motor, que es
 * mucho más barato que mandar un ProRes de 2 GB por el puente. Una imagen
 * arrastrada desde Safari o desde Vista Previa no tiene ruta —`rutaDe` devuelve
 * `null`— y entonces sí se mandan los bytes.
 *
 * El tope de 64 MB es solo de esa segunda rama, y por eso se filtra acá abajo y
 * no en el bucle: al que tiene ruta no se le mide nada porque no va a pasar por
 * el puente —lo copia `fs` del otro lado— y un ProRes de 4 GB es un adjunto
 * perfectamente válido.
 */
export async function delArrastre(dataTransfer) {
    const salida = [];
    for (const file of [...(dataTransfer.files || [])]) {
        const ruta = window.rv.rutaDe(file);
        if (ruta) {
            const { url } = await window.rv.adjuntoOjear(ruta);
            salida.push({ nombre: file.name || ruta.split('/').pop(), origen: ruta, bytes: null, vista: url });
        } else {
            salida.push(await deBlob(file, file.name || nombrePegado(file.type)));
        }
    }
    return admitidos(salida);
}

/** Lo que trae el botón: el diálogo del sistema ya devuelve ruta, nombre y vista. */
export async function delDialogo() {
    const elegidos = await window.rv.elegirAdjuntos();
    return elegidos.map(x => ({ nombre: x.nombre, origen: x.ruta, bytes: null, vista: x.url || null }));
}

// ─── Cómo se ve un adjunto ────────────────────────────────────────────

/** `pista final.wav` → `WAV`. Dice más que un clip: un clip ya se sabía. */
export function extensionDe(nombre) {
    const punto = String(nombre || '').lastIndexOf('.');
    return punto > 0 ? nombre.slice(punto + 1).toUpperCase().slice(0, 4) : 'ARCH';
}

/** El icono de lo que no es una imagen. */
function iconoDe(nombre) {
    return `<span class="adj-icono">${escapar(extensionDe(nombre))}</span>`;
}

/**
 * Un cuadrito de la tira numerada: la miniatura (o la extensión) con su número
 * encima y, al tocarlo, su mención en el texto.
 *
 * El número va en un badge sobre la esquina y no al lado, para que la tira no
 * crezca a lo ancho: en un panel de 376 px los cinco archivos de un comentario
 * tienen que seguir entrando en el mismo renglón.
 *
 * Es la misma función para la tarjeta guardada y para el redactor. Que se vean
 * iguales no es cosmético: el editor aprende una vez que el numerito de la
 * esquina es lo que puede escribir con `@`, y le sirve en los dos lados.
 *
 * El `title` dice las tres cosas que un número solo no puede: cuál es el
 * archivo, para qué sirve y que tocándolo se lo nombra. El «para qué sirve»
 * sale de `USOS[uso].corto`, el mismo lugar del que sale la frase que leerá
 * Claude.
 */
export function cuadrito(item) {
    const que = item.clave === 'cuadro' ? 'El cuadro'
        : item.clave === 'dibujo' ? 'El cuadro con el dibujo encima'
            : `«${item.nombre}»`;
    const paraQue = item.uso ? ` · ${(usos()[item.uso] || {}).corto || ''}` : '';
    const title = item.falta
        ? `${que} — no está en el disco, así que no tiene número`
        : `${item.numero}. ${que}${paraQue} · Tocalo para nombrarlo en el texto`;

    const vista = item.url || item.vista;
    const dentro = vista
        ? `<img src="${escapar(vista)}" alt="">`
        : `<span class="cuadrito-ext">${escapar(extensionDe(item.nombre))}</span>`;

    return `<button type="button" class="cuadrito${item.falta ? ' falta' : ''}"`
        + ` data-accion="nombrar" data-token="${escapar(item.token)}" title="${escapar(title)}">`
        + `${dentro}<span class="cuadrito-num">${escapar(item.falta ? '?' : String(item.numero))}</span>`
        + '</button>';
}

/**
 * Un renglón de adjunto.
 *
 * `donde` separa los dos contextos sin duplicar el HTML: `borrador` numera por
 * posición en la lista en memoria, `guardado` identifica por la ruta relativa
 * que está en el JSON.
 */
function renglon(a, donde, clave, numero) {
    const mini = a.vista || a.url
        ? `<img class="adj-mini" src="${escapar(a.vista || a.url)}" alt="">`
        : iconoDe(a.nombre);
    // El número del renglón es el mismo que el del badge de la tira y el mismo
    // que muestra el chip en el texto: el editor tiene que poder leer «3» en
    // la lista y escribir «@3» sin volver a contar.
    const badge = numero ? `<span class="adj-num">${numero}</span>` : '';
    const opciones = Object.values(usos()).map(u =>
        `<option value="${escapar(u.id)}"${u.id === a.uso ? ' selected' : ''}>${escapar(u.rotulo)}</option>`
    ).join('');

    return `
        <li class="adj" data-donde="${donde}" data-clave="${escapar(clave)}" title="${escapar(a.ruta || a.origen || a.nombre)}">
            <span class="adj-mini-caja">${mini}${badge}</span>
            <span class="adj-cuerpo">
                <span class="adj-nombre">${escapar(a.nombre)}</span>
                <select class="adj-uso" data-accion="adjunto-uso" aria-label="Para qué sirve ${escapar(a.nombre)}">${opciones}</select>
                <span class="adj-ayuda">${escapar(usoDe(a.uso).ayuda)}</span>
            </span>
            <button type="button" class="icono icono-chico" data-accion="adjunto-quitar" title="Quitarlo">✕</button>
        </li>`;
}

/**
 * La tira numerada del comentario que se está escribiendo.
 *
 * El motor tiene la función que cuenta (`engine/adjuntos.tira`) y es la que
 * manda en todos lados **menos acá**, porque acá todavía no hay nada en el
 * disco: la regla del proyecto es que no se escribe hasta que hay un
 * comentario, así que el borrador vive en memoria y el motor no puede verlo.
 *
 * La regla de conteo es la misma de allá —cuadro, dibujo y después los
 * adjuntos en el orden en que se colgaron, de 1 en adelante— y acá es más
 * simple porque nada puede faltar: todavía no se copió nada que se pueda
 * borrar por detrás. Si allá cambiara el orden, tiene que cambiar acá.
 *
 * @param {{conCuadro:boolean, conDibujo:boolean}} que qué casillas están tildadas
 */
export function tiraBorrador(que) {
    const items = [];
    if (que.conCuadro) items.push({ clave: 'cuadro', nombre: 'cuadro', tipo: 'imagen', uso: null, vista: que.cuadroUrl });
    if (que.conDibujo) items.push({ clave: 'dibujo', nombre: 'dibujo', tipo: 'imagen', uso: null, vista: null });
    for (const a of borrador) items.push({ clave: a.nombre, nombre: a.nombre, tipo: /^data:image\//.test(a.vista || '') || /\.(png|jpe?g|webp|gif)$/i.test(a.nombre) ? 'imagen' : 'documento', uso: a.uso, vista: a.vista });

    return items.map((item, i) => ({
        ...item,
        numero: i + 1,
        falta: false,
        token: `@[adjunto/${item.clave}]`,
        etiqueta: `@${i + 1}`
    }));
}

/** Los renglones de los adjuntos ya guardados de un comentario. */
export function listaDe(comentario) {
    const lista = comentario.adjuntos || [];
    if (!lista.length) return '';
    // El número sale de la tira que armó el motor y no de la posición en este
    // array: la tira cuenta también el cuadro y el dibujo, y se saltea lo que
    // falta en el disco. Contar acá por separado daría otro número que el del
    // badge de arriba, que es exactamente lo que no puede pasar.
    const tira = comentario.tira || [];
    return `<ul class="adj-lista">${lista.map(a => {
        const item = tira.find(i => i.clave === a.nombre);
        return renglon(a, 'guardado', a.archivo, item && item.numero);
    }).join('')}</ul>`;
}

export function pintarBorrador() {
    const lista = $('#redactor-adjuntos-lista');
    if (!lista) return;
    const tira = tiraBorrador(estadoDelBorrador());
    lista.innerHTML = borrador.map((a, i) => {
        const item = tira.find(t => t.clave === a.nombre);
        return renglon(a, 'borrador', String(i), item && item.numero);
    }).join('');
    $('#redactor-adjuntos-nota').hidden = borrador.length > 0;

    $('#redactor-tira').innerHTML = tira.map(cuadrito).join('');
    $('#redactor-tira-nota').hidden = tira.length === 0;
}

/**
 * Qué va a llevar el comentario que se está escribiendo, para poder numerarlo.
 *
 * Lo lee del DOM y no de `redactor.js` para no cruzar los dos módulos en los
 * dos sentidos: el redactor ya importa esto, y que esto importara al redactor
 * sería un ciclo.
 */
function estadoDelBorrador() {
    const cuadro = $('#redactor-cuadro');
    const dibujo = $('#redactor-dibujo');
    const mini = $('#redactor-cuadro-mini');
    return {
        conCuadro: Boolean(cuadro && cuadro.checked),
        conDibujo: Boolean(dibujo && dibujo.checked && !$('#adjunto-dibujo').hidden),
        cuadroUrl: mini && !mini.hidden ? mini.src : null
    };
}

/**
 * El cambio de uso y el ✕ del borrador, que no pasan por el disco.
 *
 * Los del borrador se atienden acá y los de un comentario guardado en
 * `comentarios.js`, porque esos sí tienen que ir al motor y entrar al
 * historial. El `data-donde` del renglón es el que dice cuál es cuál.
 */
export function wire() {
    const caja = $('#redactor-adjuntos-caja');

    caja.addEventListener('click', e => {
        const fila = e.target.closest('.adj');
        if (!fila || e.target.dataset.accion !== 'adjunto-quitar') return;
        borrador.splice(Number(fila.dataset.clave), 1);
        pintarBorrador();
    });

    caja.addEventListener('change', e => {
        const fila = e.target.closest('.adj');
        if (!fila || e.target.dataset.accion !== 'adjunto-uso') return;
        borrador[Number(fila.dataset.clave)].uso = e.target.value;
        pintarBorrador();
    });

    $('#redactor-adjuntar').addEventListener('click', async () => {
        sumarAlBorrador(await delDialogo());
    });
}

/**
 * Deja una zona lista para recibir archivos soltados.
 *
 * El resaltado se cuenta con un contador y no con un booleano: `dragleave`
 * salta también al pasar de la zona a un hijo suyo, y con un booleano el marco
 * parpadea mientras uno mueve el archivo por encima.
 */
export function zonaDeSoltar(nodo, recibir) {
    let dentro = 0;

    nodo.addEventListener('dragenter', e => {
        if (![...e.dataTransfer.types].includes('Files')) return;
        e.preventDefault();
        dentro++;
        nodo.classList.add('is-soltando');
    });
    nodo.addEventListener('dragover', e => {
        if (![...e.dataTransfer.types].includes('Files')) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
    });
    nodo.addEventListener('dragleave', () => {
        dentro = Math.max(0, dentro - 1);
        if (!dentro) nodo.classList.remove('is-soltando');
    });
    nodo.addEventListener('drop', async e => {
        if (![...e.dataTransfer.types].includes('Files')) return;
        e.preventDefault();
        // Se para acá: el `drop` de la pantalla de arranque abre una carpeta,
        // y sin esto soltar un archivo sobre una tarjeta llegaría también allá.
        e.stopPropagation();
        dentro = 0;
        nodo.classList.remove('is-soltando');
        await recibir(await delArrastre(e.dataTransfer), e);
    });
}
