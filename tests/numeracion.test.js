'use strict';
/**
 * Numerar los archivos de un comentario y poder nombrarlos desde el texto.
 *
 * Todo lo de acá protege la misma decisión, que es la que hace que la función
 * sirva dentro de dos semanas y no solo el día que se escribió el comentario:
 * **el número es presentación y el nombre es almacenamiento**. Lo que se
 * guarda en el texto es `@[adjunto/paleta.png]`; «2» es lo que se dibuja.
 *
 * Si alguna vez alguien guarda el número, nada de esto falla al escribirlo:
 * falla cuando se borra el adjunto de arriba, el comentario pasa a hablar de
 * otro archivo, el `feedback.md` se escribe igual y Claude obedece la
 * instrucción equivocada. Se descubre mirando el render de mañana. Por eso el
 * test que más importa de este archivo es el de la renumeración, que compara
 * el texto byte a byte.
 */

const fs = require('fs');
const path = require('path');

const adjuntos = require('../engine/adjuntos');
const comentarios = require('../engine/comentarios');
const feedback = require('../engine/feedback');
const menciones = require('../engine/menciones');
const temporal = require('./lib/temporal');
const workspace = require('../engine/workspace');

module.exports = async function (t) {
    t.grupo('Numeración de los archivos de un comentario');

    function escenario(nombre) {
        const dir = temporal.carpeta(nombre || 'numeracion');
        const ruta = temporal.archivo(dir, 'Clase 12 v2.mp4');
        return { dir, ruta, ctx: { rutaVideo: ruta, media: temporal.media() }, carpeta: workspace.carpetaDeVersion(ruta) };
    }

    /** Un comentario con cuadro, dibujo y los adjuntos que se pidan. */
    function conTodo(e, texto, nombresDeAdjuntos) {
        const { id } = comentarios.agregar(e.ruta, { t: 3, texto: texto || 'x' }, e.ctx);
        const archivos = workspace.archivosDeVersion(e.ruta);
        fs.mkdirSync(archivos.frames, { recursive: true });
        fs.mkdirSync(archivos.dibujos, { recursive: true });
        fs.writeFileSync(path.join(archivos.frames, `${id}.png`), 'cuadro');
        fs.writeFileSync(path.join(archivos.dibujos, `${id}.png`), 'dibujo');
        comentarios.editar(e.ruta, id, {
            frame: path.join(workspace.FRAMES_DIR, `${id}.png`),
            dibujo: path.join(workspace.DIBUJOS_DIR, `${id}.png`)
        }, e.ctx);
        for (const n of (nombresDeAdjuntos || [])) {
            comentarios.adjuntar(e.ruta, id, [
                { origen: temporal.archivo(e.dir, `src-${adjuntos.nombreUnico([], n)}`, `soy ${n}`), nombre: n }
            ], e.ctx);
        }
        return { id, datos: comentarios.leer(e.ruta, e.ctx.media) };
    }

    const deC = (datos, id) => datos.comentarios.find(c => c.id === id);

    t.test('la tira es cuadro, dibujo y después los adjuntos, numerados desde 1', () => {
        const e = escenario();
        const { id, datos } = conTodo(e, 'x', ['paleta.png', 'brief.pdf']);
        const tira = adjuntos.tira(deC(datos, id), e.carpeta);

        t.deep(tira.map(i => i.clave), ['cuadro', 'dibujo', 'paleta.png', 'brief.pdf'],
            'el dibujo va pegado al cuadro, que es el orden que ya usaba el feedback');
        t.deep(tira.map(i => i.numero), [1, 2, 3, 4]);
    });

    t.test('un comentario sin cuadro numera su primer adjunto como 1', () => {
        const e = escenario();
        const { id } = comentarios.agregar(e.ruta, { t: 1, texto: 'x' }, e.ctx);
        const r = comentarios.adjuntar(e.ruta, id, [
            { origen: temporal.archivo(e.dir, 'a.png', 'a'), nombre: 'sola.png' }
        ], e.ctx);
        t.eq(adjuntos.tira(deC(r.datos, id), e.carpeta)[0].numero, 1);
    });

    t.test('imágenes y documentos comparten UNA secuencia', () => {
        // El pedido fue «cada imagen o archivo está numerado». Dos secuencias
        // obligarían al editor a saber de qué clase es el archivo antes de
        // poder nombrarlo, y en Reviewer un PDF marcado «tal cual» se señala
        // tan seguido como una imagen.
        const e = escenario();
        const { id, datos } = conTodo(e, 'x', ['uno.png', 'dos.pdf', 'tres.png']);
        const tira = adjuntos.tira(deC(datos, id), e.carpeta);
        t.deep(tira.filter(i => i.clave.includes('.')).map(i => `${i.numero}:${i.tipo}`),
            ['3:imagen', '4:documento', '5:imagen']);
    });

    t.test('lo que no está en el disco NO ocupa número', () => {
        // Si el feedback dice «van 3 archivos», tiene que ser cierto. Un hueco
        // en la cuenta es peor que una lista más corta: el modelo busca un
        // número que no le llegó.
        const e = escenario();
        const { id, datos } = conTodo(e, 'x', ['va.png', 'noVa.png', 'tambien.png']);
        const c = deC(datos, id);
        fs.unlinkSync(path.join(e.carpeta, c.adjuntos[1].archivo));

        // La tira es [cuadro, dibujo, va, noVa, tambien].
        const tira = adjuntos.tira(c, e.carpeta);
        t.eq(tira[2].numero, 3, 'el de antes conserva el suyo');
        t.eq(tira[3].numero, null, 'el que falta se queda sin número');
        t.ok(tira[3].falta);
        t.eq(tira[4].numero, 4, 'y el que sigue toma el que aquél hubiera tenido');
    });

    t.test('quitar un adjunto del medio corre los números y NO toca el texto', () => {
        // Es el test que justifica todo el diseño. Si el número estuviera
        // guardado en el texto, acá el comentario pasaría a hablar de otro
        // archivo y nada fallaría.
        const e = escenario();
        const escrito = 'Cambiá la paleta por la de @[adjunto/paleta.png] y mirá @[adjunto/cuadro].';
        const { id, datos } = conTodo(e, escrito, ['logo.png', 'paleta.png']);
        const antes = adjuntos.tira(deC(datos, id), e.carpeta);
        t.eq(antes.find(i => i.clave === 'paleta.png').numero, 4);

        const sinLogo = comentarios.quitarAdjunto(e.ruta, id, deC(datos, id).adjuntos[0].archivo, e.ctx);
        const despues = adjuntos.tira(deC(sinLogo, id), e.carpeta);

        t.eq(despues.find(i => i.clave === 'paleta.png').numero, 3, 'el badge corrió solo');
        t.eq(deC(sinLogo, id).texto, escrito, 'y el texto quedó byte a byte igual');
    });

    t.test('el cuadro y el dibujo son nombrables, y nadie se los puede robar', () => {
        // La captura que el editor quiere señalar es justamente el cuadro, así
        // que sin esto el pedido queda a medias. Y un adjunto no puede pisar
        // esos dos nombres: `nombreUnico` los tiene tomados de entrada.
        const e = escenario();
        const { id, datos } = conTodo(e, 'x', ['cuadro', 'dibujo']);
        const tira = adjuntos.tira(deC(datos, id), e.carpeta);

        t.eq(tira[0].token, '@[adjunto/cuadro]');
        t.eq(tira[1].token, '@[adjunto/dibujo]');
        t.deep(tira.slice(2).map(i => i.clave), ['cuadro (2)', 'dibujo (2)'],
            'el adjunto que se quiso llamar «cuadro» se corrió solo');
    });

    t.grupo('Numeración: la gramática del ámbito nuevo');

    t.test('`adjunto` es un ámbito como los otros dos', () => {
        t.eq(menciones.escribir('adjunto', 'paleta.png'), '@[adjunto/paleta.png]');
        const [m] = menciones.encontrar('mirá @[adjunto/paleta.png] acá');
        t.eq(m.ambito, 'adjunto');
        t.eq(m.nombre, 'paleta.png');
    });

    t.test('un nombre con espacios y acentos viaja entero adentro del token', () => {
        // Por esto el token va entre corchetes y no es un `@nombre` suelto: no
        // habría dónde termina. macOS escribe «Captura de pantalla 2026.png».
        const [m] = menciones.encontrar('@[adjunto/Paleta Otoño 2024.png]');
        t.eq(m.nombre, 'Paleta Otoño 2024.png');
    });

    t.test('un token larguísimo no empareja, para que un corchete suelto no se coma el texto', () => {
        t.eq(menciones.encontrar(`@[adjunto/${'x'.repeat(220)}]`).length, 0);
    });

    t.grupo('Numeración: cómo lo lee Claude');

    t.test('un adjunto «tal cual» se resuelve con la frase exacta de USOS', () => {
        // Leída del módulo y no copiada acá: si alguien mejora la redacción de
        // la frase, el test sigue pasando. Lo que no puede cambiar es que la
        // frase del markdown y el rótulo del selector salgan del mismo objeto.
        const e = escenario();
        const { id } = comentarios.agregar(e.ruta, { t: 1, texto: 'Poné @[adjunto/logo.png] en la esquina.' }, e.ctx);
        comentarios.adjuntar(e.ruta, id, [
            { origen: temporal.archivo(e.dir, 'l.png', 'x'), nombre: 'logo.png', uso: 'insumo' }
        ], e.ctx);

        const md = fs.readFileSync(workspace.archivosDeVersion(e.ruta).feedback, 'utf8');
        t.tiene(md, adjuntos.USOS.insumo.enFrase);
        t.tiene(md, 'Poné «logo.png» (');
        t.noTiene(md, '@[adjunto/logo.png]', 'el token no llega crudo al markdown');
        t.noTiene(md, 'Poné @2', 'y el número tampoco: al markdown llega el nombre y la orden');
    });

    t.test('uno «de referencia» se resuelve con la suya, que dice lo contrario', () => {
        const e = escenario();
        const { id } = comentarios.agregar(e.ruta, { t: 1, texto: 'Como en @[adjunto/otra.png].' }, e.ctx);
        comentarios.adjuntar(e.ruta, id, [
            { origen: temporal.archivo(e.dir, 'o.png', 'x'), nombre: 'otra.png', uso: 'referencia' }
        ], e.ctx);

        const md = fs.readFileSync(workspace.archivosDeVersion(e.ruta).feedback, 'utf8');
        t.tiene(md, adjuntos.USOS.referencia.enFrase);
        t.noTiene(md, adjuntos.USOS.insumo.enFrase);
    });

    t.test('`@[adjunto/cuadro]` se resuelve al cuadro de SU comentario', () => {
        const e = escenario();
        const { id } = conTodo(e, 'Mirá @[adjunto/cuadro] y @[adjunto/dibujo].', []);
        const md = fs.readFileSync(workspace.archivosDeVersion(e.ruta).feedback, 'utf8');
        t.tiene(md, 'Mirá el cuadro de este comentario y el cuadro de este comentario con el dibujo encima.');
        t.ok(id, 'había un comentario');
    });

    t.test('EL CASO DE RIESGO: el @[adjunto/x.png] del c01 no se resuelve al x.png del c02', () => {
        // `adjunto` es el primer ámbito relativo al comentario que lo contiene.
        // Por eso `resolver` se llama por comentario y no una vez para todo el
        // archivo. Con una sola lista global, el segundo comentario resolvería
        // al archivo del primero y escribiría SU ruta: nada fallaría y Claude
        // abriría el archivo equivocado.
        const e = escenario();
        const uno = comentarios.agregar(e.ruta, { t: 1, texto: 'Acá va @[adjunto/x.png].' }, e.ctx);
        comentarios.adjuntar(e.ruta, uno.id, [
            { origen: temporal.archivo(e.dir, 'a.png', 'el de c01'), nombre: 'x.png', uso: 'insumo' }
        ], e.ctx);
        const dos = comentarios.agregar(e.ruta, { t: 9, texto: 'Y acá va @[adjunto/x.png].' }, e.ctx);
        comentarios.adjuntar(e.ruta, dos.id, [
            { origen: temporal.archivo(e.dir, 'b.png', 'el de c02'), nombre: 'x.png', uso: 'insumo' }
        ], e.ctx);

        const datos = comentarios.leer(e.ruta, e.ctx.media);
        t.eq(deC(datos, uno.id).adjuntos[0].archivo, 'adjuntos/c01-x.png');
        t.eq(deC(datos, dos.id).adjuntos[0].archivo, 'adjuntos/c02-x.png');

        const md = fs.readFileSync(workspace.archivosDeVersion(e.ruta).feedback, 'utf8');
        // Solo el cuerpo de cada comentario: el bloque de cierre lista los
        // archivos de todos juntos, y meterlo acá haría pasar el test por el
        // motivo equivocado.
        const cuerpo = id => md.split('### ').find(b => b.startsWith(id)).split('\n## ')[0];
        const bloqueUno = cuerpo(uno.id);
        const bloqueDos = cuerpo(dos.id);

        t.tiene(bloqueUno, path.join(e.carpeta, 'adjuntos', 'c01-x.png'));
        t.noTiene(bloqueUno, 'c02-x.png', 'el c01 no nombra el archivo del c02');
        t.tiene(bloqueDos, path.join(e.carpeta, 'adjuntos', 'c02-x.png'));
        t.noTiene(bloqueDos, 'c01-x.png', 'ni el c02 el del c01');
    });

    t.test('una mención a un adjunto que ya no está se DICE, no se borra', () => {
        const e = escenario();
        const { id } = comentarios.agregar(e.ruta, { t: 1, texto: 'Como en @[adjunto/se-fue.png].' }, e.ctx);
        comentarios.adjuntar(e.ruta, id, [
            { origen: temporal.archivo(e.dir, 'q.png', 'x'), nombre: 'otra.png' }
        ], e.ctx);

        const md = fs.readFileSync(workspace.archivosDeVersion(e.ruta).feedback, 'utf8');
        t.tiene(md, 'ya no está adjunta', 'borrarla dejaría la frase hablando de nada');
        t.tiene(md, '«se-fue.png»', 'y se dice cuál era');
    });

    t.test('las referencias del curso siguen resolviéndose al lado de los adjuntos', () => {
        // El cambio de mayor riesgo fue pasar `resolver` a ser por comentario.
        // Lo que no se podía romper es lo que ya andaba.
        const e = escenario();
        const { id } = comentarios.agregar(e.ruta, { t: 1, texto: 'Con @[curso/logo.svg] y @[adjunto/p.png].' }, e.ctx);
        comentarios.adjuntar(e.ruta, id, [
            { origen: temporal.archivo(e.dir, 'p.png', 'x'), nombre: 'p.png', uso: 'insumo' }
        ], e.ctx);

        const datos = comentarios.leer(e.ruta, e.ctx.media);
        const md = feedback.escribir(datos, {
            rutaVideo: e.ruta,
            referencias: [{ ambito: 'curso', nombre: 'logo.svg', numero: 1, tipo: 'imagen', ruta: '/tmp/logo.svg' }]
        });
        t.tiene(md, 'Con imagen 1 y «p.png» (');
    });

    t.test('la ruta del adjunto es absoluta en el markdown y relativa en el JSON', () => {
        const e = escenario();
        const { id } = comentarios.agregar(e.ruta, { t: 1, texto: 'Mirá @[adjunto/d.pdf].' }, e.ctx);
        comentarios.adjuntar(e.ruta, id, [
            { origen: temporal.archivo(e.dir, 'd.pdf', 'x'), nombre: 'd.pdf' }
        ], e.ctx);

        const archivos = workspace.archivosDeVersion(e.ruta);
        t.noTiene(fs.readFileSync(archivos.comentarios, 'utf8'), temporal.RAIZ);
        t.tiene(fs.readFileSync(archivos.feedback, 'utf8'), path.join(e.carpeta, 'adjuntos', 'c01-d.pdf'));
    });

    t.grupo('Numeración: el campo de texto de la ventana');

    const campo = await import(path.join(__dirname, '..', 'src', 'js', 'menciones-campo.js'));

    /** La tira como la recibe la ventana, ya numerada por el motor. */
    const TIRA = [
        { clave: 'cuadro', nombre: 'cuadro', numero: 1, token: '@[adjunto/cuadro]', etiqueta: '@1', falta: false },
        { clave: 'paleta.png', nombre: 'paleta.png', numero: 2, token: '@[adjunto/paleta.png]', etiqueta: '@2', falta: false },
        { clave: 'Paleta Otoño.png', nombre: 'Paleta Otoño.png', numero: 3, token: '@[adjunto/Paleta Otoño.png]', etiqueta: '@3', falta: false }
    ];

    t.test('EL BUG QUE ROMPÍA LAS MENCIONES: partir y volver a unir devuelve lo mismo', () => {
        // El campo de la tarjeta es un `contenteditable` que muestra el chip
        // corto, y el guardado leía `innerText`. O sea que abrir un comentario
        // con una mención, tocarle una letra y salir guardaba «@logo.svg», que
        // ya no empareja con el regex: la referencia dejaba de resolverse y
        // Claude dejaba de recibir la ruta. Silencioso.
        //
        // Este es el ida y vuelta que lo reemplazó: `partir` arma los chips y
        // `unir` reconstruye lo que se guarda, leyendo el token del atributo.
        for (const texto of [
            'Sin ninguna mención.',
            'Cambiá la de @[adjunto/paleta.png] y mirá @[adjunto/cuadro].',
            '@[curso/logo.svg] al principio',
            'al final @[adjunto/Paleta Otoño.png]',
            'pegadas @[adjunto/cuadro]@[adjunto/dibujo] sin espacio'
        ]) {
            t.eq(campo.unir(campo.partir(texto)), texto, `vuelve igual: ${texto}`);
        }
    });

    t.test('el chip muestra el número, no el nombre largo', () => {
        t.eq(campo.etiquetaDe('adjunto/paleta.png', TIRA), '@2');
        t.eq(campo.etiquetaDe('adjunto/cuadro', TIRA), '@1');
    });

    t.test('una mención colgada muestra el NOMBRE, porque un «@?» no diría cuál', () => {
        t.eq(campo.etiquetaDe('adjunto/se-fue.png', TIRA), '@se-fue.png');
        t.ok(campo.estaColgada('adjunto/se-fue.png', TIRA, []));
        t.ok(!campo.estaColgada('adjunto/paleta.png', TIRA, []));
    });

    t.test('una referencia del curso no se da por colgada', () => {
        t.ok(!campo.estaColgada('curso/logo.svg', TIRA, [{ nombre: 'logo.svg', falta: false }]));
    });

    t.test('insertar pone los espacios a mano, y no antes de una coma', () => {
        t.eq(campo.insertar('poné el logo', 12, '@[adjunto/x.png]').texto, 'poné el logo @[adjunto/x.png]');
        t.eq(campo.insertar('mirá , ahí', 5, '@[adjunto/x.png]').texto, 'mirá @[adjunto/x.png], ahí',
            'sin un espacio pegado antes de la coma');
        t.eq(campo.insertar('', 0, '@[adjunto/x.png]').texto, '@[adjunto/x.png]');
    });

    t.test('la regla de espaciado es UNA, y la usan los dos campos', () => {
        // Estaba escrita dos veces con los regex copiados a mano: en
        // `insertar` (el redactor, que parte un string) y en `nombrarEn` de
        // `comentarios.js` (las tarjetas, que preguntan con dos `Range`). El
        // modo de falla era agregarle un signo a la puntuación en un lado
        // solo, así que lo que se prueba acá es la función que los dos llaman
        // —`espacios`, de dos strings a dos strings—, que es lo que pueden
        // compartir aunque uno trabaje sobre texto y el otro sobre nodos.
        t.deep(campo.espacios('poné el logo', ''), { izq: ' ', der: '' });
        t.deep(campo.espacios('poné el logo ', ''), { izq: '', der: '' }, 'no duplica el espacio que ya estaba');
        t.deep(campo.espacios('', 'y después'), { izq: '', der: ' ' }, 'al principio no sobra nada a la izquierda');
        for (const signo of [',', '.', ';', ':', ')', ']']) {
            t.deep(campo.espacios('mirá', `${signo} ahí`), { izq: ' ', der: '' }, `«@[…] ${signo}» no lleva espacio`);
        }
    });

    t.test('el cursor queda DESPUÉS del token, para poder seguir la frase', () => {
        const r = campo.insertar('poné el logo', 12, '@[adjunto/x.png]');
        t.eq(r.texto.slice(0, r.cursor), 'poné el logo @[adjunto/x.png]');
    });

    t.test('sin cursor recordado la mención va al FINAL, nunca al principio', () => {
        // El caso más común es leer una tarjeta vieja y tocarle la miniatura;
        // poner el token antes de la primera palabra parte la frase que estaba.
        t.eq(campo.dondeCae(20, null), 20);
        t.eq(campo.dondeCae(20, 7), 7, 'y con cursor recordado, ahí');
        t.eq(campo.dondeCae(5, 99), 5, 'un cursor viejo más largo que el texto no se sale');
    });

    t.grupo('Numeración: el menú del @');

    t.test('un `@` pegado a una palabra NO abre el menú', () => {
        // Sin esta regla, cada «dani@nova.com» que alguien escriba abre un menú.
        t.eq(campo.disparo('escribile a dani@nova.com', 25), null);
    });

    t.test('un `@` al principio o después de un espacio sí', () => {
        t.eq(campo.disparo('@pal', 4).consulta, 'pal');
        t.eq(campo.disparo('mirá @pal', 9).consulta, 'pal');
    });

    t.test('adentro de un token ya escrito NO se reabre', () => {
        // Si no, elegir ahí dejaría un token adentro de otro.
        t.eq(campo.disparo('mirá @[adjunto/paleta.png]', 20), null);
    });

    t.test('un `@` a más de 60 caracteres del cursor no dispara nada', () => {
        const largo = `@ ${'x'.repeat(80)}`;
        t.eq(campo.disparo(largo, largo.length), null);
    });

    t.test('el filtro pliega acentos: «otono» encuentra «Paleta Otoño.png»', () => {
        t.deep(campo.candidatos(TIRA, 'otono').map(i => i.numero), [3]);
    });

    t.test('UNA CONSULTA DE SOLO DÍGITOS EMPAREJA POR NÚMERO', () => {
        // Es lo que hace que «@2 + Enter» sea el camino rápido SIN que «@2»
        // sea una sintaxis: lo tecleado se reemplaza entero por el token con
        // el nombre, así que lo que queda guardado sobrevive a que la lista se
        // mueva. El editor escribe lo que piensa; el disco guarda lo estable.
        const [elegido] = campo.candidatos(TIRA, '2');
        t.eq(elegido.token, '@[adjunto/paleta.png]');
        t.noTiene(elegido.token, '2', 'lo que se inserta no tiene el número adentro');
    });

    t.test('un número que no existe no ofrece nada, en vez de ofrecer cualquier cosa', () => {
        t.deep(campo.candidatos(TIRA, '9'), []);
    });

    t.test('sin consulta se ofrecen todos', () => {
        t.eq(campo.candidatos(TIRA, '').length, 3);
    });
};
