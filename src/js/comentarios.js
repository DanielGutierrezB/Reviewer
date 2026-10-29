'use strict';
/**
 * comentarios.js — El panel de la derecha: las tarjetas de lo que se comentó.
 *
 * La tarjeta es el comentario, no un formulario para editarlo: el texto se
 * edita en el mismo lugar donde se lee (`contenteditable`) y se guarda al salir
 * del campo. Un botón «Editar» que abre un modal obliga a dos clics y a una
 * decisión —"¿guardo o cancelo?"— por cada corrección de una coma.
 *
 * **El timecode es un botón** y lleva el cabezal ahí. Es el movimiento que más
 * se repite al revisar: leer un comentario viejo y querer ver de qué hablaba.
 *
 * **Resaltar un comentario no repinta la lista.** Parece un detalle de
 * rendimiento y es lo que hacía que editar el texto no funcionara: al hacer
 * clic adentro del campo, el clic burbujeaba hasta la lista, la lista se
 * repintaba entera y el nodo donde estaba el cursor dejaba de existir en el
 * mismo gesto. Había que mantener el botón apretado para alcanzar a escribir.
 * Por eso hay dos funciones: `pintar` rehace las tarjetas cuando cambiaron los
 * comentarios, y `resaltar` solo mueve clases.
 */

import { $, $$, avisar, escapar } from './chrome.js';
import { estado, comentarios, comentarioPorId, fps, rutaActual } from './estado.js';
import * as fmt from './formato.js';
import * as reproductor from './reproductor.js';
import * as historial from './historial.js';
import * as adjuntos from './adjuntos.js';
// Con nombre largo y no `campo`: adentro del `focusout` ya hay una variable
// `campo` que es el nodo del DOM, y dos cosas con el mismo nombre en dos
// alcances distintos es una trampa para el que venga a tocar esto.
import * as campoMenciones from './menciones-campo.js';
import * as menu from './menu-arroba.js';

/** Quien escucha. Lo pone `app.js`. */
export const al = { cambio: () => {} };

/**
 * El texto con las menciones como chips.
 *
 * Se escapa primero y se arma el chip después: al revés, un comentario que
 * dijera `<script>` se insertaría como etiqueta.
 *
 * **Cada chip es atómico y lleva su token entero en un atributo.** Eso arregla
 * un bug que venía de antes y que perdía referencias en silencio: el chip
 * muestra un texto corto —`@2`, o el nombre del archivo— y el campo es un
 * `contenteditable`, así que el guardado, que leía `innerText`, guardaba lo
 * que se VEÍA. Abrir un comentario con una mención, tocarle una letra y salir
 * dejaba escrito `@logo.svg`, que ya no empareja con `RE_MENCION`: la mención
 * dejaba de resolverse y Claude dejaba de recibir la ruta del archivo. Nada
 * fallaba. Ahora el guardado pasa por `serializar`, que lee el atributo.
 *
 * El token va en un **atributo** y no en una propiedad JS porque un
 * `contenteditable` tiene caminos que clonan nodos —el deshacer nativo del
 * navegador, arrastrar un pedazo de texto de un lado al otro— y el clon se
 * lleva los atributos pero no las propiedades. Un chip clonado sin el atributo
 * volvería a guardar su etiqueta.
 */
function conMenciones(texto, tira) {
    return campoMenciones.partir(texto).map(p => {
        if (p.token == null) return escapar(p.texto);
        const colgada = campoMenciones.estaColgada(p.crudo, tira, estado.referencias);
        return `<span class="mencion${colgada ? ' is-colgada' : ''}" contenteditable="false"`
            + ` data-token="${escapar(p.token)}" title="${escapar(p.crudo)}">`
            + `${escapar(campoMenciones.etiquetaDe(p.crudo, tira))}</span>`;
    }).join('');
}

/**
 * Lo que hay que guardar de un campo: el texto con los tokens enteros.
 *
 * Recorre los hijos y devuelve el `data-token` del que lo tenga y el texto del
 * que no. Es la vuelta exacta de `conMenciones`, y lo que reemplazó al
 * `innerText` que destruía las menciones.
 */
