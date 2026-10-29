'use strict';
/**
 * adjuntos.js — Los archivos que el editor le cuelga a UN comentario.
 *
 * Hay dos niveles de archivos en Reviewer y conviene no confundirlos, porque
 * resuelven dos problemas distintos:
 *
 *   - `referencias.js` → del CURSO entero. El logo, el manual de marca, la
 *     paleta: cosas que valen para las treinta clases, viven en
 *     `Reviewer/_referencias/` y se nombran adentro del texto con una mención
 *     `@[curso/logo.svg]` porque el editor las va a citar muchas veces.
 *   - esto → de UN comentario. «Este plano, cambialo por este otro archivo».
 *     Vive en la carpeta de la versión, al lado del cuadro y del dibujo de ese
 *     mismo comentario, y no se nombra con una mención: ya está pegado al
 *     comentario, que es lo único de lo que habla.
 *
 * **Por qué no se reusó `referencias.js` entero.** Se evaluó. Lo que las separa
 * no es el código sino el ciclo de vida: una referencia del curso sobrevive a
 * que se borre un comentario y se numera para poder citarla («imagen 2»); un
 * adjunto de comentario tiene que morir y resucitar CON su comentario —papelera
 * incluida— y no se cita nunca. Meterlos en la misma carpeta y el mismo
 * manifiesto obligaría a que borrar un comentario fuera a buscar qué archivos
 * del curso eran suyos, que es exactamente el tipo de pregunta que el diseño de
 * `workspace.js` evita teniendo cada cosa al lado de aquello a lo que pertenece.
 *
 * **Lo que sí se reusa** son las tres funciones de `referencias.js` que no
 * hablan de referencias sino de archivos: la tabla de tipos MIME, «¿esto es una
 * imagen o un documento?» y cómo se busca un nombre libre. Una segunda copia de
 * esas tres se iría separando sola, y el editor terminaría viendo un PDF
 * llamado «documento» en una lista y «archivo» en la otra.
 *
 * **La regla del disco sigue siendo la misma:** acá no se escribe nada hasta que
 * hay un comentario de verdad. Por eso `escribir` recibe el id de un comentario
 * que ya existe y nunca se la llama desde el redactor: lo que se está
 * redactando vive en la memoria de la ventana hasta que se aprieta Comentar.
 */

const fs = require('fs');
const path = require('path');

const referencias = require('./referencias');
const workspace = require('./workspace');

/**
 * 64 MB. Es el techo de lo que entra por el puente como bytes —una imagen
 * pegada del portapapeles pesa kilobytes—, no el de un archivo que se copia
 * desde el disco: ese se copia con `fs` y puede ser un ProRes de 4 GB.
 *
 * **La ventana tiene el mismo número y corta antes. Las dos comprobaciones
 * hacen cosas distintas y ninguna sobra.** La de allá (`src/js/adjuntos.js`,
 * `deBlob`) evita el trabajo: sin ella se lee el archivo entero a memoria y se
 * arma un base64 de 1,33× para la miniatura antes de que nadie pregunte cuánto
 * pesa, así que una imagen grande arrastrada desde Safari congela la ventana
 * varios segundos para terminar en un error. La de acá defiende la invariante:
 * este módulo escribe en la carpeta del editor y no puede confiar en que quien
 * lo llamó haya mirado nada —el puente escribe lo que la ventana mande, y
 * mañana lo puede llamar otra ventana o un test—. Borrar cualquiera de las dos
 * deja la mitad del trabajo hecho: sin la de allá vuelve el congelamiento, sin
 * esta el tope pasa a ser una gentileza de la interfaz.
 *
 * Lo que sí es uno solo es el NÚMERO, y no hay cómo compartirlo —la ventana no
 * tiene `require`—, así que está escrito de los dos lados y hay un test que
 * compara los dos archivos (`tests/adjuntos.test.js`). Si cambia uno, cambian
 * los dos.
 */
const TOPE_BYTES = 64 * 1024 * 1024;

