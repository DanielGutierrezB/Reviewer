'use strict';
/**
 * La red que hay entre el modelo y el campo del editor.
 *
 * Los tres modos de falla —el modelo contesta en vez de reescribir, se come la
 * mitad de lo que se pidió, o pierde una mención— se ven todos igual desde
 * afuera: un texto razonable en el campo. Por eso tienen tests.
 */

const prompts = require('../engine/prompts');

module.exports = function (t) {
    t.grupo('Refinar: limpiar lo que vuelve');

    t.test('se saca el razonamiento que algunos modelos escriben adentro', () => {
        t.eq(prompts.limpiar('<think>a ver…</think>\nQue el fade dure el doble.'), 'Que el fade dure el doble.');
    });

    t.test('se saca la cortesía de apertura', () => {
        t.eq(prompts.limpiar('Aquí tenés la nota:\nAlargar el fade.'), 'Alargar el fade.');
        t.eq(prompts.limpiar('Nota: alargar el fade.'), 'alargar el fade.');
    });

    t.test('las comillas que envuelven todo se van; las del medio no', () => {
        t.eq(prompts.limpiar('"Alargar el fade."'), 'Alargar el fade.');
        t.eq(prompts.limpiar('Que diga "Hola" en grande.'), 'Que diga "Hola" en grande.');
    });

    t.grupo('Refinar: verificar antes de tocar el campo');

    t.test('un texto vacío no pasa', () => {
        t.eq(prompts.verificar('', 'algo que se dijo').ok, false);
    });

    t.test('una negativa se reporta como negativa, no como resumen', () => {
        // El motivo correcto vale más que el rechazo: «se comió tu pedido»
        // mandaría al editor a mirar su dictado cuando el problema es otro.
        const r = prompts.verificar('No puedo ayudarte con eso.', 'quiero que el título entre más lento y que el corte sea seco');
        t.eq(r.ok, false);
        t.tiene(r.motivo, 'contestó en vez de reescribir');
    });

    t.test('un resumen que se comió la mitad no pasa', () => {
        const original = 'que el título entre más lento con un fade de dos segundos y que la música baje cuando habla y el corte del final sea seco';
        const r = prompts.verificar('Ajustar el título.', original);
        t.eq(r.ok, false);
        t.tiene(r.motivo, 'resumió');
    });

    t.test('un texto corto SÍ se puede acortar', () => {
        t.eq(prompts.verificar('Alargar esto.', 'que esto dure más').ok, true);
    });

    t.test('inventar párrafos tampoco pasa', () => {
        const original = 'que el título entre más lento por favor';
        const largo = `${original} ${'y además conviene agregar una transición elegante con partículas doradas. '.repeat(8)}`;
        t.eq(prompts.verificar(largo, original).ok, false);
    });

    t.test('perder una mención deja el texto original', () => {
        const original = 'El color de @[curso/manual.pdf] y el ritmo de siempre, con el fade de dos segundos';
        const r = prompts.verificar('El color del manual y el ritmo de siempre, con el fade de dos segundos', original);
        t.eq(r.ok, false);
        t.tiene(r.motivo, '@[curso/manual.pdf]');
    });

    t.test('un refinado honesto pasa', () => {
        const original = 'eh o sea que el título este entre más lento digamos con un fade de dos segundos';
        t.eq(prompts.verificar('Que el título entre más lento, con un fade de dos segundos.', original).ok, true);
    });

    t.grupo('Refinar: cómo se le pide');

    t.test('lo dictado y lo ya escrito viajan marcados y separados', () => {
        const pedido = prompts.pedidoRefinar({ texto: 'ya estaba', dictado: 'y ahora dije', origen: 'dictado' });
        t.tiene(pedido, 'YA ESTABA ESCRITO EN EL CAMPO');
        t.tiene(pedido, 'Y ACABA DE DICTAR');
        t.tiene(pedido, 'Fundilas en UNA nota');
    });

    t.test('lo tecleado se dice que es tecleado', () => {
        // El manual arranca diciendo que lo que llega lo transcribió Whisper
        // «sin puntuación confiable»; sobre un texto tecleado eso es una
        // invitación a reescribir lo que estaba bien.
        t.tiene(prompts.pedidoRefinar({ texto: 'a mano', origen: 'escrito' }), 'ESCRITO A MANO');
    });

    t.test('el manual dice que las menciones van tal cual', () => {
        t.tiene(prompts.SISTEMA_REFINAR, 'va TAL CUAL');
        t.tiene(prompts.SISTEMA_REFINAR, 'NO INVENTES NADA');
    });

    t.grupo('Preparar para Claude');

    t.test('los comentarios se le pasan con su id y su momento ya formateado', () => {
        const datos = {
            fps: 30,
            comentarios: [
                { id: 'c01', t: 83.4, texto: 'uno', estado: 'abierto', dibujo: 'dibujos/x.png' },
                { id: 'c02', t: 120, tHasta: 130, texto: 'dos', estado: 'abierto' },
                { id: 'c03', t: 5, texto: 'hecho', estado: 'resuelto' }
            ]
        };
        const texto = prompts.comentariosComoTexto(datos);
        t.tiene(texto, '(c01) 00:01:23:12');
        t.tiene(texto, 'tiene un dibujo');
        t.tiene(texto, '(c02) 00:02:00:00 → 00:02:10:00');
        t.noTiene(texto, 'hecho', 'lo resuelto no se vuelve a pedir');
    });

    t.test('el manual le pide citar los ids y no convertir tiempos', () => {
        t.tiene(prompts.SISTEMA_INSTRUCCION, 'CITÁ EL ID');
        t.tiene(prompts.SISTEMA_INSTRUCCION, 'No los conviertas');
    });
};