function serializar(nodo) {
    return campoMenciones.unir([...nodo.childNodes].map(n => {
        const token = n.nodeType === 1 && n.getAttribute('data-token');
        return token ? { token } : { texto: n.textContent };
    }));
}

function cuandoDe(c) {
    return c.tHasta
        ? `${fmt.timecode(c.t, fps())} → ${fmt.timecode(c.tHasta, fps())}`
        : fmt.timecode(c.t, fps());
}

function tarjeta(c) {
    const li = document.createElement('li');
    li.className = `comentario es-${c.estado}${estado.mirado === c.id ? ' is-mirado' : ''}`;
    li.dataset.id = c.id;

    const cabecera = document.createElement('div');
    cabecera.className = 'comentario-cabecera';
    cabecera.innerHTML = `
        <span class="comentario-id">${escapar(c.id)}</span>
        <button type="button" class="comentario-cuando" title="Ir a este momento">${escapar(cuandoDe(c))}</button>
        <span class="comentario-acciones">
            <button type="button" class="icono icono-chico" data-accion="estado"
                    title="${c.estado === 'abierto' ? 'Marcar como resuelto' : 'Volver a abrirlo'}">${c.estado === 'abierto' ? '✓' : '↺'}</button>
            <button type="button" class="icono icono-chico" data-accion="mejorar" title="Mejorar la redacción">✦</button>
            <button type="button" class="icono icono-chico" data-accion="adjuntar" title="Adjuntarle un archivo">📎</button>
            <button type="button" class="icono icono-chico" data-accion="borrar" title="Borrar">✕</button>
        </span>`;
    li.appendChild(cabecera);

    const texto = document.createElement('div');
    texto.className = 'comentario-texto';
    texto.contentEditable = 'plaintext-only';
    texto.spellcheck = true;
    texto.dataset.accion = 'texto';
    texto.innerHTML = conMenciones(c.texto, c.tira);
    li.appendChild(texto);

    const tiraDeC = c.tira || [];
    if (tiraDeC.length || c.textoCrudo) {
        const tira = document.createElement('div');
        tira.className = 'comentario-tira';
        tira.innerHTML = tiraDeC.map(adjuntos.cuadrito).join('');
        if (c.textoCrudo) {
            tira.innerHTML += '<button type="button" class="btn btn-ghost btn-chico" data-accion="crudo">Texto original</button>';
        }
        li.appendChild(tira);
    }

    const lista = adjuntos.listaDe(c);
    if (lista) {
        const caja = document.createElement('div');
        caja.className = 'adj-caja';
        caja.innerHTML = lista;
        li.appendChild(caja);
    }

    // La tarjeta entera recibe archivos soltados, no solo la caja de adjuntos:
    // cuando uno arrastra un logo y lo suelta sobre «c03», lo que está
    // apuntando es el comentario, no un recuadro de 20 px adentro de él.
    adjuntos.zonaDeSoltar(li, entradas => adjuntarA(c.id, entradas));

    return li;
}

/** Repinta las tarjetas, el badge y las marcas de la línea de tiempo. */
export function pintar() {
    const lista = $('#comentarios');
    const vacio = $('#comentarios-vacio');
    lista.textContent = '';

    const cs = comentarios();
    for (const c of cs) lista.appendChild(tarjeta(c));
    vacio.hidden = cs.length > 0;

    const cuenta = (estado.datos && estado.datos.cuenta) || { abiertos: 0, resueltos: 0, total: 0 };
    const badge = $('#video-badge');
    badge.textContent = cuenta.total
        ? `${cuenta.abiertos} por hacer${cuenta.resueltos ? ` · ${cuenta.resueltos} ✓` : ''}`
        : 'sin comentarios';
    badge.className = `badge${cuenta.abiertos ? ' is-pendiente' : (cuenta.total ? ' is-lleno' : '')}`;

    const alcance = $('#video-alcance');
    if (estado.version) {
        const clase = estado.clases.find(c => c.id === estado.claseId);
        alcance.textContent = `Solo para «${clase ? clase.nombre : ''} v${estado.version.n}». Se guardan al lado del render.`;
    }

    // El resumen para Claude.
    const inst = estado.datos && estado.datos.instruccion;
    $('#instruccion').hidden = !inst;
    if (inst) {
        $('#instruccion-texto').textContent = inst.texto;
        $('#instruccion-pie').textContent = inst.modelo ? `Lo escribió ${inst.modelo}` : '';
    }

    $('#btn-mejorar-todos').disabled = !cs.some(c => c.estado === 'abierto');
    $('#btn-preparar').disabled = !cs.some(c => c.estado === 'abierto');
    $('#btn-copiar-ruta').disabled = !(estado.datos && estado.datos.existeFeedback);

    reproductor.pintarMarcas();
}

