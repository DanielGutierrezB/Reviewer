'use strict';
/**
 * formato.js — Los mismos tiempos que escribe el motor, para la pantalla.
 *
 * Es una copia chica de `engine/tiempo.js` y no un import: la ventana corre en
 * un contexto aislado sin `require`, y pasar cada formateo por el puente sería
 * un viaje de ida y vuelta por cada cuadro mientras el video corre. Las dos
 * copias tienen que decir lo mismo, y hay un test que lo comprueba
 * (`tests/formato.test.js`).
 */

const dos = n => String(n).padStart(2, '0');

export function fpsValido(fps) {
    const n = Number(fps);
    return Number.isFinite(n) && n > 0 && n < 1000 ? n : 25;
}

/**
 * Diez microsegundos de perdón antes de contar el cuadro. En SEGUNDOS.
 *
 * Acá es donde más se nota: `currentTime` vuelve del `<video>` recortado a
 * microsegundos —se le pide el cuadro 61 a 30 fps y contesta 2.033332 en vez de
 * 2.0333333333—, y sin tolerancia esa lectura cuenta el cuadro 60, así que la
 * flecha izquierda retrocede dos cuadros en vez de uno.
 *
 * Diez microsegundos son seis veces el peor error medido (1.67 µs) y el 0.06%
 * del cuadro más corto que la app maneja (60 fps). El razonamiento completo
 * —por qué en segundos y no en cuadros, y por qué pasarse para arriba es peor—
 * está en `engine/tiempo.js`, que es de donde esto es copia. **Los dos números
 * tienen que ser el mismo** y `tests/formato.test.js` lo comprueba.
 */
export const TOLERANCIA = 1e-5;

export function cuadroDe(segundos, fps) {
    return Math.floor((Math.max(0, Number(segundos) || 0) + TOLERANCIA) * fpsValido(fps));
}

export function segundosDe(cuadro, fps) {
    return Math.max(0, Number(cuadro) || 0) / fpsValido(fps);
}

export function timecode(segundos, fps) {
    const f = fpsValido(fps);
    const cuadros = cuadroDe(segundos, f);
    const porSegundo = Math.round(f);
    const total = Math.floor(cuadros / porSegundo);
    return [
        dos(Math.floor(total / 3600)),
        dos(Math.floor(total / 60) % 60),
        dos(total % 60),
        dos(cuadros % porSegundo)
    ].join(':');
}

export function reloj(segundos) {
    const t = Math.max(0, Math.floor(Number(segundos) || 0));
    const h = Math.floor(t / 3600);
    const m = Math.floor(t / 60) % 60;
    const s = t % 60;
    return h ? `${h}:${dos(m)}:${dos(s)}` : `${m}:${dos(s)}`;
}

export function fpsTexto(fps) {
    const f = fpsValido(fps);
    return Number.isInteger(f) ? String(f) : f.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

/** La ficha del render en un renglón, para debajo del nombre de la clase. */
export function ficha(media) {
    if (!media || !media.ok) return media && media.error ? media.error : '';
    const partes = [];
    partes.push(`${media.anchoReal}×${media.alto}`);
    partes.push(media.vertical ? '9:16' : '16:9');
    partes.push((media.codec || '').toUpperCase());
    partes.push(`${fpsTexto(media.fps)} fps`);
    partes.push(reloj(media.duracion));
    return partes.filter(Boolean).join(' · ');
}

/** Cuánto pesa algo, para la caché de Ajustes. */
export function pesa(bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} kB`;
    if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(0)} MB`;
    return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
}
