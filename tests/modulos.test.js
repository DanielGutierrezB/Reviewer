'use strict';
/**
 * Que todo cargue.
 *
 * Un `require` roto o un ciclo entre dos módulos del motor no se ve en ningún
 * otro test —cada uno carga solo lo suyo— y se descubre al abrir la app, que es
 * el peor momento.
 */

const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');

module.exports = async function (t) {
    t.grupo('Módulos');

    const delMotor = fs.readdirSync(path.join(RAIZ, 'engine'))
        .filter(n => n.endsWith('.js'))
        .sort();

    t.test('el motor entero carga', () => {
        for (const nombre of delMotor) {
            const modulo = require(path.join(RAIZ, 'engine', nombre));
            t.ok(modulo && typeof modulo === 'object', `${nombre} exporta algo`);
        }
    });

    t.test('la ventana entera carga', async () => {
        // Tres no se pueden cargar afuera de la ventana sin que eso diga nada:
        // el worklet corre en el hilo de audio y usa `AudioWorkletProcessor`, y
        // los otros dos son puntos de entrada —importarlos arranca una ventana
        // contra un DOM que acá no existe—.
        const SUELTOS = ['captura-worklet.js', 'app.js', 'pantalla-ventana.js'];
        const deLaVentana = fs.readdirSync(path.join(RAIZ, 'src', 'js'))
            .filter(n => n.endsWith('.js'))
            .filter(n => !SUELTOS.includes(n));
        for (const nombre of deLaVentana) {
            await import(path.join(RAIZ, 'src', 'js', nombre));
        }
    });

    // ─── El puente ────────────────────────────────────────────────────
    //
    // Los cuatro tests de acá abajo son lo único que puede hacer que repartir
    // los canales del proceso principal salga mal sin avisar. Un canal que la
    // ventana llama y nadie registró no falla al arrancar ni en ningún otro
    // test: falla el día que alguien aprieta ese botón, que puede ser meses
    // después, y se ve como un botón mudo.
    //
    // El proceso principal es `main.js` MÁS todo `main/*.js`, y por eso se leen
    // todos juntos: cuando los 56 canales vivían en un archivo alcanzaba con
    // mirar ese; ahora el que mueva un handler de un módulo a otro tiene que
    // poder hacerlo sin que estos tests le digan nada, y el que lo pierda en el
    // camino tiene que enterarse acá.

    /**
     * El CÓDIGO de un archivo: lo mismo pero sin comentarios.
     *
     * Hace falta porque estos módulos documentan sus propias reglas citando el
     * código del que hablan —«ningún módulo importa `require('../main')`»— y un
     * test que lee el archivo crudo cuenta esa frase como un import. Pasó con
     * la primera versión de este test, y la salida era un fallo que señalaba un
     * párrafo.
     */
    function codigoDe(texto) {
        return texto.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    }

    /** El código de `main.js` y el de cada `main/*.js`, con su nombre. */
    function delProcesoPrincipal() {
        const leer = (nombre, completo) => ({ nombre, texto: codigoDe(fs.readFileSync(completo, 'utf8')) });
        const archivos = [leer('main.js', path.join(RAIZ, 'main.js'))];
        for (const nombre of fs.readdirSync(path.join(RAIZ, 'main')).filter(n => n.endsWith('.js')).sort()) {
            archivos.push(leer(`main/${nombre}`, path.join(RAIZ, 'main', nombre)));
        }
        return archivos;
    }

    /** Todos los `ipcMain.handle` que hay, con en qué archivo está cada uno. */
    function handlers() {
        const encontrados = [];
        for (const { nombre, texto } of delProcesoPrincipal()) {
            for (const m of texto.matchAll(/ipcMain\.handle\('([^']+)'/g)) {
                encontrados.push({ canal: m[1], donde: nombre });
            }
        }
        return encontrados;
    }

    function delPreload() {
        return codigoDe(fs.readFileSync(path.join(RAIZ, 'preload.js'), 'utf8'));
    }

    t.test('el preload nombra canales que el main atiende', () => {
        const canales = [...delPreload().matchAll(/invoke\('([^']+)'/g)].map(m => m[1]);
        const atendidos = new Set(handlers().map(h => h.canal));
        t.ok(canales.length > 20, `son ${canales.length} canales`);
        for (const canal of new Set(canales)) {
            t.ok(atendidos.has(canal), `alguien atiende «${canal}»`);
        }
    });

    t.test('ningún canal está registrado dos veces', () => {
        // Esto no existía cuando todo estaba en un archivo porque no podía
        // pasar: se veía. Repartido sí puede —copiar un handler a su módulo
        // nuevo y olvidar borrar el viejo— y el síntoma es feo y tardío:
        // Electron tira «Attempted to register a second handler» al arrancar,
        // pero adentro de `whenReady`, con lo cual la app abre la ventana y
        // después no atiende nada de lo que venía abajo.
        const vistos = new Map();
        for (const { canal, donde } of handlers()) {
            t.ok(!vistos.has(canal), `«${canal}» solo en ${donde} (ya estaba en ${vistos.get(canal)})`);
            vistos.set(canal, donde);
        }
    });

    t.test('no hay handlers que nadie llame', () => {
        // La vuelta del primero, y es la que atrapa el error del que reparte:
        // mover un handler y borrarle sin querer la línea del preload deja el
        // canal vivo y sin puerta, y ningún otro test lo nota.
        const llamados = new Set([...delPreload().matchAll(/invoke\('([^']+)'/g)].map(m => m[1]));
        for (const { canal, donde } of handlers()) {
            t.ok(llamados.has(canal), `el preload llama a «${canal}» (${donde})`);
        }
    });

    t.test('los avisos que el main manda solos los escucha el preload', () => {
        // La otra mitad del puente: los canales que van al revés —`proxy-avance`,
        // los siete de la segunda pantalla— no se registran con `handle`, así
        // que el test de arriba no los ve. Un `mandar()` que se mudó a un
        // módulo y perdió su escuchador no rompe nada: simplemente la pantalla
        // deja de enterarse, que es el peor fallo posible porque parece que no
        // pasó nada.
        const mandados = new Set();
        for (const { texto } of delProcesoPrincipal()) {
            for (const m of texto.matchAll(/(?:mandar|webContents\.send)\('([^']+)'/g)) mandados.add(m[1]);
        }
        const escuchados = new Set([...delPreload().matchAll(/escuchar\('([^']+)'\)/g)].map(m => m[1]));
        t.ok(mandados.size > 3, `son ${mandados.size} avisos`);
        for (const canal of mandados) {
            t.ok(escuchados.has(canal), `el preload escucha «${canal}»`);
        }
    });

    t.test('ningún módulo de main/ importa a main.js ni a otro de main/', () => {
        // Es la regla que hace que `permitir()` —el único que amplía la lista
        // blanca del protocolo— viaje como dependencia explícita del
        // `registrar` y se pueda leer de un vistazo quién la recibe. Con un
        // `require` cruzado eso se vuelve invisible, y además arma el ciclo.
        for (const { nombre, texto } of delProcesoPrincipal()) {
            if (nombre === 'main.js') continue;
            for (const m of texto.matchAll(/require\('([^']+)'\)/g)) {
                const pedido = m[1];
                // `../engine/…` y los módulos de Node sí; `../main` —el
                // archivo de arriba— y `./loquesea` —un hermano— no.
                const prohibido = pedido === '../main' || pedido === '../main.js' || pedido.startsWith('./');
                t.ok(!prohibido, `${nombre} no importa «${pedido}»`);
            }
        }
    });

    t.test('lo que el escaneo averigua de una versión llega a la ventana', async () => {
        // `versionParaVentana` es una lista blanca, y una lista blanca pierde
        // campos sin avisar: agregar algo al escaneo y olvidarla deja a la
        // ventana leyendo `undefined`, que no rompe nada y se ve como un dato
        // que nunca se calculó. Pasó con la cuenta de comentarios.
        const temporal = require('./lib/temporal');
        const versiones = require('../engine/versiones');

        const dir = temporal.carpeta('lista-blanca');
        temporal.archivo(dir, 'Clase 01.mp4');
        const leido = await versiones.escanear(dir);
        const delEscaneo = Object.keys(leido.clases[0].versiones[0]);

        const fuente = fs.readFileSync(path.join(RAIZ, 'main', 'carpeta.js'), 'utf8');
        const cuerpo = codigoDe(fuente).match(/function versionParaVentana[\s\S]*?return \{([\s\S]*?)\n {4}\};/);
        t.ok(cuerpo, 'se encontró la lista blanca');
        const pasan = new Set([...cuerpo[1].matchAll(/^\s*(\w+):/gm)].map(m => m[1]));

        // `explicita` —si el nombre del archivo decía «v2» o si es la v1 por
        // no decir nada— es la única que se queda del lado del motor: la
        // ventana muestra el número, no de dónde salió.
        for (const campo of delEscaneo) {
            if (campo === 'explicita') continue;
            t.ok(pasan.has(campo), `«${campo}» cruza el puente`);
        }
    });

    t.test('el HTML carga los tres CSS y el módulo de arranque', () => {
        const html = fs.readFileSync(path.join(RAIZ, 'src', 'index.html'), 'utf8');
        for (const hoja of ['css/style.css', 'css/reproductor.css', 'css/comentarios.css']) {
            t.tiene(html, hoja);
        }
        t.tiene(html, 'js/app.js');
    });

    t.test('la política de las dos ventanas deja pasar el protocolo y nada más', () => {
        // Las DOS: la segunda pantalla abre el mismo `reviewer://` con el mismo
        // preload y hasta ahora nada comprobaba su cabecera. Que esté bien
        // puesta no es suerte, pero sin test tampoco era una garantía.
        for (const nombre of ['index.html', 'pantalla.html']) {
            const html = fs.readFileSync(path.join(RAIZ, 'src', nombre), 'utf8');
            t.tiene(html, "default-src 'none'", `${nombre} cierra todo por defecto`);
            t.tiene(html, 'media-src reviewer:', `${nombre} deja pasar el protocolo`);
            t.noTiene(html, "script-src 'unsafe-inline'", `${nombre} sin script inline`);
        }
    });

    t.test('la versión del package y la del version.json son la misma', () => {
        const pkg = JSON.parse(fs.readFileSync(path.join(RAIZ, 'package.json'), 'utf8'));
        const version = JSON.parse(fs.readFileSync(path.join(RAIZ, 'version.json'), 'utf8'));
        t.eq(pkg.version, version.version);
    });
};