/** Mueve el resaltado sin tocar el contenido de ninguna tarjeta. */
export function resaltar() {
    for (const nodo of $$('.comentario')) {
        nodo.classList.toggle('is-mirado', nodo.dataset.id === estado.mirado);
    }
    reproductor.pintarMarcas();
}

/** Resalta un comentario y, si tiene dibujo, lo muestra sobre el video. */
export function mirar(id, irAlTiempo) {
    const c = comentarioPorId(id);
    estado.mirado = c ? id : null;
    reproductor.mostrarDibujo(c && c.dibujoUrl ? c.dibujoUrl : null);
    if (c && irAlTiempo) {
        reproductor.pausar();
        reproductor.irA(c.t);
    }
    resaltar();
    if (!c) return;
    const nodo = $(`.comentario[data-id="${id}"]`);
    if (nodo) nodo.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

// ─── Nombrar un archivo desde el texto ────────────────────────────────

/**
 * Dónde había quedado el cursor en cada campo.
 *
 * Hace falta porque para tocar una miniatura hay que sacarle el foco al campo:
 * cuando llega el clic, la selección del documento ya no está adentro del
 * texto. Se anota en cada `blur`, `keyup` y `mouseup`, igual que HyperPremiere.
 *
 * Es un `WeakMap` y no un campo del nodo para que los rangos de las tarjetas
 * que se repintan se vayan solos con el nodo viejo: `pintar()` rehace todas
 * las tarjetas en cada cambio y un `Map` común iría creciendo toda la sesión.
 */
const cursores = new WeakMap();

function recordarCursor(nodo) {
    const sel = document.getSelection();
    if (!sel || !sel.rangeCount) return;
    const rango = sel.getRangeAt(0);
    if (nodo.contains(rango.startContainer)) cursores.set(nodo, rango.cloneRange());
}

/**
 * Mete la mención de un archivo en el texto de la tarjeta, donde está el cursor.
 *
 * Se inserta sobre el DOM y no reescribiendo el string del campo. Es a
 * propósito: el campo tiene chips atómicos adentro, así que «la posición del
 * cursor» no es un número de caracteres del texto guardado —entre lo que se ve
 * y lo que se guarda hay una traducción—, y hacer la cuenta sería inventar una
 * aritmética de equivalencias que puede desincronizarse. Con un `Range` el
 * navegador ya sabe dónde está el cursor, y `serializar` se encarga del resto
 * al salir del campo.
 *
 * **No guarda.** El guardado sigue siendo el `focusout` de siempre, así que
 * tocar cuatro miniaturas y salir es UN paso de historial y UNA reescritura
 * del `feedback.md`, no cuatro. Es el mismo criterio de «Mejorar todos».
 */
function nombrarEn(nodo, token) {
    const doc = nodo.ownerDocument;
    let rango = cursores.get(nodo);
    if (!rango || !nodo.contains(rango.startContainer)) {
        // El campo nunca se tocó en esta sesión: al FINAL, nunca al principio.
        // Es el caso más común —leer una tarjeta vieja y tocarle la miniatura—
        // y meter la referencia antes de la primera palabra parte la frase que
        // ya estaba escrita.
        rango = doc.createRange();
        rango.selectNodeContents(nodo);
        rango.collapse(false);
    }
    rango.deleteContents();

    // Qué hay pegado al cursor de cada lado, para decidir los espacios. Se
    // pregunta con dos rangos y no contando caracteres por el mismo motivo de
    // arriba: `toString()` ya devuelve el texto visible de un tramo.
    const izquierda = rango.cloneRange();
    izquierda.setStart(nodo, 0);
    const derecha = rango.cloneRange();
    derecha.setEnd(nodo, nodo.childNodes.length);

    // Y la regla de qué espacios van sale de `menciones-campo.js`, la misma
    // que usa el redactor: acá los dos lados son nodos y allá son slices de un
    // string, pero `toString()` deja las dos cosas en texto plano y la decisión
    // es una sola.
    const { izq, der } = campoMenciones.espacios(izquierda.toString(), derecha.toString());

    const trozos = [];
    if (izq) trozos.push(doc.createTextNode(izq));
    const chip = doc.createElement('span');
    chip.className = 'mencion';
    chip.contentEditable = 'false';
    chip.setAttribute('data-token', token);
    chip.textContent = '…';
    trozos.push(chip);
    if (der) trozos.push(doc.createTextNode(der));

    const bloque = doc.createDocumentFragment();
    for (const t of trozos) bloque.appendChild(t);
    rango.insertNode(bloque);

    // El chip se repinta con su etiqueta real recién acá: su número sale de la
    // tira del comentario, y acá ya se sabe en qué tarjeta cayó.
    const id = nodo.closest('.comentario').dataset.id;
    const c = comentarioPorId(id);
    const crudo = token.slice(2, -1);
    chip.textContent = campoMenciones.etiquetaDe(crudo, c && c.tira);
    chip.title = crudo;

    const fin = doc.createRange();
    fin.setStartAfter(trozos[trozos.length - 1]);
    fin.collapse(true);
    const sel = doc.getSelection();
    sel.removeAllRanges();
    sel.addRange(fin);
    nodo.focus();
    cursores.set(nodo, fin.cloneRange());
}

/** Lo que el menú del `@` ofrece parado en una tarjeta: la tira de ESE comentario. */
export function candidatosDe(nodo) {
    const tarjetaNodo = nodo.closest('.comentario');
    if (!tarjetaNodo) return [];
    const c = comentarioPorId(tarjetaNodo.dataset.id);
    return ((c && c.tira) || []).filter(i => !i.falta).map(i => ({
        ...i,
        detalle: i.uso ? (adjuntos.usos()[i.uso] || {}).corto : 'de este comentario'
    }));
}

/**
 * Mete el token elegido en el menú, borrando antes lo que se había tecleado.
 *
 * La consulta (`@2`) vive siempre adentro de un solo nodo de texto —no puede
 * tener espacios ni corchetes, y los chips son nodos aparte—, así que se borra
 * con un rango sobre ese nodo y no contando caracteres del texto entero.
 */
export function elegirDelMenu(nodo, item, donde) {
    if (donde.nodoTexto) {
        const r = document.createRange();
        r.setStart(donde.nodoTexto, donde.desde);
        r.setEnd(donde.nodoTexto, donde.hasta);
        r.deleteContents();
        const sel = document.getSelection();
        sel.removeAllRanges();
        r.collapse(true);
        sel.addRange(r);
        cursores.set(nodo, r.cloneRange());
    }
    nombrarEn(nodo, item.token);
}

function decirEstado(texto, tono) {
    const p = $('#panel-estado');
    p.textContent = texto || '';
    p.className = `panel-estado${tono ? ` is-${tono}` : ''}`;
}

/**
 * Hace un cambio en el disco, repinta y lo anota en el historial.
 *
 * Todo lo que toca comentarios pasa por acá, y por eso todo se puede deshacer
 * sin que cada acción tenga que acordarse de hacerlo. La foto de «antes» es lo
 * que había en pantalla, que es exactamente lo que el motor tenía cargado.
 */
async function cambiar(nombre, promesa) {
    const antes = estado.datos;
    const datos = await promesa;
    estado.datos = datos;
    if (nombre) historial.registrar(nombre, antes, datos);
    pintar();
    al.cambio();
    return datos;
}

/** Pone en pantalla un estado que vino del historial. */
export function adoptar(datos) {
    estado.datos = datos;
    // El comentario que estaba resaltado puede haber dejado de existir.
    if (estado.mirado && !datos.comentarios.some(c => c.id === estado.mirado)) {
        estado.mirado = null;
        reproductor.mostrarDibujo(null);
    }
    pintar();
    al.cambio();
}

/**
 * Le cuelga archivos a un comentario que ya está guardado.
 *
 * No pasa por `cambiar` porque el motor devuelve más que el estado —también
 * qué no se pudo copiar—, y eso hay que decirlo: un archivo que estaba en un
 * disco que se desmontó se perdería en silencio, y el editor creería que lo
 * mandó. El historial se anota igual, a mano, para que ⌘Z lo desande.
 */
async function adjuntarA(id, entradas) {
    if (!entradas || !entradas.length) return;
    decirEstado(entradas.length === 1 ? 'Copiando el archivo…' : `Copiando ${entradas.length} archivos…`);

    const antes = estado.datos;
    const r = await window.rv.comentarioAdjuntar(rutaActual(), id, entradas);
    estado.datos = r.estado;
    if (r.puestos.length) historial.registrar(`adjuntar a ${id}`, antes, r.estado);
    pintar();
    al.cambio();

    const fallados = r.fallados.map(f => `«${f.nombre}» (${f.motivo})`).join(', ');
    decirEstado(
        fallados
            ? `${r.puestos.length} en ${id}. No entraron: ${fallados}`
            : `${r.puestos.length === 1 ? 'Un archivo' : `${r.puestos.length} archivos`} en ${id}. `
                + 'Mirá que diga bien si es para mirar o para usar.',
        fallados ? 'mal' : 'bien'
    );
}

/** Mejora la redacción de un comentario con el modelo local. */
async function mejorar(id) {
    const c = comentarioPorId(id);
    if (!c || !c.texto.trim()) return;
    decirEstado('Mejorando la redacción…');
    const r = await window.rv.refinar({ texto: c.texto, origen: 'escrito' });
    if (!r.ok) {
        // Lo que se escribió a mano no se pisa con nada: queda como está y se
        // dice por qué. Es la diferencia con el dictado, donde el crudo es lo
        // que acababa de entrar y pisarlo no pierde trabajo.
        decirEstado(`${c.id}: ${r.motivo}`, 'mal');
        return;
    }
    await cambiar(`mejorar ${c.id}`, window.rv.comentarioEditar(rutaActual(), id, { texto: r.texto, textoCrudo: c.texto }));
    decirEstado(`${c.id} reescrito por ${r.modelo}`, 'bien');
}

export function wire() {
    const lista = $('#comentarios');

    lista.addEventListener('click', async evento => {
        const tarjetaNodo = evento.target.closest('.comentario');
        if (!tarjetaNodo) return;
        const id = tarjetaNodo.dataset.id;
        const accion = evento.target.dataset.accion
            || (evento.target.closest('.comentario-cuando') ? 'ir' : null);

        switch (accion) {
            case 'ir':
                mirar(id, true);
                return;
            case 'ver-dibujo':
                mirar(id, true);
                return;
            case 'estado': {
                const c = comentarioPorId(id);
                await cambiar(
                    c.estado === 'abierto' ? `resolver ${id}` : `reabrir ${id}`,
                    window.rv.comentarioEditar(rutaActual(), id, {
                        estado: c.estado === 'abierto' ? 'resuelto' : 'abierto'
                    })
                );
                return;
            }
            case 'mejorar':
                await mejorar(id);
                return;
            // Tocar una miniatura la NOMBRA en el texto; ya no lleva el cabezal
            // ni muestra el dibujo. Esas dos cosas no se perdieron: el timecode
            // de arriba sigue llevando al momento y seleccionar la tarjeta
            // sigue poniendo el dibujo sobre el video. Lo que se ganó es lo que
            // pidió el editor, que es poder decir «la 2» adentro de la frase.
            case 'nombrar': {
                const boton = evento.target.closest('[data-accion="nombrar"]');
                nombrarEn(tarjetaNodo.querySelector('[data-accion="texto"]'), boton.dataset.token);
                return;
            }
            case 'adjuntar':
                await adjuntarA(id, await adjuntos.delDialogo());
                return;
            case 'adjunto-quitar': {
                const archivo = evento.target.closest('.adj').dataset.clave;
                await cambiar(
                    `quitar un adjunto de ${id}`,
                    window.rv.comentarioAdjuntoQuitar(rutaActual(), id, archivo)
                );
                decirEstado(`Adjunto quitado de ${id}. ⌘Z lo trae de vuelta.`);
                return;
            }
            case 'crudo': {
                const c = comentarioPorId(id);
                await cambiar(`volver al original de ${id}`, window.rv.comentarioEditar(rutaActual(), id, {
                    texto: c.textoCrudo, textoCrudo: null
                }));
                return;
            }
            // Borrar no pregunta. Preguntaba cuando era definitivo; ahora el
            // comentario vuelve entero con ⌘Z —cuadro y dibujo incluidos,
            // porque esperan en la papelera de la versión— y un cartel de
            // confirmación por cada borrado es un clic de más en lo que uno
            // hace veinte veces por revisión.
            case 'borrar': {
                if (estado.mirado === id) {
                    estado.mirado = null;
                    reproductor.mostrarDibujo(null);
                }
                await cambiar(`borrar ${id}`, window.rv.comentarioBorrar(rutaActual(), id));
                decirEstado(`${id} borrado. ⌘Z lo trae de vuelta.`);
                return;
            }
            default:
                mirar(id, false);
        }
    });

    // Cambiar «de referencia» por «tal cual» es un cambio del feedback como
    // cualquier otro: va al disco y entra al historial. Lo que elige acá el
    // editor es lo que Claude va a leer como una orden.
    lista.addEventListener('change', async evento => {
        if (evento.target.dataset.accion !== 'adjunto-uso') return;
        const fila = evento.target.closest('.adj');
        const id = fila.closest('.comentario').dataset.id;
        await cambiar(
            `cambiar para qué sirve un adjunto de ${id}`,
            window.rv.comentarioAdjuntoUso(rutaActual(), id, fila.dataset.clave, evento.target.value)
        );
    });

    // Dónde quedó el cursor, para que el clic en una miniatura sepa dónde
    // meter la mención. Los tres eventos porque el cursor se mueve con el
    // teclado, con el mouse y al salir del campo. Y de paso se revisa si hay
    // que abrir el menú del `@`.
    for (const cual of ['keyup', 'mouseup', 'blur']) {
        lista.addEventListener(cual, evento => {
            const campo = evento.target.closest && evento.target.closest('[data-accion="texto"]');
            if (!campo) return;
            recordarCursor(campo);
            if (cual === 'blur') menu.cerrar(); else menu.revisar(campo);
        }, true);
    }

    // Las teclas del menú se atajan antes de que lleguen al campo: una flecha
    // abajo que se escape mueve el cursor en vez de la selección del menú, y
    // un Enter que se escape deja un renglón suelto en el comentario.
    lista.addEventListener('keydown', evento => {
        if (!evento.target.closest('[data-accion="texto"]')) return;
        if (menu.teclas(evento)) {
            evento.preventDefault();
            evento.stopPropagation();
        }
    }, true);

    // Las dos puntas de la misma referencia se iluminan juntas. En una tarjeta
    // de 376 px el texto y la tira están a cuatro centímetros, así que alcanza
    // con el resaltado y no hace falta un globo con la miniatura adentro.
    lista.addEventListener('mouseover', evento => {
        const chip = evento.target.closest('.mencion');
        const mini = evento.target.closest('[data-accion="nombrar"]');
        const token = chip ? `@[${chip.title}]` : (mini ? mini.dataset.token : null);
        if (!token) return;
        const tarjetaNodo = evento.target.closest('.comentario');
        for (const n of tarjetaNodo.querySelectorAll(`[data-accion="nombrar"][data-token="${CSS.escape(token)}"]`)) {
            n.classList.add('is-apuntado');
        }
        for (const n of tarjetaNodo.querySelectorAll('.mencion')) {
            n.classList.toggle('is-apuntado', `@[${n.title}]` === token);
        }
    });
    lista.addEventListener('mouseout', () => {
        for (const n of $$('.is-apuntado')) n.classList.remove('is-apuntado');
    });

    // El texto se guarda al salir del campo y no en cada tecla: cada guardado
    // reescribe el `feedback.md` entero, y hacerlo por letra sería escribir el
    // archivo cuarenta veces por frase.
    lista.addEventListener('focusout', async evento => {
        const campo = evento.target.closest('[data-accion="texto"]');
        if (!campo) return;
        const id = campo.closest('.comentario').dataset.id;
        const c = comentarioPorId(id);
        // `serializar` y no `innerText`: el chip muestra «@2» y lo que hay que
        // guardar es `@[adjunto/paleta.png]`. Ver la cabecera de `conMenciones`.
        const nuevo = serializar(campo).trim();
        if (!c || nuevo === c.texto.trim()) return;
        if (!nuevo) {
            // Vaciar un comentario no lo borra: borrar es el botón de borrar, y
            // un `Cmd+A` + Supr accidental no puede llevarse el cuadro.
            campo.innerHTML = conMenciones(c.texto, c.tira);
            decirEstado('Un comentario no puede quedar vacío: usá ✕ para borrarlo.', 'mal');
            return;
        }
        await cambiar(`editar ${id}`, window.rv.comentarioEditar(rutaActual(), id, { texto: nuevo }));
    });

    // Los veinte reescritos entran al historial como UN paso, no como veinte.
    // Deshacer tiene que desandar lo que uno hizo, y lo que uno hizo acá fue
    // apretar un botón: veinte ⌘Z para volver de un clic no es deshacer, es un
    // castigo. Por eso la foto de «antes» se saca antes del bucle y se registra
    // al final, a mano, en vez de dejar que cada vuelta se anote sola.
    $('#btn-mejorar-todos').addEventListener('click', async () => {
        const pendientes = comentarios().filter(c => c.estado === 'abierto' && c.texto.trim());
        const antes = estado.datos;
        let hechos = 0;
        const fallados = [];
        for (const c of pendientes) {
            decirEstado(`Mejorando ${c.id}… (${hechos + 1} de ${pendientes.length})`);
            const r = await window.rv.refinar({ texto: c.texto, origen: 'escrito' });
            if (r.ok) {
                await cambiar(null, window.rv.comentarioEditar(rutaActual(), c.id, { texto: r.texto, textoCrudo: c.texto }));
                hechos++;
            } else {
                fallados.push(`${c.id} (${r.motivo})`);
            }
        }
        if (hechos) historial.registrar(`mejorar ${hechos} comentarios`, antes, estado.datos);
        decirEstado(
            fallados.length
                ? `${hechos} reescritos. Quedaron como estaban: ${fallados.join(', ')}`
                : `${hechos} comentarios reescritos.`,
            fallados.length ? 'mal' : 'bien'
        );
    });

    $('#btn-preparar').addEventListener('click', async () => {
        decirEstado('Juntando todos los comentarios en un encargo…');
        const antes = estado.datos;
        const r = await window.rv.instruccionPreparar(rutaActual());
        if (!r.ok) {
            decirEstado(r.motivo, 'mal');
            return;
        }
        estado.datos = r.estado;
        historial.registrar('preparar el encargo', antes, r.estado);
        pintar();
        al.cambio();
        decirEstado(
            r.sinCitar && r.sinCitar.length
                ? `Listo, pero no nombró ${r.sinCitar.join(', ')}: revisalo antes de mandarlo.`
                : `Listo. Lo escribió ${r.modelo}.`,
            r.sinCitar && r.sinCitar.length ? 'mal' : 'bien'
        );
    });

    $('#btn-instruccion-borrar').addEventListener('click', async () => {
        await cambiar('quitar el encargo', window.rv.instruccionBorrar(rutaActual()));
        decirEstado('');
    });

    $('#btn-abrir-carpeta').addEventListener('click', () => {
        const carpeta = estado.datos && estado.datos.carpeta;
        // Si no hay comentarios la carpeta no existe —y eso es a propósito—, así
        // que se abre la del render, que es donde está el video.
        window.rv.abrirEnFinder(estado.datos && estado.datos.existeFeedback ? carpeta : rutaActual());
    });

    $('#btn-copiar-ruta').addEventListener('click', async () => {
        if (!estado.datos || !estado.datos.existeFeedback) return;
        await window.rv.copiar(estado.datos.rutaFeedback);
        avisar('Ruta copiada. Pegásela a Claude.', 'bien');
    });
}

export { cambiar, decirEstado };