/**
 * El tamaño como lo dice un mensaje de error.
 *
 * Con el número y no con «pesa demasiado»: el editor que acaba de arrastrar un
 * archivo necesita saber cuánto se pasó para decidir si lo exporta más chico o
 * si lo copia desde el Finder, que es el camino sin tope.
 *
 * **Redondea para arriba**, y no es un detalle: un archivo de 64 MB y un byte
 * redondeado al MB más cercano da «pesa 64 MB y no pueden pasar más de 64 MB»,
 * que es un mensaje que se contradice solo. Para arriba, el número que se
 * muestra siempre está del lado correcto del tope. El `.0` se va por lo mismo
 * que en el paso de velocidad del reproductor: «64.0 MB» es un número de
 * máquina.
 */
function enMB(bytes) {
    const mb = Math.ceil((Number(bytes || 0) / 1024 / 1024) * 10) / 10;
    return `${mb.toFixed(1).replace(/\.0$/, '')} MB`;
}

/**
 * Para qué sirve un adjunto. **Es el punto del asunto.**
 *
 * Confundir los dos usos es la diferencia entre inspirarse en un logo y pegarlo
 * en el video, así que la distinción no puede quedar librada al tono con el que
 * el editor escribió el comentario: se elige a mano, por archivo, y se escribe
 * en el `feedback.md` con todas las letras.
 *
 * **El rótulo que ve el editor y la frase que lee Claude salen de este mismo
 * objeto**, y viaja entero a la ventana por el puente (`adjuntos-usos`). Si el
 * selector dijera «de referencia» y el markdown terminara diciendo otra cosa,
 * el editor estaría eligiendo a ciegas y no habría cómo darse cuenta: el único
 * lugar donde se vería la diferencia es en el render equivocado de mañana.
 *
 * **Los rótulos no tienen género.** Un adjunto puede ser una imagen o un
 * archivo, y «mirala / usala» obliga a elegir uno; «para mirar / para usar»
 * sirve para los dos y además pone los dos verbos en paralelo, que es lo que
 * hace que la diferencia se entienda sin leer la ayuda.
 */
const USOS = {
    referencia: {
        id: 'referencia',
        rotulo: 'De referencia — para mirar',
        ayuda: 'Que lo mire y haga algo en esa línea. No entra al video.',
        titulo: 'SOLO DE REFERENCIA, para mirar',
        frase: 'Miralo para entender a qué apunta el comentario y hacé algo en esa línea. '
            + 'Este archivo NO va adentro de la pieza: no lo insertes, no lo pegues, no lo uses como material.',
        // La misma orden, pero dicha de corrido para que entre en el medio de
        // una oración: es lo que reemplaza a la mención cuando el editor
        // escribió «cambiá la paleta por la de @2».
        enFrase: 'un archivo adjunto a este comentario, SOLO DE REFERENCIA: miralo para entender a qué '
            + 'apunta, no va adentro de la pieza',
        corto: 'de referencia'
    },
    insumo: {
        id: 'insumo',
        rotulo: 'Tal cual — para usar',
        ayuda: 'Que use exactamente este archivo adentro del video.',
        titulo: 'PARA USAR TAL CUAL, es el material',
        frase: 'Usá exactamente este archivo adentro de la pieza. '
            + 'No lo rehagas, no lo imites y no busques uno parecido: va este.',
        enFrase: 'el archivo adjunto a este comentario que va TAL CUAL: usalo exactamente, no lo '
            + 'rehagas ni busques uno parecido',
        corto: 'va tal cual'
    }
};

/**
 * El que se elige solo.
 *
 * Es «de referencia» porque los dos errores no cuestan lo mismo. Tratar un
 * insumo como referencia da un render donde Claude rehizo algo parecido al
 * logo: se ve, se dice y se arregla en una vuelta. Tratar una referencia como
 * insumo da un render con el logo de otro adentro, y eso no se ve mirándolo: se
 * ve cuando ya salió. Ante la duda, el default tiene que ser el error barato.
 */
const USO_PORDEFECTO = 'referencia';

