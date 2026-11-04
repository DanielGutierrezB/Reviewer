'use strict';
/**
 * modelo.js — Dado un instante de la línea de tiempo, qué hay que dibujar.
 *
 * Todo el preview cuelga de acá: el compositor pregunta «¿qué shot, qué tiempo
 * de fuente, qué recorte, cuánta opacidad?» y dibuja lo que esto conteste. No
 * toca el DOM ni los videos a propósito, para que se pueda probar con números
 * sueltos en vez de con una ventana abierta.
 *
 * El modelo es por CUADRO y no por segundo. Un corte cae entre dos cuadros, no
 * en un instante continuo, y preguntar «¿qué shot hay en el segundo 61.8333?»
 * con aritmética de coma flotante da el shot de antes o el de después según el
 * error de redondeo de esa multiplicación. Con `f = floor(t*30)` y la búsqueda
 * por `f0 <= f < f0+nf`, el límite es exacto y es el mismo que usó Claude para
 * exportar.
 *
 * Las coordenadas que entran y salen de acá están SIEMPRE en píxeles de la
 * fuente de 1920x1080. Traducirlas al proxy de cámara, que mide 1280x720, es
 * trabajo del compositor y pasa lo más tarde posible: con dos sistemas de
 * coordenadas dando vueltas, el error es mezclarlos a mitad de camino.
 */

import { cuadroDe } from '../formato.js';

/**
 * Qué lleva cada layout. La única tabla.
 *
 * De acá sale todo lo que depende del layout: qué videos hay que tener listos
 * (`fuentesDe`), cómo entra la cámara (`camaraDe`) y qué pistas de la línea de
 * tiempo se encienden. Cuando eso estaba escrito tres veces —un `if` por
 * layout acá, tres conjuntos en `linea.js`, un `switch` en el compositor— las
 * copias ya no coincidían: una contaba a `SPLIT` como cámara en caja y la otra
 * no.
 *
 * `camara` es cómo entra la cámara por el layout mismo. El PiP no está acá
 * porque no es del layout sino del shot: un `SCREEN` puede llevarlo o no.
 */
export const LAYOUTS = {
    CAM_WIDE: { camara: 'entera' },
    CAM_MED: { camara: 'entera' },
    SCENE: { camara: 'caja', fondo: true },
    SCENE_L: { camara: 'caja', fondo: true },
    SCENE_FULL: { fondo: true },
    SCREEN: { pantalla: true },
    SPLIT: { camara: 'lateral', pantalla: true, fondo: true }
};

const SIN_LAYOUT = {};

/**
 * Cuánto tardan un zoom en llegar y un subrayado en aparecer, en segundos.
 *
 * Solo para cuando el JSON no los trae: los de verdad son `geometry.focus_ramp`
 * y `geometry.highlight_fade`, y los pasa `planDe`.
 */
const RAMPA = 0.6;
const FUNDIDO = 0.25;

/** Lo que la tabla dice de un layout, o nada si esta versión no lo conoce. */
export function layoutDe(shot) {
    return LAYOUTS[shot.layout] || SIN_LAYOUT;
}

/** Cómo entra la cámara en un shot: `entera`, `caja`, `lateral`, `pip` o `null`. */
export function camaraDe(shot) {
    return layoutDe(shot).camara || (shot.pip ? 'pip' : null);
}


/** `t` → el cuadro de la línea de tiempo. */
export function cuadroEn(edicion, t) {
    return cuadroDe(t, edicion.fps);
}

/**
 * El shot que contiene a un cuadro.
 *
 * Búsqueda binaria y no un `find`: esto corre una vez por cuadro dibujado —y
 * otra vez por cada decisión de pre-seek— sobre 157 shots. Lineal son 78
 * comparaciones promedio a 30 por segundo para contestar algo que casi siempre
 * es «el mismo que el cuadro anterior».
 *
 * Fuera de rango devuelve el primero o el último en vez de `null`: un cuadro
 * más allá del final es lo que pasa al llegar al final, y ahí lo correcto es
 * seguir mostrando la última imagen, no un negro.
 */
export function shotDeCuadro(edicion, f) {
    const shots = edicion.shots;
    if (f < 0) return shots[0];

    let bajo = 0;
    let alto = shots.length - 1;
    while (bajo <= alto) {
        const medio = (bajo + alto) >> 1;
        const shot = shots[medio];
        if (f < shot.f0) alto = medio - 1;
        else if (f >= shot.f0 + shot.nf) bajo = medio + 1;
        else return shot;
    }
    return shots[shots.length - 1];
}

