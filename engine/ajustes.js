'use strict';
/**
 * ajustes.js — Las preferencias del editor, guardadas fuera de la carpeta de
 * renders.
 *
 * Viven en `~/Library/Application Support/Reviewer/ajustes.json` y no al lado de
 * los videos: a qué modelo local hablarle es una decisión de la máquina, no del
 * curso que se está revisando. Lo que sí es del curso —el comentario general—
 * viaja con la carpeta, y eso está en `general.js`.
 *
 * La escritura es atómica: un cierre a mitad de guardado no puede dejar el JSON
 * por la mitad y la app arrancando sin saber a qué modelo le hablaba.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const claude = require('./claude');
const workspace = require('./workspace');

/**
 * Los transportes para mejorar la redacción. El orden es el del selector.
 *
 * Los dos primeros son locales y `claude` no: ahí el texto del comentario sale
 * de la máquina. Va último a propósito, para que lo local siga siendo lo
 * primero que se ofrece, y la pantalla de Ajustes avisa de la diferencia.
 */
const PROVEEDORES = ['ollama', 'openai', 'claude'];

/**
 * Cuántas carpetas de renders se recuerdan.
 *
 * Seis, y el tope se aplica al SANEAR: quien agregue una séptima no tiene que
 * acordarse de recortar, y un archivo escrito a mano con cuarenta tampoco puede
 * llenar la pantalla de arranque. Seis alcanza para los cursos que se están
 * revisando ahora, que es lo que esto es; caerse de la lista no pierde nada,
 * porque la carpeta sigue en el disco y el botón de siempre la vuelve a traer.
 */
const RECIENTES = 6;

/**
 * Hasta dónde se deja estirar cada columna de los costados.
 *
 * Los mínimos son el ancho abajo del cual la columna deja de servir para lo que
 * está: 170 px es lo que necesita un nombre de clase para que se lea algo más
 * que el número del principio, y 300 px es lo que mide el redactor con sus dos
 * botones al lado sin que se apilen. Los máximos no protegen a la columna sino
 * al video, que es la razón por la que se abre la app.
 *
 * **Están duplicados en `src/js/paneles.js` y tiene que ser así.** La ventana
 * no puede importar del motor —corre con `sandbox: true` y sin Node— y el
 * recorte tiene que pasar durante el arrastre, cuadro a cuadro, sin ir y volver
 * por el puente. Los dos recortes existen por razones distintas: el de la
 * ventana impide soltar el tirador en un ancho inservible, y este impide que un
 * `ajustes.json` escrito a mano —o venido de una pantalla mucho más grande—
 * abra la app con una columna de 2000 px tapando el render. Un test compara las
 * dos tablas, así que cambiar una sola falla en vez de desincronizarse callado.
 */
const ANCHOS = {
    clases: { minimo: 170, maximo: 420, porDefecto: 232 },
    comentarios: { minimo: 300, maximo: 620, porDefecto: 376 }
};

