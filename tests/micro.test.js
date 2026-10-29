'use strict';
/**
 * Cómo se lee el nombre del micrófono del sistema.
 *
 * Es lo único de `micro.js` que se puede probar sin ventana, y es justo la
 * parte que depende de un detalle de Chromium —el duplicado con el mismo
 * `groupId`, el prefijo traducido— que puede cambiar sin avisar.
 */

const path = require('path');

/** Una entrada de `enumerateDevices` con lo poco que mira el código. */
function entrada(deviceId, groupId, label) {
    return { kind: 'audioinput', deviceId, groupId, label };
}

// Lo que devuelve esta Mac con una webcam y dos cosas virtuales enchufadas.
const COMO_EN_LA_MAC = [
    entrada('default', 'g-interno', 'Default - MacBook Pro Microphone (Built-in)'),
    entrada('b008', 'g-obsbot', 'OBSBOT Meet 2 Microphone (3564:fefb)'),
    entrada('8ddd', 'g-interno', 'MacBook Pro Microphone (Built-in)')
];

module.exports = async function (t) {
    t.grupo('Micrófonos');

    const micro = await import(path.join(__dirname, '..', 'src', 'js', 'micro.js'));

    t.test('el del sistema se dice por su nombre, sin el prefijo ni el paréntesis', () => {
        t.eq(micro.nombreDelSistema(COMO_EN_LA_MAC), 'MacBook Pro Microphone');
    });

    t.test('sin la entrada gemela se corta el prefijo traducido', () => {
        // En otro idioma el prefijo no dice «Default», así que se corta por el
        // guión suelto y no por un texto conocido.
        const soloDefault = [entrada('default', 'g-interno', 'Predeterminado - Micrófono del MacBook Pro (Integrado)')];
        t.eq(micro.nombreDelSistema(soloDefault), 'Micrófono del MacBook Pro');
    });

    t.test('un nombre con guión no se come su propia primera palabra', () => {
        const conGuion = [
            entrada('default', 'g-usb', 'Default - Jabra - Evolve 65'),
            entrada('7f31', 'g-usb', 'Jabra - Evolve 65')
        ];
        t.eq(micro.nombreDelSistema(conGuion), 'Jabra - Evolve 65');
    });

    t.test('sin permiso no hay nombre que mostrar', () => {
        // macOS no da las etiquetas hasta el primer dictado: ahí la barra tiene
        // que caer al texto genérico en vez de inventar un nombre.
        t.eq(micro.nombreDelSistema([entrada('default', '', ''), entrada('8ddd', '', '')]), '');
    });

    t.test('sin entrada por defecto tampoco', () => {
        t.eq(micro.nombreDelSistema([entrada('8ddd', 'g-interno', 'MacBook Pro Microphone (Built-in)')]), '');
        t.eq(micro.nombreDelSistema([]), '');
    });
};