/**
 * Los dos nombres que el cuadro y el dibujo se quedan dentro del ámbito
 * `adjunto`, para poder escribir `@[adjunto/cuadro]`.
 *
 * No son archivos del array `adjuntos`: son `c.frame` y `c.dibujo`. Pero son
 * las dos miniaturas que ya se ven en la tarjeta —y la captura que el editor
 * quiere señalar es justamente el cuadro—, así que tienen que poder nombrarse
 * o la función queda a medias.
 *
 * No pueden chocar con un adjunto de verdad y no es por suerte: un adjunto
 * siempre pasa por `nombreUnico`, que los tiene tomados de entrada.
 */
const NOMBRES_RESERVADOS = ['cuadro', 'dibujo'];

function uso(id) {
    return USOS[id] || USOS[USO_PORDEFECTO];
}

/**
 * El nombre que va a tener en el disco.
 *
 * Lleva el id del comentario adelante por dos motivos. El primero es que así
 * dos comentarios pueden adjuntar un `captura.png` cada uno sin que el segundo
 * dependa del sufijo numérico para no pisar al primero. El segundo es que la
 * carpeta se abre en el Finder: con `c03-paleta.png` se sabe de qué comentario
 * es sin abrir el JSON, igual que pasa con los cuadros.
 *
 * El nombre se pasa por el mismo `slug` que usan los PNG, así que los acentos y
 * los espacios de «Paleta Otoño 2024.png» se van antes de tocar el disco: ese
 * nombre viaja escrito adentro de un markdown y por carpetas compartidas, y las
 * tildes en un nombre de archivo son el tipo de cosa que funciona hasta que la
 * carpeta cruza a otro sistema. El nombre de verdad no se pierde: se guarda en
 * el JSON y es el que se muestra y el que lee Claude.
 */
function nombreEnDisco(dir, id, nombreOriginal) {
    const base = path.basename(String(nombreOriginal || 'adjunto'));
    const ext = path.extname(base).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 12);
    const cuerpo = workspace.slug(ext ? base.slice(0, base.length - ext.length) : base);
    return referencias.nombreLibre(dir, `${id}-${cuerpo}${ext}`);
}

/**
 * Un `nombre` que no choque con los que ya tiene el comentario.
 *
 * Es distinto de `nombreLibre`, que desempata el nombre EN DISCO. Este
 * desempata el nombre con el que el editor lo ve y con el que la mención del
 * texto lo empareja (`@[adjunto/paleta.png]`). Hacen falta los dos: sin el
 * primero el segundo archivo pisaría al primero; sin este, dos adjuntos del
 * mismo comentario se llamarían igual y el token sería ambiguo —`resolver`
 * elegiría el primero y el feedback apuntaría al archivo equivocado sin que
 * nada falle, que es justo el modo de falla que las menciones vinieron a matar.
 *
 * Se desempata al escribir y no al resolver, a propósito: un desempate en la
 * resolución es una regla que hay que conocer para predecir a qué apunta un
 * token, y acá la ambigüedad queda imposible por construcción. Con paréntesis
 * porque es lo que hace el Finder al duplicar: el editor ya sabe leerlo.
 */
function nombreUnico(tomados, deseado) {
    const usados = new Set(tomados || []);
    const base = String(deseado || 'adjunto');
    if (!usados.has(base)) return base;
    const ext = path.extname(base);
    const cuerpo = base.slice(0, base.length - ext.length);
    for (let i = 2; i < 500; i++) {
        const prueba = `${cuerpo} (${i})${ext}`;
        if (!usados.has(prueba)) return prueba;
    }
    return `${cuerpo} (${Date.now()})${ext}`;
}

/** Un adjunto que vino de afuera —del JSON o del puente—, con sus campos y ninguno de más. */
function sanear(crudo) {
    const a = crudo || {};
    const archivo = typeof a.archivo === 'string' ? a.archivo.trim() : '';
    if (!archivo) return null;
    const nombre = typeof a.nombre === 'string' && a.nombre ? a.nombre : path.basename(archivo);
    return {
        archivo,
        nombre,
        uso: USOS[a.uso] ? a.uso : USO_PORDEFECTO,
        mediaType: typeof a.mediaType === 'string' && a.mediaType ? a.mediaType : referencias.tipoDe(nombre),
        tipo: referencias.claseDe(nombre),
        agregado: a.agregado || new Date().toISOString()
    };
}