const DEFAULTS = {
    version: 1,
    carpetasRecientes: [],
    llm: {
        proveedor: 'ollama',
        // La configuración de cada transporte se conserva aunque no esté activo:
        // probar LM Studio y volver a Ollama no puede hacerte reescribir el
        // modelo que ya tenías elegido.
        ollama: { url: 'http://localhost:11434', modelo: null },
        openai: { url: 'http://localhost:1234/v1', modelo: null, apiKey: '' },
        // Sin url y sin clave, y eso es todo el punto: la sesión la tiene el CLI
        // de `claude`, que ya está autenticado en la máquina. Acá no se guarda
        // ninguna credencial, así que este archivo no gana un campo donde pueda
        // aparecer un token (ver `engine/claude.js`).
        claude: { modelo: claude.MODELO_POR_DEFECTO }
    },
    dictado: {
        // Por nombre y no por índice: el índice de avfoundation cambia cuando se
        // enchufa una webcam, y el micrófono elegido pasaría a ser otro sin que
        // nadie tocara nada.
        microfono: '',
        idioma: 'es',
        // Refinar lo dictado con el modelo local. Se puede apagar: con un modelo
        // chico flojo, el crudo de Whisper es mejor que un refinado que resume.
        refinar: true
    },
    actualizaciones: {
        // Preguntarle al repo si hay una versión nueva al abrir la app. Encendido
        // porque una actualización que hay que ir a buscar a mano es una que
        // nadie instala, y la consulta son dos kilobytes contra GitHub.
        //
        // Se puede apagar, y no es por capricho: hay máquinas sin salida a
        // internet y editores que revisan con el wifi cortado a propósito. Ahí
        // la consulta no molesta —falla en silencio— pero tampoco sirve, y
        // poder apagarla es más honesto que dejarla intentando para siempre.
        alArrancar: true
    },
    pantalla: {
        /**
         * A qué pantalla se mandó el render la última vez, por NOMBRE.
         *
         * Por nombre y no por el id del display, por lo mismo que el micrófono
         * se guarda por nombre: el id que da macOS sale del hardware y cambia
         * al reiniciar o al reconectar, así que un id guardado señala mañana a
         * otro monitor. El `label` —«Sidecar Display (AirPlay)», «Odyssey
         * G81SF»— sobrevive a desenchufar y volver a enchufar.
         *
         * Dos monitores del mismo modelo quedan indistinguibles y se elige el
         * primero. Es mejor que lo contrario: un id que apunta a cualquiera.
         *
         * Vacío quiere decir «nunca se eligió», no «apagada». Si está prendida
         * o no es de esta sesión y no se guarda: que la app abra sola una
         * ventana sin marco encima de otro monitor al arrancar es justo lo que
         * nadie pidió.
         */
        destino: ''
    },
    paneles: {
        /**
         * Si las dos columnas de los costados están a la vista.
         *
         * `true` es «se ve» y no «está colapsada», a propósito: la pregunta que
         * se hace al leer esto es siempre «¿qué se ve?», y con la clave al
         * revés cada lectura cuesta una negación —`colapsado: false` para decir
         * que está abierto— que es justo donde se cuela el error de dejar la
         * app arrancando con todo cerrado.
         *
         * Se guarda porque es una postura de trabajo y no una acción: el que
         * revisa con los dos paneles cerrados y el iPad al lado los quiere
         * cerrados también mañana, y volver a cerrarlos en cada arranque es
         * recordarle a la app algo que ya le dijo.
         */
        clases: true,
        comentarios: true,
        /**
         * Cuánto ancho se le dio a cada columna, en píxeles.
         *
         * Se guarda por lo mismo que el plegado: el que revisa con nombres de
         * clase largos ensancha la izquierda una vez y la quiere así mañana.
         */
        anchoClases: ANCHOS.clases.porDefecto,
        anchoComentarios: ANCHOS.comentarios.porDefecto
    }
};

function archivo() {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Reviewer', 'ajustes.json');
}

function texto(valor, porDefecto) {
    return typeof valor === 'string' && valor.trim() ? valor.trim() : porDefecto;
}

/**
 * Un ancho de columna recortado a lo que esa columna admite.
 *
 * Solo números, sin `Number(valor)`: `null` y `''` se convierten en 0, así que
 * una clave vacía terminaría recortada al mínimo —una columna angosta que nadie
 * pidió— en vez de volver al ancho de fábrica, que es lo que una clave sin
 * valor quiere decir.
 */
function ancho(cual, valor) {
    const limites = ANCHOS[cual];
    const n = typeof valor === 'number' ? Math.round(valor) : NaN;
    if (!Number.isFinite(n)) return limites.porDefecto;
    return Math.max(limites.minimo, Math.min(n, limites.maximo));
}