/**
 * El tiempo de fuente de un cuadro: dónde mirar en la cámara y en la pantalla.
 *
 * `T = shot.src + (f - shot.f0)/fps`. Las dos fuentes están sincronizadas entre
 * sí, así que es un solo número para las dos.
 */
export function fuenteDe(edicion, shot, f) {
    const dentro = Math.max(0, f - shot.f0);
    return shot.src + dentro / edicion.fps;
}

/** El instante de la línea de tiempo donde empieza un shot. */
export function salidaDe(edicion, shot) {
    return shot.f0 / edicion.fps;
}

/**
 * El tiempo del proxy para un tiempo de fuente.
 *
 * Los proxies no empiezan donde empieza la grabación: cubren solo el tramo que
 * la clase usa, y `media.offset` dice cuánto se recortó del principio. Sin esta
 * resta, la cámara se busca en el segundo 3367 de un archivo que dura 1839.
 */
export function enProxy(medio, T) {
    return T - (medio.offset || 0);
}

/**
 * Todo lo que corre en tiempo de línea de tiempo se cuenta en CUADROS.
 *
 * El fondo, las escenas y los overlays no se cortan: avanzan con la línea de
 * tiempo de principio a fin. Sería natural posicionarlos con el instante `t`
 * tal como viene, y es lo que estaba mal: `t` es un número continuo que cae en
 * cualquier parte de un cuadro, así que pedir el cuadro de `t` y después
 * pedirle al video el instante `t` son dos cuadros distintos cada vez que `t`
 * no cae justo en el borde. Medido contra el render, eso adelantaba la escena
 * un cuadro y hundía el parecido de 0.95 a 0.87 — con la imagen correcta, solo
 * que la de un treintavo de segundo después.
 *
 * Con la cuenta en enteros no hay dónde perderse: el cuadro `f` de la línea de
 * tiempo es el cuadro `f - inicio` de la escena, y punto.
 */
function cuadroDeSalida(edicion, segundos) {
    return Math.round(segundos * edicion.fps);
}

/**
 * El fondo animado, que corre en tiempo de línea de tiempo y nunca se reinicia.
 *
 * Es un loop de 15.3 s: el corte no lo toca. Si se reiniciara en cada shot, el
 * fondo pegaría un salto en cada corte y sería lo único de la pantalla que
 * delata que esto está montado.
 */
export function tiempoDelFondo(edicion, f) {
    const dura = (edicion.medios.bg_loop && edicion.medios.bg_loop.loop_dur) || 0;
    if (!dura) return 0;
    const cuadros = cuadroDeSalida(edicion, dura);
    if (!cuadros) return 0;
    return (((f % cuadros) + cuadros) % cuadros) / edicion.fps;
}

/** La escena de un shot y en qué segundo de ella estamos. */
export function escenaDe(edicion, shot, f) {
    if (!shot.scene) return null;
    const escena = edicion.escenas[shot.scene];
    if (!escena) return null;
    const dentro = Math.max(0, f - cuadroDeSalida(edicion, escena.out));
    return { nombre: shot.scene, escena, t: dentro / edicion.fps };
}

/**
 * La escena cuya ventana contiene al cuadro, la dibuje este shot o no.
 *
 * Una escena corre en tiempo de línea de tiempo entre su `out` y su
 * `out + dur`, y el montaje puede cortar a cámara en el medio y volver a ella:
 * `decide` se ve en los shots 55 a 57 y otra vez del 62 al 64. Mientras dure
 * su ventana tiene que seguir corriendo, igual que el fondo; pausarla en el
 * hueco obliga a buscar varios segundos hacia adelante justo en el corte en
 * que vuelve, y eso es un cuadro que llega tarde.
 */
export function escenaEnCurso(edicion, f) {
    for (const [nombre, escena] of Object.entries(edicion.escenas || {})) {
        const desde = cuadroDeSalida(edicion, escena.out);
        const hasta = desde + cuadroDeSalida(edicion, escena.dur);
        if (f >= desde && f < hasta) return { nombre, escena, t: (f - desde) / edicion.fps };
    }
    return null;
}

/**
 * Los overlays activos en un cuadro.
 *
 * Con su índice en `edicion.overlays`, que es el mismo que tienen sus videos
 * en `fuentes.overlays`: el que dibuja va directo al suyo, en vez de buscarlo
 * por identidad del objeto en cada cuadro.
 */
