'use strict';
/**
 * El dictado, lo que se puede probar sin micrófono: el WAV que se arma, la
 * compuerta de silencio y la red contra lo que Whisper inventa.
 */

const dictado = require('../engine/dictado');

/** PCM de 16 bits con una onda de la amplitud que se pida. */
function tono(segundos, amplitud) {
    const muestras = Math.round(dictado.RATE * segundos);
    const buffer = Buffer.alloc(muestras * 2);
    for (let i = 0; i < muestras; i++) {
        buffer.writeInt16LE(Math.round(Math.sin((i / dictado.RATE) * 2 * Math.PI * 220) * 32767 * amplitud), i * 2);
    }
    return buffer;
}

module.exports = function (t) {
    t.grupo('Dictado');

    t.test('el WAV sale con la cabecera que whisper-server espera', () => {
        const pcm = tono(0.1, 0.5);
        const archivo = dictado.wav(pcm);
        t.eq(archivo.slice(0, 4).toString(), 'RIFF');
        t.eq(archivo.slice(8, 12).toString(), 'WAVE');
        t.eq(archivo.readUInt16LE(22), 1, 'mono');
        t.eq(archivo.readUInt32LE(24), 16000, '16 kHz: es lo que Whisper quiere');
        t.eq(archivo.readUInt16LE(34), 16, '16 bits');
        t.eq(archivo.length, pcm.length + 44);
    });

    t.test('el volumen separa la sala callada del habla', () => {
        // Los números salieron de medir: la sala callada está entre −44 y −37
        // dBFS y el habla llega en −21.
        const callado = dictado.volumen(tono(0.5, 0.004));
        const hablando = dictado.volumen(tono(0.5, 0.1));
        t.ok(callado < dictado.RMS_MINIMO_DBFS, `silencio en ${callado.toFixed(1)} dBFS`);
        t.ok(hablando > dictado.RMS_MINIMO_DBFS, `habla en ${hablando.toFixed(1)} dBFS`);
    });

    t.test('un buffer vacío no rompe el cálculo', () => {
        t.eq(dictado.volumen(Buffer.alloc(0)), -Infinity);
    });

    t.test('las frases que Whisper inventa con el silencio se tiran', () => {
        for (const frase of ['¡Suscríbete!', 'Gracias por ver el video', 'Subtítulos realizados por la comunidad', '  ']) {
            t.eq(dictado.inventada(frase), true, frase);
        }
    });

    t.test('una palabra repetida cuatro veces también', () => {
        t.eq(dictado.inventada('las las las las las'), true);
    });

    t.test('un dictado de verdad NO se tira', () => {
        t.eq(dictado.inventada('que el título entre más lento, con un fade de dos segundos'), false);
        t.eq(dictado.inventada('gracias por el ajuste del color, queda mejor así'), false, 'que empiece con gracias no la hace inventada');
    });

    t.test('sin dictado abierto, un trozo no hace nada', () => {
        t.eq(dictado.trozo(Buffer.alloc(10)).ok, false);
    });
};