/** Los de un comentario, saneados. Siempre un array: un comentario sin adjuntos tiene cero, no `null`. */
function deComentario(comentario) {
    const lista = comentario && Array.isArray(comentario.adjuntos) ? comentario.adjuntos : [];
    return lista.map(sanear).filter(Boolean);
}

/**
 * Copia los archivos a `adjuntos/` y devuelve lo que hay que guardar en el JSON.
 *
 * Cada entrada trae `origen` (una ruta del disco, que se COPIA) o `bytes` (lo
 * que vino pegado del portapapeles, que no tiene ruta). Se copia y no se
 * referencia por el mismo motivo que en las referencias del curso: la carpeta
 * de la versión tiene que poder mandarse por Drive y abrirse en otra Mac, y un
 * puntero al Escritorio del editor es un adjunto que funciona hasta que alguien
 * más lo abre.
 *
 * Lo que no se pudo copiar vuelve en `fallados` en vez de tirar: si alguien
 * arrastró cinco archivos y uno estaba en un disco que se desmontó, los otros
 * cuatro ya son trabajo hecho y perderlos para avisar de uno es peor negocio.
 *
 * @param {string} rutaVideo
 * @param {string} id el comentario, que YA tiene que existir
 * @param {Array<{nombre?:string, uso?:string, origen?:string, bytes?:Buffer}>} entradas
 */
function escribir(rutaVideo, id, entradas, tomados) {
    const archivos = workspace.asegurarCarpeta(rutaVideo);
    workspace.ensureDir(archivos.adjuntos);

    const puestos = [];
    const fallados = [];
    // Los nombres que el comentario ya tiene, más los que se van poniendo en
    // esta misma tanda: soltar dos veces el mismo archivo de un solo arrastre
    // tiene que desempatar igual que soltarlo dos veces seguidas.
    const usados = [...(tomados || []), ...NOMBRES_RESERVADOS];

    for (const entrada of (entradas || [])) {
        const nombre = nombreUnico(usados, entrada.nombre || (entrada.origen ? path.basename(entrada.origen) : 'adjunto'));
        usados.push(nombre);
        try {
            const file = nombreEnDisco(archivos.adjuntos, id, nombre);
            const destino = path.join(archivos.adjuntos, file);
            // La misma reja que en `frames.js`: el nombre llega desde la ventana
            // y de él sale una ruta donde se escribe.
            if (!workspace.dentroDe(archivos.adjuntos, destino)) throw new Error('cae fuera de la carpeta');

            if (entrada.bytes) {
                const buffer = Buffer.isBuffer(entrada.bytes) ? entrada.bytes : Buffer.from(entrada.bytes);
                if (!buffer.length) throw new Error('llegó vacío');
                if (buffer.length > TOPE_BYTES) {
                    throw new Error(`pesa ${enMB(buffer.length)} y por el puente no pueden pasar más de ${enMB(TOPE_BYTES)}`);
                }
                workspace.writeAtomic(destino, buffer);
            } else if (entrada.origen) {
                fs.copyFileSync(entrada.origen, destino);
            } else {
                throw new Error('no vino ni el archivo ni su contenido');
            }

            puestos.push(sanear({
                archivo: path.join(workspace.ADJUNTOS_DIR, file),
                nombre,
                uso: entrada.uso
            }));
        } catch (e) {
            fallados.push({ nombre, motivo: e.message });
        }
    }

    return { puestos, fallados };
}

// ─── La tira numerada ─────────────────────────────────────────────────