/** Un objeto con TODAS las claves, venga lo que venga del disco. */
function sanear(crudo) {
    const llm = (crudo && crudo.llm) || {};
    const dictado = (crudo && crudo.dictado) || {};
    const updates = (crudo && crudo.actualizaciones) || {};
    const pantalla = (crudo && crudo.pantalla) || {};
    const paneles = (crudo && crudo.paneles) || {};
    const recientes = (crudo && Array.isArray(crudo.carpetasRecientes) ? crudo.carpetasRecientes : [])
        .filter(d => typeof d === 'string' && d);

    return {
        version: DEFAULTS.version,
        // Sin repetidas y hasta el tope, decidido acá y no en quien guarda. Que
        // la carpeta siga existiendo NO se comprueba: un disco externo se
        // enchufa y se desenchufa, así que un "no está" escrito hoy es mentira
        // mañana. Eso se le pregunta al disco cuando la pantalla se abre.
        carpetasRecientes: [...new Set(recientes)].slice(0, RECIENTES),
        llm: {
            proveedor: PROVEEDORES.includes(llm.proveedor) ? llm.proveedor : DEFAULTS.llm.proveedor,
            ollama: {
                url: texto(llm.ollama && llm.ollama.url, DEFAULTS.llm.ollama.url),
                modelo: texto(llm.ollama && llm.ollama.modelo, null)
            },
            openai: {
                url: texto(llm.openai && llm.openai.url, DEFAULTS.llm.openai.url),
                modelo: texto(llm.openai && llm.openai.modelo, null),
                // Un endpoint local no pide clave y uno remoto sí. Se guarda
                // porque sin ella la función no existe para quien apunta a un
                // servicio con auth, y esto no es un secreto de otra persona:
                // es la Mac del editor, en el mismo archivo que sus preferencias.
                apiKey: typeof (llm.openai && llm.openai.apiKey) === 'string' ? llm.openai.apiKey : ''
            },
            claude: {
                // Un modelo que no está en la lista se descarta en vez de
                // viajar al CLI: lo que se guarda acá es un alias que `--model`
                // tiene que entender, y un archivo editado a mano con cualquier
                // cosa adentro fallaría recién al refinar, con un error del CLI
                // en vez de un desplegable con lo que sí hay.
                modelo: claude.MODELOS.some(m => m.id === (llm.claude && llm.claude.modelo))
                    ? llm.claude.modelo
                    : DEFAULTS.llm.claude.modelo
            }
        },
        dictado: {
            microfono: typeof dictado.microfono === 'string' ? dictado.microfono : '',
            idioma: texto(dictado.idioma, DEFAULTS.dictado.idioma),
            refinar: dictado.refinar !== false
        },
        actualizaciones: {
            // `!== false` y no `Boolean(...)`: un archivo viejo —escrito antes de
            // que este ajuste existiera— no tiene la clave, y con `Boolean` la
            // comprobación quedaría apagada para todos los que ya tenían la app
            // instalada, que son justo los que necesitan enterarse.
            alArrancar: updates.alArrancar !== false
        },
        pantalla: {
            // No se comprueba que esa pantalla exista, igual que no se comprueba
            // que las carpetas recientes sigan en el disco: un monitor se
            // desenchufa y se vuelve a enchufar, así que un «ya no está» escrito
            // hoy es mentira mañana. Eso se le pregunta a `screen` cuando el
            // desplegable se pinta.
            destino: typeof pantalla.destino === 'string' ? pantalla.destino : ''
        },
        paneles: {
            // `!== false` por lo mismo que `alArrancar`: un `ajustes.json`
            // escrito antes de que esta clave existiera no la tiene, y leer la
            // ausencia como «colapsado» abriría la app sin paneles en todas las
            // instalaciones que ya están en la calle — sin nada en pantalla que
            // explique por qué, porque es exactamente el estado al que se llega
            // apretando ⌘S y ⌘E.
            clases: paneles.clases !== false,
            comentarios: paneles.comentarios !== false,
            anchoClases: ancho('clases', paneles.anchoClases),
            anchoComentarios: ancho('comentarios', paneles.anchoComentarios)
        }
    };
}

