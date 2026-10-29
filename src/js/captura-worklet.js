/**
 * captura-worklet.js — Saca el audio del micrófono del hilo de audio y lo manda
 * al de la ventana, ya convertido a enteros de 16 bits.
 *
 * Corre en el hilo de audio, que no se puede bloquear: acá no hay `fetch`, ni
 * `postMessage` por cada muestra, ni nada que pueda tardar. Se junta un pedazo
 * de medio segundo y se manda entero.
 *
 * Es un archivo aparte y no un `Blob` con el código adentro porque la política
 * de la ventana solo deja cargar scripts de la propia app (`script-src 'self'`),
 * y un worklet es un script.
 */

/** 8.000 muestras a 16 kHz son medio segundo: un `postMessage` cada 500 ms. */
const PEDAZO = 8000;

class Captura extends AudioWorkletProcessor {
    constructor() {
        super();
        this.buffer = new Int16Array(PEDAZO);
        this.cuantas = 0;
    }

    process(entradas) {
        const canal = entradas[0] && entradas[0][0];
        if (!canal) return true;

        for (let i = 0; i < canal.length; i++) {
            // De -1..1 a entero de 16 bits, con el recorte puesto: una muestra
            // pasada de 1 daría la vuelta y sonaría como un chasquido.
            const v = Math.max(-1, Math.min(1, canal[i]));
            this.buffer[this.cuantas++] = Math.round(v < 0 ? v * 32768 : v * 32767);
            if (this.cuantas === PEDAZO) {
                // Se manda una copia: el buffer sigue usándose acá y transferir
                // el original lo dejaría vacío en el próximo bloque.
                this.port.postMessage(this.buffer.slice(0));
                this.cuantas = 0;
            }
        }
        return true;
    }
}

registerProcessor('captura-dictado', Captura);