/**
 * La tira de un comentario: el cuadro, el dibujo y los adjuntos, numerados.
 *
 * **Es el único lugar donde se cuenta.** El badge de la miniatura, la etiqueta
 * del chip en el texto, las filas del menú del `@` y lo que resuelve el
 * `feedback.md` salen todos de acá. Dos cuentas que se pueden separar es cómo
 * se llega a que la tarjeta diga «2» y Claude lea otra cosa, y ese es el modo
 * de falla que no se ve hasta el render de mañana.
 *
 * **El número no se guarda en ninguna parte.** Se calcula al pintar, desde la
 * lista viva. Lo que se guarda en el texto es `@[adjunto/paleta.png]`, el
 * nombre; el número es presentación. Por eso quitar un adjunto del medio corre
 * los badges de los que siguen y no toca un byte del texto de nadie.
 *
 * **El orden es el de `feedback.archivosDe`**: cuadro, dibujo y después los
 * adjuntos como se fueron colgando. El cuadro y el dibujo van primero porque
 * son los que ya estaban en la tarjeta y porque el dibujo no se entiende sin el
 * cuadro limpio al lado.
 *
 * **Lo que falta en el disco no ocupa número.** Es la misma regla que
 * `referencias.listar`: si el feedback dice «van 3 archivos, del 1 al 3», tiene
 * que ser cierto, y un hueco en la cuenta es peor que una lista más corta.
 *
 * @param {object} comentario ya saneado
 * @param {string} [carpeta] la de la versión; sin ella no se mira el disco
 */
function tira(comentario, carpeta) {
    const crudos = [];
    if (comentario.frame) crudos.push({ clave: 'cuadro', nombre: 'cuadro', tipo: 'imagen', uso: null, archivo: comentario.frame });
    if (comentario.dibujo) crudos.push({ clave: 'dibujo', nombre: 'dibujo', tipo: 'imagen', uso: null, archivo: comentario.dibujo });
    for (const a of (comentario.adjuntos || [])) {
        crudos.push({ clave: a.nombre, nombre: a.nombre, tipo: a.tipo, uso: a.uso, archivo: a.archivo });
    }

    let numero = 0;
    return crudos.map(item => {
        const ruta = carpeta ? path.join(carpeta, item.archivo) : null;
        const falta = Boolean(ruta) && !fs.existsSync(ruta);
        if (!falta) numero++;
        return {
            ...item,
            ruta,
            falta,
            numero: falta ? null : numero,
            // El token tal como se escribe en el texto. Se calcula acá y no en
            // la ventana por lo mismo que en `referencias.listar`: el chip que
            // se inserta y el token que el feedback resuelve tienen que salir
            // del mismo lugar.
            token: `@[adjunto/${item.clave}]`,
            // La etiqueta corta que ve el editor. «@1», no el nombre: es lo que
            // hace que el campo siga siendo legible con tres referencias
            // adentro de una frase.
            etiqueta: falta ? `@${item.nombre}` : `@${numero}`
        };
    });
}

/**
 * Lo que un comentario le presta a `menciones.resolver`.
 *
 * Es la tira traducida al formato que `resolver` ya entiende, más un
 * `comoSeLee` con la frase exacta. La frase va armada acá y no adentro de
 * `menciones.js` por dos motivos: para que no haya que enseñarle a ese módulo
 * qué es un uso —hoy no depende de nada y conviene que siga así—, y para que
 * las dos frases sigan saliendo de `USOS` y de ningún otro lado.
 */
function paraResolver(comentario, carpeta) {
    return tira(comentario, carpeta).map(item => ({
        ambito: 'adjunto',
        nombre: item.clave,
        numero: item.numero,
        tipo: item.tipo,
        ruta: item.ruta,
        comoSeLee: comoSeLee(item)
    }));
}

/**
 * Cómo se lee un ítem de la tira adentro de la frase que escribió el editor.
 *
 * Dice el uso entero en el medio de la oración, aunque la lista de abajo lo
 * repita. Es la redundancia a propósito que ya tiene `feedback.js`: el renglón
 * de abajo se puede saltear leyendo, la frase que está adentro de la
 * instrucción no.
 */
function comoSeLee(item) {
    if (item.falta) return `«${item.nombre}» (un archivo adjunto que no se pudo leer del disco)`;
    if (item.clave === 'cuadro') return 'el cuadro de este comentario';
    if (item.clave === 'dibujo') return 'el cuadro de este comentario con el dibujo encima';
    return `«${item.nombre}» (${uso(item.uso).enFrase})`;
}

module.exports = {
    TOPE_BYTES,
    USOS,
    NOMBRES_RESERVADOS,
    nombreUnico,
    tira,
    paraResolver,
    comoSeLee,
    USO_PORDEFECTO,
    uso,
    nombreEnDisco,
    sanear,
    deComentario,
    escribir
};