export function overlaysEn(edicion, f) {
    const activos = [];
    (edicion.overlays || []).forEach((ov, i) => {
        const desde = cuadroDeSalida(edicion, ov.out);
        const hasta = desde + cuadroDeSalida(edicion, ov.dur);
        if (f >= desde && f < hasta) activos.push({ i, overlay: ov, t: (f - desde) / edicion.fps });
    });
    return activos;
}

const pinza = (v, min, max) => Math.max(min, Math.min(max, v));

/**
 * El recorte de pantalla que hay que ampliar, con los zooms ya aplicados.
 *
 * La vista arranca en `screen.base` y cada foco la empuja hacia su `rect` con
 * un peso que entra y sale en 0.6 s:
 *
 *   k = clamp((T-a)/0.6) * clamp((b-T)/0.6)
 *   e = k*k*(3-2k)                 ← suavizado: sale y llega sin tirón
 *   vista += e * (rect - base)
 *
 * El `e` es el smoothstep de siempre. Importa que la interpolación sea contra
 * la BASE y no contra la vista acumulada: dos focos que se pisan tienen que
 * sumar sus desplazamientos sobre el mismo origen, porque así los exportó
 * Claude. Encadenarlos daría un zoom que se va de escala cuando se solapan.
 *
 * Al final se redondea y se encaja: el alto sale del ancho en 16:9 y el
 * rectángulo se mete entero adentro del cuadro. Sin el encaje, un foco cerca
 * del borde pide píxeles que no existen y `drawImage` dibuja negro.
 */
export function vistaDe(shot, T, rampa = RAMPA) {
    const base = (shot.screen && shot.screen.base) || [0, 0, 1920];
    let [x, y, w] = base;

    for (const foco of (shot.screen && shot.screen.focus) || []) {
        const k = pinza((T - foco.a) / rampa, 0, 1) * pinza((foco.b - T) / rampa, 0, 1);
        if (!k) continue;
        const e = k * k * (3 - 2 * k);
        x += e * (foco.rect[0] - base[0]);
        y += e * (foco.rect[1] - base[1]);
        w += e * (foco.rect[2] - base[2]);
    }

    w = pinza(Math.round(w), 320, 1920);
    const h = Math.round((w * 9) / 16);
    return {
        x: pinza(Math.round(x), 0, 1920 - w),
        y: pinza(Math.round(y), 0, 1080 - h),
        w,
        h
    };
}

/**
 * Cuánto se ve un subrayado.
 *
 *   entrada = min(1, (T - t0)/0.25)   pero 1 si el subrayado ya venía de antes
 *   salida  = clamp((t1 - T)/0.25)
 *
 * Lo de «si ya venía de antes» es la parte que importa: cuando `t0` es anterior
 * al comienzo del shot, el subrayado ya estaba puesto cuando el corte entró, y
 * hacerlo aparecer de nuevo sería un parpadeo que en el render no está.
 */
export function opacidadDe(hl, T, shot, fundido = FUNDIDO) {
    if (T < hl.t0 || T >= hl.t1) return 0;
    const entrada = hl.t0 > shot.src ? Math.min(1, (T - hl.t0) / fundido) : 1;
    const salida = pinza((hl.t1 - T) / fundido, 0, 1);
    return Math.max(0, entrada * salida);
}

/** Los subrayados que se ven ahora, con su opacidad ya resuelta. */
export function subrayadosEn(shot, T, fundido = FUNDIDO) {
    const puestos = [];
    for (const hl of (shot.screen && shot.screen.highlights) || []) {
        const alfa = opacidadDe(hl, T, shot, fundido);
        if (alfa > 0) puestos.push({ hl, alfa });
    }
    return puestos;
}

/**
 * Los desenfoques activos.
 *
 * Tapan correos y claves de API, así que esto no puede equivocarse ni por un
 * cuadro: el intervalo es cerrado abajo y abierto arriba, igual que el del
 * shot, para que un cuadro no quede sin tapar justo en el borde.
 */
export function blursEn(shot, T) {
    return ((shot.screen && shot.screen.blur) || []).filter(b => T >= b.t0 && T < b.t1);
}

// ─── Moverse entre cortes ─────────────────────────────────────

/**
 * El corte siguiente o el anterior, para las flechas arriba y abajo.
 *
 * «Anterior» se mide contra el comienzo del shot actual y no contra el cabezal:
 * estando a mitad de un shot, la flecha arriba lleva al principio de ESE shot,
 * que es lo que uno quiere el 90% de las veces —volver al corte que acabás de
 * pasar—. Un segundo toque sigue hacia atrás. Es cómo se comporta cualquier
 * mesa de edición y ahorra tener dos teclas para lo mismo.
 */
