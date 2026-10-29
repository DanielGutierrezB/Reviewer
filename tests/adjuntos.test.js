'use strict';
/**
 * Los archivos que el editor le cuelga a un comentario.
 *
 * Lo que se prueba acá no es que la lista se guarde —eso se ve a simple vista—
 * sino las cuatro formas en que esto se rompe sin que nadie lo note: que un
 * adjunto vuelva del deshacer con el nombre pero sin el contenido, que dos
 * archivos que se llaman igual se pisen en silencio, que una ruta escrita a
 * mano en el JSON saque archivos de la carpeta, y —la más cara de todas— que
 * el `feedback.md` no deje claro si un archivo era para mirar o para usar.
 */

const fs = require('fs');
const path = require('path');

const adjuntos = require('../engine/adjuntos');
const comentarios = require('../engine/comentarios');
const feedback = require('../engine/feedback');
const prompts = require('../engine/prompts');
const temporal = require('./lib/temporal');
const workspace = require('../engine/workspace');

module.exports = function (t) {
    t.grupo('Adjuntos de un comentario');

    /** Una versión con un comentario, y archivos sueltos para colgarle. */
    function escenario() {
        const dir = temporal.carpeta('adjuntos');
        const ruta = temporal.archivo(dir, 'Clase 09 v4.mp4');
        const ctx = { rutaVideo: ruta, media: temporal.media() };
        const { id } = comentarios.agregar(ruta, { t: 5, texto: 'El logo va acá' }, ctx);
        return { dir, ruta, ctx, id, archivos: workspace.archivosDeVersion(ruta) };
    }

    const existe = (archivos, relativa) => fs.existsSync(path.join(archivos.carpeta, relativa));
    const leer = (archivos, relativa) => fs.readFileSync(path.join(archivos.carpeta, relativa), 'utf8');

    t.test('un adjunto se COPIA a la carpeta de la versión, que es lo que viaja', () => {
        const { dir, ruta, ctx, id, archivos } = escenario();
        const suelto = temporal.archivo(dir, 'logo.png', 'el logo de verdad');
        const r = comentarios.adjuntar(ruta, id, [{ origen: suelto, nombre: 'logo.png', uso: 'insumo' }], ctx);

        const puesto = r.datos.comentarios[0].adjuntos[0];
        t.eq(puesto.archivo, path.join('adjuntos', 'c01-logo.png'), 'con el id adelante, para saber de quién es');
        t.eq(leer(archivos, puesto.archivo), 'el logo de verdad', 'con el contenido, no con un alias');
        fs.unlinkSync(suelto);
        t.eq(leer(archivos, puesto.archivo), 'el logo de verdad',
            'y sobrevive a que el original se borre: si fuera un puntero, la carpeta no podría mudarse');
    });

    t.test('la ruta que se guarda en el JSON es relativa, porque la carpeta se muda', () => {
        const { dir, ruta, ctx, id, archivos } = escenario();
        comentarios.adjuntar(ruta, id, [{ origen: temporal.archivo(dir, 'nota.txt', 'x'), nombre: 'nota.txt' }], ctx);
        const crudo = fs.readFileSync(archivos.comentarios, 'utf8');
        t.noTiene(crudo, temporal.RAIZ, 'ninguna ruta absoluta adentro del JSON');
        t.tiene(crudo, 'adjuntos/c01-nota.txt');
    });

    t.test('un nombre con acentos y espacios queda con un nombre que viaja', () => {
        const { dir, ruta, ctx, id, archivos } = escenario();
        // Ese nombre va a terminar escrito adentro de un markdown y dentro de
        // una carpeta compartida: las tildes funcionan hasta que la carpeta
        // cruza a otro sistema de archivos.
        const suelto = temporal.archivo(dir, 'paleta.png', 'colores');
        const r = comentarios.adjuntar(ruta, id, [{ origen: suelto, nombre: 'Paleta Otoño 2024.PNG' }], ctx);

        const puesto = r.datos.comentarios[0].adjuntos[0];
        t.eq(path.basename(puesto.archivo), 'c01-paleta-otono-2024.png');
        t.ok(existe(archivos, puesto.archivo), 'y está donde dice que está');
        t.eq(puesto.nombre, 'Paleta Otoño 2024.PNG',
            'pero el nombre que escribió el editor no se pierde: es el que va a leer Claude');
    });

    t.test('dos archivos que se llaman igual no se pisan', () => {
        // Dos capturas `captura.png` son dos cosas distintas. Si la segunda
        // reemplazara a la primera, el comentario seguiría nombrando dos
        // adjuntos y uno de los dos renglones del feedback apuntaría a la
        // imagen equivocada, sin que nada falle.
        const { dir, ruta, ctx, id, archivos } = escenario();
        const a = temporal.archivo(dir, 'a.png', 'la primera');
        const b = temporal.archivo(dir, 'b.png', 'la segunda');
        const r = comentarios.adjuntar(ruta, id, [
            { origen: a, nombre: 'captura.png' },
            { origen: b, nombre: 'captura.png' }
        ], ctx);

        const [uno, dos] = r.datos.comentarios[0].adjuntos;
        t.ok(uno.archivo !== dos.archivo, 'en el disco son dos archivos distintos');
        t.eq(leer(archivos, uno.archivo), 'la primera');
        t.eq(leer(archivos, dos.archivo), 'la segunda');
    });

    t.test('dos comentarios pueden adjuntar el mismo nombre sin enterarse', () => {
        const { dir, ruta, ctx, id, archivos } = escenario();
        const otro = comentarios.agregar(ruta, { t: 40, texto: 'y acá también' }, ctx);
        const suelto = temporal.archivo(dir, 'logo.png', 'el logo');
        comentarios.adjuntar(ruta, id, [{ origen: suelto, nombre: 'logo.png' }], ctx);
        const r = comentarios.adjuntar(ruta, otro.id, [{ origen: suelto, nombre: 'logo.png' }], ctx);

        const nombres = r.datos.comentarios.map(c => path.basename(c.adjuntos[0].archivo));
        t.deep(nombres, ['c01-logo.png', 'c02-logo.png'], 'el id adelante los separa sin sufijos');
        for (const c of r.datos.comentarios) t.ok(existe(archivos, c.adjuntos[0].archivo));
    });

    t.test('borrar el comentario y deshacerlo devuelve el adjunto CON su contenido', () => {
        // El modo en que esto se rompe: la tarjeta reaparece entera, con el
        // nombre del archivo adentro, y el archivo ya no está. Nada falla.
        const { dir, ruta, ctx, id, archivos } = escenario();
        const suelto = temporal.archivo(dir, 'pista.wav', 'la musica');
        const antes = comentarios.adjuntar(ruta, id, [{ origen: suelto, nombre: 'pista.wav', uso: 'insumo' }], ctx).datos;
        const relativa = antes.comentarios[0].adjuntos[0].archivo;

        comentarios.borrar(ruta, id, ctx);
        t.ok(!existe(archivos, relativa), 'el adjunto salió de la carpeta');
        t.eq(fs.readdirSync(archivos.papelera).length, 1, 'y está esperando en la papelera, no en el vacío');

        const vuelto = comentarios.aplicar(ruta, antes, ctx);
        t.eq(vuelto.comentarios[0].adjuntos[0].uso, 'insumo', 'vuelve diciendo lo mismo que decía');
        t.eq(leer(archivos, relativa), 'la musica', 'y con el contenido, no un archivo vacío con el nombre justo');
    });

    t.test('quitar un adjunto de un comentario que se queda también se puede deshacer', () => {
        // Por id no alcanzaba: el comentario está en los dos estados y lo que
        // cambia es su lista de archivos. Si la conciliación mirara solo qué
        // comentarios aparecen y desaparecen, el archivo quedaría suelto en la
        // carpeta y deshacer lo nombraría sin poder traerlo.
        const { dir, ruta, ctx, id, archivos } = escenario();
        const suelto = temporal.archivo(dir, 'ref.png', 'la referencia');
        const antes = comentarios.adjuntar(ruta, id, [{ origen: suelto, nombre: 'ref.png' }], ctx).datos;
        const relativa = antes.comentarios[0].adjuntos[0].archivo;

        const sinEl = comentarios.quitarAdjunto(ruta, id, relativa, ctx);
        t.eq(sinEl.comentarios[0].adjuntos.length, 0, 'se fue de la tarjeta');
        t.ok(!existe(archivos, relativa), 'y de la carpeta');
        t.eq(fs.readdirSync(archivos.papelera).length, 1, 'pero no del disco');

        comentarios.aplicar(ruta, antes, ctx);
        t.eq(leer(archivos, relativa), 'la referencia', 'deshacer lo trae de vuelta entero');

        comentarios.aplicar(ruta, sinEl, ctx);
        t.ok(!existe(archivos, relativa), 'y rehacer lo vuelve a guardar');
    });

    t.test('cambiar para qué sirve no mueve el archivo de lugar', () => {
        const { dir, ruta, ctx, id, archivos } = escenario();
        const suelto = temporal.archivo(dir, 'logo.png', 'el logo');
        const puesto = comentarios.adjuntar(ruta, id, [{ origen: suelto, nombre: 'logo.png' }], ctx)
            .datos.comentarios[0].adjuntos[0];
        t.eq(puesto.uso, 'referencia', 'entra como el error barato: mirarlo');

        const r = comentarios.usarAdjunto(ruta, id, puesto.archivo, 'insumo', ctx);
        t.eq(r.comentarios[0].adjuntos[0].uso, 'insumo');
        t.eq(leer(archivos, puesto.archivo), 'el logo', 'el archivo no se movió ni pasó por la papelera');
        t.ok(!fs.existsSync(archivos.papelera), 'ni se creó la papelera por un cambio que no borra nada');
    });

    t.test('una ruta de adjunto inventada en el JSON no saca archivos de la carpeta', () => {
        // El `comentarios.json` es un archivo que alguien puede abrir y editar,
        // y de él sale una ruta que se usa para mover archivos.
        const { dir, ruta, ctx, id } = escenario();
        const afuera = temporal.archivo(dir, 'no-tocar.mp4', 'el render de otra clase');
        const datos = comentarios.leer(ruta, ctx.media);

        const envenenado = {
            ...datos,
            comentarios: [{
                ...datos.comentarios[0],
                adjuntos: [{ archivo: '../no-tocar.mp4', nombre: 'no-tocar.mp4', uso: 'insumo' }]
            }]
        };
        comentarios.aplicar(ruta, envenenado, ctx);
        comentarios.borrar(ruta, id, ctx);

        t.ok(fs.existsSync(afuera), 'el render de al lado sigue donde estaba');
    });

    t.test('un nombre con barras no escribe fuera de adjuntos/', () => {
        const { dir, ruta, ctx, id, archivos } = escenario();
        const suelto = temporal.archivo(dir, 'x.png', 'x');
        const r = comentarios.adjuntar(ruta, id, [{ origen: suelto, nombre: '../../fuera.png' }], ctx);
        const puesto = r.datos.comentarios[0].adjuntos[0];

        t.tiene(puesto.archivo, 'adjuntos/', 'quedó adentro igual');
        t.ok(existe(archivos, puesto.archivo));
        t.ok(!fs.existsSync(path.join(dir, 'fuera.png')), 'y no se escribió al lado de los renders');
    });

    t.test('adjuntar a un comentario que no existe no crea ninguna carpeta', () => {
        // La regla del proyecto: nada en el disco hasta que hay un comentario.
        // La ventana manda el id después de guardar, pero un id viejo colgado
        // en una ventana que no se repintó no puede dejar una `adjuntos/` vacía
        // al lado de un render sin comentarios.
        const dir = temporal.carpeta('adjuntos-vacio');
        const ruta = temporal.archivo(dir, 'Clase 11 v1.mp4');
        const ctx = { rutaVideo: ruta, media: temporal.media() };
        const suelto = temporal.archivo(dir, 'algo.png', 'x');

        comentarios.adjuntar(ruta, 'c07', [{ origen: suelto, nombre: 'algo.png' }], ctx);
        t.ok(!fs.existsSync(workspace.carpetaDeVersion(ruta)), 'la carpeta de la versión no existe');
    });

    t.test('lo que no se pudo copiar vuelve dicho, y no se lleva a los demás', () => {
        const { dir, ruta, ctx, id } = escenario();
        const bueno = temporal.archivo(dir, 'bueno.png', 'sí');
        const r = comentarios.adjuntar(ruta, id, [
            { origen: path.join(dir, 'esto-no-esta.png'), nombre: 'perdido.png' },
            { origen: bueno, nombre: 'bueno.png' }
        ], ctx);

        t.eq(r.puestos.length, 1, 'el que estaba entró');
        t.eq(r.fallados.length, 1, 'y del otro se avisa en vez de tirar todo');
        t.eq(r.fallados[0].nombre, 'perdido.png');
    });

    t.test('el tope del puente es un número solo, aunque se mire de los dos lados', () => {
        // Las dos comprobaciones no sobran y no son la misma: la de la ventana
        // está para no hacer el trabajo caro —leer el archivo entero y armarle
        // un base64 de 1,33× para la miniatura— y la del motor está para
        // sostener la regla, porque escribe en la carpeta del editor y no puede
        // confiar en que quien lo llamó haya mirado algo. Lo que no puede haber
        // son dos números: el día que se suba el tope, el que quede atrás deja
        // al otro de adorno.
        const texto = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'adjuntos.js'), 'utf8');
        const m = /const TOPE_BYTES = (\d+) \* 1024 \* 1024;/.exec(texto);
        t.ok(m, 'la ventana declara su tope en MB, igual que el motor');
        t.eq(Number(m[1]) * 1024 * 1024, adjuntos.TOPE_BYTES, 'y es el mismo número');
    });

    t.test('la ventana mide el archivo ANTES de leerlo, que es de lo que se trata', () => {
        // El bug era el orden, no la falta del tope: medir después del
        // `arrayBuffer()` es pagar los segundos de ventana congelada enteros
        // para terminar en el mismo error. `blob.size` está gratis antes.
        const texto = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'adjuntos.js'), 'utf8');
        const mide = texto.indexOf('blob.size > TOPE_BYTES');
        const lee = texto.indexOf('await blob.arrayBuffer()');
        t.ok(mide > 0, '`deBlob` mira `blob.size`');
        t.ok(lee > 0, 'y sigue leyendo los bytes de los que sí entran');
        t.ok(mide < lee, 'pero mide primero');
    });

    t.test('lo que no entra por el puente vuelve diciendo cuánto pesa y contra qué', () => {
        // «Pesa demasiado» obliga a adivinar si sobran dos megas o doscientos.
        const { ruta, ctx, id } = escenario();
        const r = comentarios.adjuntar(ruta, id, [
            { bytes: Buffer.alloc(adjuntos.TOPE_BYTES + 1), nombre: 'render.png' },
            { bytes: Buffer.from('un png de mentira'), nombre: 'chico.png' }
        ], ctx);

        t.eq(r.puestos.length, 1, 'el que entraba entró igual');
        t.eq(r.fallados.length, 1);
        t.eq(r.fallados[0].nombre, 'render.png');
        t.tiene(r.fallados[0].motivo, '64 MB', 'dice el tope');
        t.tiene(r.fallados[0].motivo, '64.1 MB',
            'y el tamaño redondeado para arriba, para que no diga «pesa 64 y el tope es 64»');
    });

    t.test('el feedback no deja confundir «mirá esto» con «usá este archivo»', () => {
        const { dir, ruta, ctx, id } = escenario();
        const uno = temporal.archivo(dir, 'uno.png', 'a');
        const dos = temporal.archivo(dir, 'dos.png', 'b');
        comentarios.adjuntar(ruta, id, [
            { origen: uno, nombre: 'otra-pieza.png', uso: 'referencia' },
            { origen: dos, nombre: 'logo-final.png', uso: 'insumo' }
        ], ctx);

        const md = fs.readFileSync(workspace.archivosDeVersion(ruta).feedback, 'utf8');

        t.tiene(md, 'SOLO DE REFERENCIA', 'el uso va en versales y antes del nombre');
        t.tiene(md, 'PARA USAR TAL CUAL');
        t.tiene(md, '«otra-pieza.png»');
        t.tiene(md, '«logo-final.png»');
        t.tiene(md, 'NO va adentro de la pieza', 'la orden entera, no solo una etiqueta interpretable');
        t.tiene(md, 'No lo rehagas, no lo imites');
        t.tiene(md, 'Ante la duda, preguntá antes de usar uno.');
    });

    t.test('la ruta del adjunto en el feedback es absoluta, porque Claude la va a abrir', () => {
        const { dir, ruta, ctx, id } = escenario();
        const suelto = temporal.archivo(dir, 'manual.pdf', 'x');
        const r = comentarios.adjuntar(ruta, id, [{ origen: suelto, nombre: 'manual.pdf' }], ctx);
        const relativa = r.datos.comentarios[0].adjuntos[0].archivo;

        const md = fs.readFileSync(workspace.archivosDeVersion(ruta).feedback, 'utf8');
        t.tiene(md, path.join(workspace.carpetaDeVersion(ruta), relativa));
        t.noTiene(md, `: ${relativa}`, 'y nunca la relativa, que no abre nada');
    });

    t.test('un adjunto que no es imagen no se anuncia como imagen', () => {
        const { dir, ruta, ctx, id } = escenario();
        const suelto = temporal.archivo(dir, 'pista.wav', 'x');
        const r = comentarios.adjuntar(ruta, id, [{ origen: suelto, nombre: 'pista.wav', uso: 'insumo' }], ctx);
        t.eq(r.datos.comentarios[0].adjuntos[0].tipo, 'documento',
            'la tarjeta le pone un icono y no una miniatura rota');
    });

    t.test('el rótulo que elige el editor y la frase que lee Claude salen del mismo lugar', () => {
        // Dos copias del texto que distingue mirar de usar es cómo se consigue
        // que el selector diga una cosa y el markdown diga otra, y eso no se ve
        // desde ningún lado: se ve en el render de mañana.
        for (const u of Object.values(adjuntos.USOS)) {
            t.ok(u.rotulo && u.ayuda && u.titulo && u.frase && u.corto, `${u.id} está completo`);
        }
        const { dir, ruta, ctx, id } = escenario();
        comentarios.adjuntar(ruta, id, [
            { origen: temporal.archivo(dir, 'z.png', 'x'), nombre: 'z.png', uso: 'insumo' }
        ], ctx);
        const md = fs.readFileSync(workspace.archivosDeVersion(ruta).feedback, 'utf8');
        t.tiene(md, adjuntos.USOS.insumo.titulo, 'el markdown usa el mismo texto que la ventana');
        t.tiene(md, adjuntos.USOS.insumo.frase);
    });

    t.test('un uso que no existe cae en el que no hace daño', () => {
        // Un JSON viejo, o editado a mano, no puede dejar un adjunto sin uso:
        // si el feedback no dijera nada, Claude decide solo, y ahí está el
        // error que no se ve.
        const puesto = adjuntos.sanear({ archivo: 'adjuntos/c01-x.png', uso: 'cualquier-cosa' });
        t.eq(puesto.uso, 'referencia', 'mirarlo es el error barato; usarlo mal es el caro');
    });

    t.test('el bloque de archivos del final ya no promete solo imágenes', () => {
        const { dir, ruta, ctx, id } = escenario();
        comentarios.adjuntar(ruta, id, [
            { origen: temporal.archivo(dir, 'g.pdf', 'x'), nombre: 'guion.pdf' }
        ], ctx);
        const datos = comentarios.leer(ruta, ctx.media);
        const md = feedback.escribir(datos, { rutaVideo: ruta });

        t.tiene(md, 'Dónde está cada archivo');
        t.tiene(md, 'de referencia, «guion.pdf»', 'y el nombre va pegado al uso en la lista de abajo');
    });

    t.test('el encargo consolidado también dice para qué sirve cada adjunto', () => {
        // El resumen de «Preparar para Claude» es lo primero que se lee. Si
        // ahí dijera solo que el comentario «viene con un archivo», el modelo
        // decidiría qué hacer con él antes de llegar a la lista de abajo.
        const { dir, ruta, ctx, id } = escenario();
        comentarios.adjuntar(ruta, id, [
            { origen: temporal.archivo(dir, 'l.png', 'x'), nombre: 'logo.png', uso: 'insumo' }
        ], ctx);
        const texto = prompts.comentariosComoTexto(comentarios.leer(ruta, ctx.media));

        t.tiene(texto, 'PARA USAR TAL CUAL');
        t.tiene(texto, '«logo.png»');
    });

    t.test('lo pegado del portapapeles entra por bytes, que es lo único que trae', () => {
        const { ruta, ctx, id, archivos } = escenario();
        const r = comentarios.adjuntar(ruta, id, [
            { bytes: Buffer.from('un png de mentira'), nombre: 'pegado-20261028-2200.png' }
        ], ctx);
        const puesto = r.datos.comentarios[0].adjuntos[0];
        t.eq(leer(archivos, puesto.archivo), 'un png de mentira');
    });
};
