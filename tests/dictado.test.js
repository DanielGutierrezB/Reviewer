'use strict';
/**
 * El dictado, lo que se puede probar sin micrófono y sin modelo: la compuerta
 * de volumen, la cola de audio que se junta mientras el modelo carga y que una
 * sesión cerrada no deje nada corriendo.
 *
 * Lo que NO se prueba acá es la transcripción: eso necesita el modelo de
 * 751 MB, que no está en una máquina de tests recién clonada. Lo que sí se
 * prueba es todo lo que pasa alrededor, que es donde estaban los errores.
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

    t.test('sin dictado abierto, un trozo no hace nada', () => {
        t.eq(dictado.trozo(Buffer.alloc(10)).ok, false);
    });

    t.test('sin dictado abierto no hay nada que leer', async () => {
        const r = await dictado.transcribir();
        t.eq(r.ok, false);
        t.eq(r.segundos, 0);
    });

    t.test('cada idioma de Ajustes tiene su locale entero', () => {
        // El modelo rechaza `es` suelto con «unsupported language»: el locale
        // completo no es cosmético, es lo único que acepta.
        for (const locale of Object.values(dictado.LOCALES)) {
            t.ok(/^[a-z]{2}-[A-Z]{2}$/.test(locale), locale);
        }
    });

    // Sin el modelo en el disco todo lo de abajo tiene que seguir siendo
    // información y no una excepción: en una Mac recién instalada el dictado no
    // está, y el resto de la app funciona igual.
    const puede = dictado.disponible();

    t.test('cuando falta el modelo se dice cuál falta y adónde ir', () => {
        if (puede.ok) {
            t.ok(puede.modelo.endsWith('.gguf'), puede.modelo);
            return;
        }
        t.eq(puede.falta, 'modelo-dictado');
        t.ok(/Diagn[óo]stico/.test(puede.motivo), puede.motivo);
    });

    t.test('sin modelo, empezar contesta que no se puede en vez de romper', () => {
        if (puede.ok) return;
        const r = dictado.empezar('es');
        t.eq(r.ok, false);
        t.eq(r.falta, 'modelo-dictado');
    });

    t.test('lo que se dice mientras el modelo carga se guarda, no se tira', async () => {
        if (!puede.ok) return;
        const abierto = dictado.empezar('es');
        t.eq(abierto.ok, true);
        // El micrófono empieza a mandar ANTES de que el modelo esté: si esto se
        // perdiera, la primera frase de cada dictado se comería sus palabras.
        const r = dictado.trozo(tono(0.5, 0.1));
        t.eq(r.ok, true);
        t.ok(Math.abs(r.segundos - 0.5) < 0.01, `${r.segundos} s guardados`);
        const cerrado = dictado.cerrar();
        t.ok(Math.abs(cerrado.segundos - 0.5) < 0.01);
        t.ok(cerrado.pico > dictado.RMS_MINIMO_DBFS, `pico en ${cerrado.pico.toFixed(1)} dBFS`);
        dictado.apagar();
    });

    t.test('cerrar sin haber abierto nada devuelve ceros y no rompe', () => {
        t.eq(dictado.cerrar().segundos, 0);
        t.eq(dictado.cerrar().pico, 0);
    });
};