function leer() {
    let crudo = null;
    try {
        crudo = JSON.parse(fs.readFileSync(archivo(), 'utf8'));
    } catch (e) {
        // Sin archivo o con un archivo roto se arranca con lo de fábrica: unos
        // ajustes ilegibles no pueden dejar sin poder comentar.
    }
    return sanear(crudo);
}

function guardar(datos) {
    const limpio = sanear(datos);
    workspace.writeJson(archivo(), limpio);
    return limpio;
}

/**
 * Mezcla un parche sobre el documento, un nivel adentro de cada sub-objeto.
 *
 * Dos niveles y no más, porque el documento tiene dos: arriba están los grupos
 * (`llm`, `dictado`, `paneles`…) y adentro las claves. Así
 * `{ paneles: { clases: false } }` deja `paneles.comentarios` como estaba, que
 * es lo que uno espera al escribir eso, y `{ llm: { claude: {...} } }` cambia
 * el transporte de Claude entero sin tocar el de Ollama.
 *
 * Lo que NO se mezcla, y es a propósito: los arrays se reemplazan. La única
 * que hay es `carpetasRecientes`, y para esa el orden es el dato —primera es
 * la última abierta—, así que fundirla elemento por elemento no querría decir
 * nada. Quien la toca usa `recordarCarpeta`/`olvidarCarpeta`, que saben eso.
 */
function fundir(base, parcial) {
    const salida = { ...base };
    for (const [clave, valor] of Object.entries(parcial || {})) {
        const esObjeto = v => v && typeof v === 'object' && !Array.isArray(v);
        salida[clave] = esObjeto(base[clave]) && esObjeto(valor)
            ? { ...base[clave], ...valor }
            : valor;
    }
    return salida;
}

/**
 * Cambia unas pocas claves sin tocar el resto, y devuelve el documento entero.
 *
 * Es lo único que la ventana puede hacer con este archivo, y por eso el merge
 * se hace contra `leer()` y no contra lo que el llamador crea que había. Antes
 * la ventana mandaba el documento completo y cinco módulos distintos lo
 * armaban cada uno sobre su copia cacheada: dos escrituras en vuelo —plegar un
 * panel y elegir una pantalla, que es un gesto de dos segundos— y una de las
 * dos se perdía sin dejar rastro.
 *
 * Que `guardar` pase por `sanear` sigue valiendo igual: un parche con basura
 * adentro no puede dejar el archivo con una clave que la app no sepa leer.
 */
function parchear(parcial) {
    return guardar(fundir(leer(), parcial));
}

/** Deja una carpeta primera en la lista de recientes. */
function recordarCarpeta(ruta) {
    if (!ruta) return leer();
    const actual = leer();
    const sinEsta = actual.carpetasRecientes.filter(d => d !== ruta);
    return guardar({ ...actual, carpetasRecientes: [ruta, ...sinEsta] });
}

function olvidarCarpeta(ruta) {
    const actual = leer();
    return guardar({
        ...actual,
        carpetasRecientes: actual.carpetasRecientes.filter(d => d !== ruta)
    });
}

/** La configuración del transporte activo, aplanada para `llm.js`. */
function llmActivo(ajustes) {
    const a = ajustes || leer();
    const proveedor = a.llm.proveedor;
    const config = a.llm[proveedor] || {};
    return { proveedor, url: config.url, modelo: config.modelo, apiKey: config.apiKey || '' };
}

module.exports = {
    PROVEEDORES,
    RECIENTES,
    ANCHOS,
    DEFAULTS,
    archivo,
    sanear,
    leer,
    guardar,
    fundir,
    parchear,
    recordarCarpeta,
    olvidarCarpeta,
    llmActivo
};
