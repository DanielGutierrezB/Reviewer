'use strict';
/**
 * tiempo.js — Un instante del video, dicho de las tres maneras que alguien lo
 * puede necesitar.
 *
 * El editor señala un momento con el cabezal. Quien recibe ese comentario puede
 * ser Claude escribiendo código de HyperFrames o Remotion —donde un momento es
 * un número de cuadro y unos segundos con decimales— o Premiere, donde un
 * momento es `00:01:23:12`. No se sabe cuál de los dos, así que se escriben las
 * tres y nadie tiene que convertir nada:
 *
 *   00:01:23:12 · 83.400 s · cuadro 2500 @ 29.97
 *
 * Parece redundante y no lo es: una conversión hecha a ojo por el que lee es
 * una conversión que puede salir mal, y el que lee acá es un modelo que no
 * tiene el video delante para darse cuenta.
 *
 * **El cuadro se redondea hacia abajo y el timecode también.** Un instante de
 * 83.44 s a 29.97 cae dentro del cuadro 2500, que empieza en 83.417: el cuadro
 * que se está VIENDO es el 2500, no el 2501. Redondear al más cercano haría que
 * el PNG que se guarda y el cuadro que dice el texto fueran distintos la mitad
 * de las veces.
 */

/** Los fps que se usan si no se pudo medir el archivo. */
const FPS_PORDEFECTO = 25;

function fpsValido(fps) {
    const n = Number(fps);
    return Number.isFinite(n) && n > 0 && n < 1000 ? n : FPS_PORDEFECTO;
}

/**
 * Lo que se le perdona a un instante antes de contar el cuadro, en SEGUNDOS.
 *
 * El `<video>` no devuelve el instante que se le pidió. Chromium guarda el
 * tiempo del medio en microsegundos, así que `currentTime` vuelve recortado a
 * seis decimales: se le pide el comienzo del cuadro 61 a 30 fps
 * —2.0333333333 s— y contesta 2.033332. Sin tolerancia `floor` lee ahí el
 * cuadro 60, y entonces retroceder un cuadro arranca del 60 y aterriza en el
 * 59: un paso para atrás salta dos. Medido en la app, pasaba en 121 de los 180
 * cuadros de un render a 30 fps.
 *
 * **Va en segundos y no en cuadros.** El error nace en segundos —la
 * cuantización a microsegundos no sabe a cuántos fps corre el video—, así que
 * un solo número en segundos sirve a cualquier velocidad; en cuadros habría
 * que dimensionarlo para los fps más altos y queda veinticinco veces más
 * generoso de lo necesario a 24. Era eso lo que estaba mal antes: `1e-6`
 * sumado DESPUÉS de multiplicar son cuadros, y a 30 fps equivalen a 33
 * nanosegundos, cincuenta veces menos que el error que hay que absorber.
 *
 * **El número: diez microsegundos.** Por abajo, lo peor medido en la app es
 * una pérdida de 1.67 µs —el recorte a microsegundos más uno que se va en el
 * camino—, así que diez dejan seis veces de margen. Por arriba, el cuadro más
 * corto que la app maneja de verdad es el de 60 fps y dura 16.667 ms: diez
 * microsegundos son el 0.06% de un cuadro, y aun contra el techo de
 * `fpsValido` —1000 fps, cuadros de 1 ms— son el 1%.
 *
 * Pasarse para arriba es peor que quedarse corto porque no se nota: una
 * tolerancia del tamaño de un cuadro empieza a contar el cuadro siguiente a un
 * tiempo que todavía es del anterior, y eso corre TODOS los comentarios en uno
 * sin que nada falle. `tests/tiempo.test.js` clava los dos bordes.
 */
const TOLERANCIA = 1e-5;

/** Segundos → qué cuadro se está viendo. */
function cuadroDe(segundos, fps) {
    const t = Math.max(0, Number(segundos) || 0);
    return Math.floor((t + TOLERANCIA) * fpsValido(fps));
}

/** Y de vuelta: el comienzo de un cuadro, en segundos. */
function segundosDe(cuadro, fps) {
    return Math.max(0, Number(cuadro) || 0) / fpsValido(fps);
}

const dos = n => String(n).padStart(2, '0');

/**
 * `HH:MM:SS:FF` — el timecode que se lee en Premiere.
 *
 * **Sin drop-frame.** A 29.97 el timecode de Premiere con drop-frame se escribe
 * con `;` y salta números, y a los diez minutos difiere del no-drop en 18
 * cuadros. No se implementa porque hace falta saber si la secuencia del editor
 * es drop o non-drop y eso no está en el archivo: inventarlo sería dar un número
 * que parece exacto y no lo es. Los segundos, que van al lado, no tienen esa
 * ambigüedad — y por eso van al lado.
 */
function timecode(segundos, fps) {
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

/** `1:23` — lo corto, para los botones y la barra de tiempo. */
function reloj(segundos) {
    const t = Math.max(0, Math.floor(Number(segundos) || 0));
    const h = Math.floor(t / 3600);
    const m = Math.floor(t / 60) % 60;
    const s = t % 60;
    return h ? `${h}:${dos(m)}:${dos(s)}` : `${m}:${dos(s)}`;
}

/** Los fps como se escriben: 29.97 y no 29.969999999999999. */
function fpsTexto(fps) {
    const f = fpsValido(fps);
    return Number.isInteger(f) ? String(f) : f.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

/**
 * Un instante, dicho entero.
 *
 * Es lo que va en el encabezado de cada comentario del `feedback.md` y lo que la
 * tarjeta muestra al desplegarse.
 */
function completo(segundos, fps) {
    const f = fpsValido(fps);
    return `${timecode(segundos, f)} · ${(Number(segundos) || 0).toFixed(3)} s · cuadro ${cuadroDe(segundos, f)} @ ${fpsTexto(f)}`;
}

/** Y un tramo, con lo que dura: lo que dura es la mitad de lo que se pide. */
function completoRango(desde, hasta, fps) {
    const f = fpsValido(fps);
    const dura = Math.max(0, (Number(hasta) || 0) - (Number(desde) || 0));
    return `${timecode(desde, f)} → ${timecode(hasta, f)} · ${(Number(desde) || 0).toFixed(3)} s → ${(Number(hasta) || 0).toFixed(3)} s · `
        + `cuadros ${cuadroDe(desde, f)}–${cuadroDe(hasta, f)} @ ${fpsTexto(f)} · dura ${dura.toFixed(3)} s`;
}

/**
 * El trozo de timecode que se mete en un nombre de archivo.
 *
 * `00h01m23s12f`: los dos puntos no se pueden usar —en el Finder se ven como
 * barras y en la terminal hay que escaparlos—, y un nombre con `00-01-23-12`
 * no se lee como un tiempo.
 */
function paraNombre(segundos, fps) {
    const [h, m, s, f] = timecode(segundos, fps).split(':');
    return `${h}h${m}m${s}s${f}f`;
}

module.exports = {
    FPS_PORDEFECTO,
    TOLERANCIA,
    fpsValido,
    cuadroDe,
    segundosDe,
    timecode,
    reloj,
    fpsTexto,
    completo,
    completoRango,
    paraNombre
};