export function saltoDeCorte(edicion, t, sentido) {
    const f = cuadroEn(edicion, t);
    const shot = shotDeCuadro(edicion, f);
    const i = shot.i != null ? shot.i : edicion.shots.indexOf(shot);

    if (sentido > 0) {
        const siguiente = edicion.shots[i + 1];
        return siguiente ? siguiente.f0 / edicion.fps : null;
    }

    // Un cuadro de gracia: parado EXACTAMENTE en el corte, «atrás» es el corte
    // de antes y no el mismo donde ya estás, que no movería nada.
    if (f > shot.f0) return shot.f0 / edicion.fps;
    const previo = edicion.shots[i - 1];
    return previo ? previo.f0 / edicion.fps : null;
}

// ─── Qué fuentes hace falta tener listas ──────────────────────

/**
 * Qué videos necesita un shot.
 *
 * Sirve para dos cosas: pausar los que no se usan —decodificar tres videos
 * 1080p para dibujar uno es el camino corto a perder cuadros— y saber cuál hay
 * que tener pre-posicionado antes del próximo corte.
 */
export function fuentesDe(shot) {
    const layout = layoutDe(shot);
    const usa = new Set();
    if (layout.pantalla) usa.add('screen');
    if (layout.fondo) usa.add('bg_loop');
    if (camaraDe(shot)) usa.add('cam');
    if (shot.scene) usa.add('scene');
    return usa;
}

// ─── El cuadro entero ─────────────────────────────────────────

/**
 * Todo lo que hace falta para el cuadro de `t`, calculado una sola vez.
 *
 * Es la única puerta entre el instante continuo del reloj y el mundo por
 * cuadros del preview. Antes cada quien hacía la cuenta por su lado —el que
 * acomoda las fuentes, el que pregunta si falta alguna, el que espera a que
 * lleguen, el que dibuja— y eso eran cuatro lugares donde pasarle `t` a una
 * función que espera un cuadro. Pasó, adelantaba la imagen un cuadro, y no se
 * notaba hasta medir contra el render. Con el plan, la conversión ocurre acá y
 * en ningún otro lado: el resto lee números ya hechos.
 *
 * `proxy` dice dónde tiene que estar cada par A/B. `escena` es la que este
 * shot dibuja; `escenaQueCorre`, la que tiene que estar andando aunque este
 * shot no la dibuje. `pantalla` solo existe si el layout la dibuja, con el
 * zoom, los desenfoques y los subrayados ya resueltos para este instante.
 */
export function planDe(edicion, t) {
    const f = cuadroEn(edicion, t);
    const shot = shotDeCuadro(edicion, f);
    const T = fuenteDe(edicion, shot, f);
    const g = edicion.geometria || {};
    const medios = edicion.medios;
    const escena = escenaDe(edicion, shot, f);

    return {
        t,
        f,
        shot,
        T,
        usa: fuentesDe(shot),
        camara: camaraDe(shot),
        proxy: {
            cam: medios.cam ? enProxy(medios.cam, T) : null,
            screen: medios.screen ? enProxy(medios.screen, T) : null
        },
        fondo: tiempoDelFondo(edicion, f),
        escena,
        escenaQueCorre: escena || escenaEnCurso(edicion, f),
        overlays: overlaysEn(edicion, f),
        pantalla: layoutDe(shot).pantalla
            ? {
                vista: vistaDe(shot, T, g.focus_ramp),
                blurs: blursEn(shot, T),
                subrayados: subrayadosEn(shot, T, g.highlight_fade)
            }
            : null
    };
}

/**
 * El próximo shot que vuelve a usar una fuente, para ir posicionándola.
 *
 * Devuelve el shot y en qué tiempo de fuente entra. Se mira unos pocos shots
 * hacia adelante y no la lista entera: si la cámara no vuelve en diez shots,
 * falta más de medio minuto y posicionarla ahora no sirve de nada.
 */
export function proximoUso(edicion, desde, fuente, alcance = 10) {
    const shots = edicion.shots;
    const hasta = Math.min(shots.length, desde + 1 + alcance);
    for (let i = desde + 1; i < hasta; i++) {
        if (fuentesDe(shots[i]).has(fuente)) return shots[i];
    }
    return null;
}
