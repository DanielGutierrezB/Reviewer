'use strict';
/**
 * bordes.js — Corregir la entrada y la salida de un marcador que ya existe.
 *
 * Las teclas I y O, y también soltar el borde de una marca arrastrado con Opt.
 * Las tres cosas terminan acá porque son la misma: mover uno de los dos
 * tiempos de un marcador. Lo que cambia entre ellas es nada más de dónde sale
 * el marcador —las teclas lo deducen de dónde está el cabezal, el arrastre lo
 * señala con el dedo— y eso se resuelve antes de llamar.
 */

import { estado, comentarios, fps, rutaActual } from './estado.js';
import * as fmt from './formato.js';
import * as reproductor from './reproductor.js';
import * as panel from './comentarios.js';
import * as redactor from './redactor.js';
import * as marcadores from './marcadores.js';

/**
 * El borrador va primero y no pasa por `marcadores.js`: un comentario que se
 * está escribiendo todavía no está en el disco, así que no aparece en la línea
 * ni en ninguna lista, pero es más nuevo que cualquiera de los que están y es
 * del que uno está hablando. Mover sus tiempos es gratis —no hay nada escrito
 * que corregir— y el cuadro se saca recién al guardar, así que sale solo.
 */
async function corregirBorrador(lado, t) {
    const { t: desde, tHasta } = redactor.cuando();

    if (lado === 'entrada') {
        if (tHasta != null && t >= tHasta) {
            panel.decirEstado('La entrada tiene que ir antes de la salida.', 'mal');
            return;
        }
        redactor.abrir({ t, tHasta });
        return;
    }

    if (t <= desde) {
        panel.decirEstado('La salida tiene que ir después del comentario.', 'mal');
        return;
    }
    redactor.abrir({ t: desde, tHasta: t });
}

/**
 * Mueve un borde y, si hace falta, vuelve a sacar el cuadro.
 *
 * **El cuadro guardado es el de la entrada**, así que moverla deja un PNG que
 * muestra otro momento del que el comentario dice. Se vuelve a sacar, salvo
 * cuando el editor dibujó encima: ahí el PNG no es una ilustración del
 * instante sino el dibujo, y cambiarlo por el cuadro nuevo tiraría el trazo.
 * Entre perder un dibujo y que el cuadro quede unos cuadros corrido, lo
 * segundo se arregla mirando y lo primero no se arregla.
 */
async function guardarBorde(c, lado, t) {
    const ruta = rutaActual();
    const campo = lado === 'entrada' ? 't' : 'tHasta';

    await panel.cambiar(
        `mover la ${lado} de ${c.id}`,
        window.rv.comentarioEditar(ruta, c.id, { [campo]: t })
    );
    panel.mirar(c.id, false);

    const conDibujo = Boolean(c.dibujo) || Boolean(c.trazos && c.trazos.length);
    if (lado === 'entrada' && c.frame && !conDibujo) {
        const r = await window.rv.comentarioImagenes(ruta, c.id, t, null, await reproductor.cuadroCompuesto(t));
        if (r.ok) panel.adoptar(r.estado);
    }

    panel.decirEstado(
        lado === 'entrada'
            ? `${c.id} empieza en ${fmt.timecode(t, fps())}${conDibujo ? ' (el cuadro dibujado se queda donde estaba)' : ''}.`
            : `${c.id} va hasta ${fmt.timecode(t, fps())}.`,
        'bien'
    );
}

/**
 * I y O desde el teclado: a quién le hablan lo decide dónde está el cabezal.
 *
 * Lo primero es anclar el tiempo al comienzo de su cuadro. Lo que llega es el
 * `currentTime` crudo del video, que viene con unos microsegundos de más; sin
 * anclarlo, el borde quedaría guardado en un número que no es el principio de
 * ningún cuadro y el PNG saldría de otro lado que el timecode.
 */
export async function corregir(lado, crudo) {
    if (!estado.version) return;

    const f = fps();
    const t = fmt.segundosDe(fmt.cuadroDe(crudo, f), f);
    if (redactor.abierto()) return corregirBorrador(lado, t);

    const c = lado === 'entrada'
        ? marcadores.paraEntrada(comentarios(), t)
        : marcadores.paraSalida(comentarios(), t);

    if (!c) {
        panel.decirEstado(lado === 'entrada'
            ? 'No hay ningún marcador acá ni más adelante. Con M dejás uno donde estás.'
            : 'No hay ningún marcador sin cerrar antes de acá. Con M dejás uno donde estás.', 'mal');
        return;
    }

    // Ya estar donde se lo quiere poner no es un cambio. Se compara con medio
    // cuadro de margen y no con `===`: el tiempo guardado y el que devuelve el
    // video después de ir hasta él se parecen hasta el microsegundo pero no son
    // el mismo número, y sin el margen esto escribiría el disco y dejaría un
    // paso en el deshacer que no deshace nada.
    const yaEsta = lado === 'entrada' ? c.t : c.tHasta;
    if (yaEsta != null && Math.abs(t - yaEsta) < 1 / (2 * f)) {
        panel.decirEstado(`La ${lado} de ${c.id} ya está acá.`);
        return;
    }
    if (lado === 'entrada' && c.tHasta != null && t >= c.tHasta) {
        panel.decirEstado(`La entrada tiene que ir antes de la salida de ${c.id}.`, 'mal');
        return;
    }
    if (lado === 'salida' && t <= c.t) {
        panel.decirEstado(`La salida tiene que ir después de la entrada de ${c.id}.`, 'mal');
        return;
    }

    await guardarBorde(c, lado, t);
}

/** Soltar el borde de una marca arrastrado con Opt: el marcador ya está dicho. */
export async function ajustarBorde(id, lado, t) {
    const c = comentarios().find(x => x.id === id);
    // El reproductor ya frenó el borde a un cuadro del otro mientras se
    // arrastraba, así que acá no hay nada que validar: lo que llega es válido o
    // el comentario dejó de existir.
    if (c) await guardarBorde(c, lado, t);
}
