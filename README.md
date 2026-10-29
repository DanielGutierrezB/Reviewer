# Reviewer

Una interfaz de feedback para Claude.

Claude edita y deja los renders en una carpeta. Reviewer los abre como un
reproductor con un panel de comentarios al lado, y todo lo que se comenta —el
texto, el momento exacto, el cuadro, el dibujo encima del cuadro— sale escrito
como archivos que Claude puede leer. Cuando el review termina, lo que se le pasa
a la sesión que ya está abierta es una ruta.

No es Frame.io con menos cosas. Frame.io le habla a una persona que después
traduce; acá del otro lado hay un modelo, y eso cambia qué tiene que decir el
archivo: las rutas son absolutas, los tiempos van de tres formas distintas, y
cada imagen viene con la instrucción de abrirla **antes** de tocar la edición.

---

## Cómo se usa

1. **Elegís la carpeta** donde Claude deja los renders. Pueden estar todos
   sueltos; el nombre base es lo que agrupa.
2. **Reviewer junta las versiones.** `Clase 03 - Hooks.mp4`,
   `Clase 03 - Hooks v2.mp4` y `Clase 03 - Hooks_v3.mp4` son una sola clase con
   tres versiones. Se abre la última y se puede volver a cualquier anterior.
3. **Comentás.** Pausás donde sea y apretás `M`, o marcás un tramo con `I` y
   `⇧O`, o directamente dibujás encima del cuadro: el primer trazo abre el
   comentario solo. El comentario se escribe en el panel de la derecha, nunca
   encima del video, para que se pueda dibujar mientras se escribe.
4. **El archivo se escribe mientras tanto.** No hay botón de exportar.
5. **Copiás la ruta** del `feedback.md` y se la pegás a Claude.

### Teclas

| | |
|---|---|
| `espacio` | andar o pausar, siempre a 1× |
| `←` `→` | un cuadro; con `Shift`, diez |
| `J` `L` | más lento y más rápido, de a 0.25× |
| `K` | pausar y volver a 1× |
| `I` | entrada: abrir un comentario acá (`M` y `C` hacen lo mismo) |
| `O` | salida: cerrar acá el último comentario que quedó atrás |
| `⇧I` `⇧O` | entrada y salida de un tramo nuevo |
| `⌘Z` `⇧⌘Z` | deshacer y rehacer |
| `⌘↵` | guardar el comentario que se está escribiendo |
| `⌘S` | plegar o traer la lista de clases (la columna de la izquierda) |
| `⌘E` | plegar o traer los comentarios (la columna de la derecha) |
| `Esc` | cerrar lo que esté abierto |

`J` y `L` mueven la velocidad de a 0.25×, entre 0.25× y 3×, y nunca dan marcha
atrás: desde 1.75×, una `J` deja 1.5×. Es una escalera fina y no la de un NLE
—1×, 2×, 4×— porque acá no se busca, se mira: a 1.5× se pasa por lo que ya está
bien sin perder de qué habla, y a 0.5× se ve dónde entra exactamente una
transición. Doblar de golpe se saltea justo ese rango.

El número aparece sobre la imagen cada vez que cambia y queda en los mandos
mientras no sea 1×; se puede apretar para volver. Pausar siempre devuelve a 1×:
una velocidad rara que sobrevive a la pausa es una velocidad que uno se olvida
de que puso.

`I` y `O` son la entrada y la salida de siempre, pero de un **comentario** y no
de un tramo suelto. Sirven para mirar una pasada entera sin frenar: `I` donde
empieza el problema —se abre el comentario y ahí se escribe—, se sigue mirando,
y `O` donde termina, que convierte ese comentario de instante en tramo. `O`
busca el último comentario que todavía sea un instante y haya quedado atrás del
cabezal; uno que ya es un tramo no se vuelve a tocar, porque cerrarlo fue algo
que alguien hizo a propósito.

Marcar un tramo *antes* de comentarlo sigue existiendo, con `Shift`: `⇧I` y
`⇧O`. Que el par con `Shift` haga el mismo gesto en otro orden es lo que deja
acordarse de los cuatro sabiendo dos.

### Deshacer

`⌘Z` desanda casi todo: dejar un comentario, borrarlo, editarle el texto,
resolverlo, cerrarlo con `O`, mejorarlo con el modelo. Mientras hay trazos sin
guardar en la pizarra, `⌘Z` saca el último trazo primero — es lo que uno acaba
de hacer.

Borrar no pregunta nada, justamente porque vuelve entero: el cuadro y el dibujo
esperan en una `.papelera` adentro de la carpeta de la versión y regresan con
el comentario. Esa papelera se vacía al cambiar de render, no al cerrar la app:
si Reviewer se cae, lo borrado todavía se puede rescatar a mano.

El historial es de la versión abierta. Cambiar de render lo reinicia.

### Ver la imagen grande: plegar los costados

Revisar tiene dos momentos y la pantalla de tres columnas sirve para uno solo.
Mientras se escribe el feedback hace falta todo; la primera pasada —ver si el
corte entra bien, si el título se lee— es mirar, y ahí las dos columnas se
llevan 608 px de ancho para mostrar cosas que en ese momento no se usan.

`⌘S` pliega las clases y `⌘E` los comentarios, cada una por su lado, y la misma
tecla las trae de vuelta. Cómo quedaron se guarda en `ajustes.json`: el que
revisa con los dos lados cerrados los encuentra cerrados mañana.

Son teclas con `⌘` y no letras sueltas porque las letras ya están todas tomadas
por el reproductor, y porque esto tiene que poder hacerse **mientras se escribe
un comentario**, que es justo cuando una letra suelta no puede entrar. `⌘S` es
«guardar» en casi toda app; acá no hay guardar —el `feedback.md` se reescribe en
cada cambio— así que la tecla estaba libre y es la que la mano busca cuando
quiere dejar la pantalla limpia.

**Siempre se puede volver sin saber el atajo.** Una columna plegada deja una
franja de 16 px que es un botón de alto completo, y su `title` dice la tecla;
además los dos galones de la cabecera del visor están siempre a la vista y
pliegan en los dos sentidos. Dos paneles cerrados sin ninguna pista en pantalla
sería una app de la que no se sale más que adivinando.

El canvas de dibujo se vuelve a medir solo cada vez que la imagen cambia de
tamaño, que es lo delicado de todo esto: los trazos se pintan sobre un canvas
cuyos píxeles hay que escribir a mano, y plegar una columna cambia el tamaño de
la imagen sin que la ventana cambie de tamaño, así que el `resize` que
`dibujo.js` escucha no llega nunca. Un trazo hecho antes de plegar **no se
corre** —se guarda de 0 a 1 y el lienzo tiene la proporción del render— pero sin
remedir queda agrandado y blando sobre una imagen nítida, que se lee como un
trazo mal puesto. Lo mira un `ResizeObserver` sobre el lienzo; el porqué entero,
con lo que se descartó, está en `src/js/paneles.js`.

#### El redactor compacto

Con la columna de la derecha plegada, abrir un comentario —`I`, `M`, `C`, el
primer trazo del dibujo o el botón **Comentar**— abre la caja de texto en una
franja **encima de la línea de tiempo**, para comentar rápido sin perder la
imagen en grande. Con la columna abierta todo sigue como siempre, en el panel.

**No es un segundo redactor: es el mismo.** El nodo se muda de padre y lo
acuesta el CSS, así que lo escrito, las casillas, los archivos pegados y la
miniatura del cuadro viajan con él. Plegar el panel a mitad de una frase no
pierde la frase ni el cursor. Dos redactores capaces de tener texto distinto
para el mismo comentario sería el peor resultado posible: el que pierde la
carrera se guardaría sin que nadie haya escrito eso.

Lo único que el modo compacto esconde es **texto de ayuda** —las dos notas de la
caja de archivos, el renglón del `⌘↵` y el botón «Cancelar», que es el mismo
gesto que la ✕ de la cabecera a dos centímetros—. Siguen estando el dictado,
«Mejorar redacción», «Texto original», la miniatura del cuadro con su timecode,
las dos casillas, «Elegir…», la tira numerada, soltar y pegar archivos, y
«Comentar». Más compacto no puede querer decir «te faltan la mitad de las
funciones y nadie te avisó».

### Tableta y Sidecar

El canvas toma la presión del lápiz, así que una Wacom o un Apple Pencil dan
trazo grueso donde se apretó. En cuanto aparece un lápiz, el dedo deja de
dibujar: es el rechazo de palma, y sin él la mano apoyada deja garabatos.

Con otro monitor conectado —o con Sidecar prendido— aparece el control de
**segunda pantalla** en la barra de arriba, al lado del micrófono y con el mismo
gesto: un punto que dice si está prendida, un desplegable con a cuál se manda y
un botón de volver a buscar. El render va a esa pantalla a tamaño completo y en
silencio, y los mandos se quedan en la Mac. Se puede dibujar ahí con el Pencil:
el trazo entra a la misma pizarra y al mismo comentario que si se hubiera hecho
con el mouse.

### Elegir a qué pantalla

El desplegable **es** el interruptor: «Apagada» primero y las pantallas después.
Elegir una manda el render ahí; elegir «Apagada» lo trae de vuelta; elegir otra
mientras está prendida **muda** la ventana sin recargar el video. Un interruptor
aparte más un selector de destino dejaba un estado que no se puede leer de un
vistazo —elegida pero apagada— y dos controles donde alcanza uno.

Las pantallas se llaman como las llama macOS, que alcanza para reconocerlas:
`Odyssey G81SF (2560 × 1440)`, `J560T09 (1000 × 1600)`. La única que se renombra
es la del iPad: macOS la reporta como «Sidecar Display (AirPlay)» y en el
desplegable dice **`Sidecar · iPad (1194 × 834)`**, porque es el caso de uso de
toda esta función y nadie llama a su iPad así. No hay otra forma de reconocerla:
`touchSupport` y `accelerometerSupport` llegan en `unknown` para todos los
monitores, también para el de Sidecar, e `internal` llega en `false` hasta para
la pantalla del propio Mac. El nombre es el único campo que distingue.

**La pantalla donde está Reviewer no se ofrece.** Mandarle el render es un
callejón sin salida: la ventana del render va sin marco y por encima de todo, así
que taparía justo el desplegable que la apaga. No ofrecerla sale más barato que
advertirlo.

**La elección se recuerda** en `ajustes.json`, por nombre y no por el id del
display —el id que da macOS cambia al reconectar y mañana señala a otro monitor—.
Lo que no se recuerda es si estaba prendida: que la app abra sola una ventana sin
marco encima de otro monitor al arrancar es lo que nadie pidió. Si esa pantalla
ya no está, el control cae en la primera que haya en vez de dar un error.

**Y las pantallas van y vienen.** Sidecar se prende, el iPad se duerme, el
monitor se desenchufa: el desplegable se actualiza solo con `display-added`,
`display-removed` y `display-metrics-changed`, sin que haya que apretar nada —el
botón de volver a buscar queda para cuando el evento no llega, que con AirPlay
pasa—. Si se va la pantalla donde estaba el render, la ventana se cierra y se
dice por qué. Dejarla viva era lo peor que podía pasar: macOS no la destruye, le
reacomoda los bounds dentro de la pantalla que queda, y el render aparece de
golpe tapando la ventana de trabajo sin nada de dónde agarrarlo.

### El mando del iPad

La segunda pantalla no es solo para mirar: es un mando completo, para no tener
que volver al teclado y el mouse con el Pencil en la mano. Son **dos paletas**,
una en cada franja negra.

**Abajo, lo que cambia el trazo.** Las cuatro formas —**Trazo**, **Flecha**,
**Caja**, **Círculo**—, las cuatro pastillas de color y **Deshacer** / **Rehacer**.
Una flecha dibujada en el iPad llega a la Mac *como* flecha: lo que viaja es el
mismo objeto que produce el mouse, con su tipo y su presión.

**Arriba, lo que cambia el tiempo y el comentario.** **Cuadro** ◁ , **Andar** /
**Pausar**, **Cuadro** ▷ , **Comentar**, **Dictar** y **Cerrar**.

Las dos listas —formas y colores— se arman con las mismas que usa la barra de la
Mac. Agregar una quinta forma allá la hace aparecer acá sin tocar nada.

**Todo el estado es uno solo para las dos pantallas.** Tocar Flecha o el verde
en el iPad mueve también la barra de la Mac, y al revés. Lo contrario —un estado
por pantalla— deja el único caso que no se puede diagnosticar: la Mac diciendo
una cosa, el Pencil dibujando otra, y nada a la vista que explique cuál manda.

**El mando no reimplementa nada.** Cada tecla termina en el mismo gancho que la
tecla del teclado: **Comentar** es la `M`, **Cerrar** es la `O` —le pone la
salida al último comentario que quedó atrás, y si hay uno abierto lo convierte en
tramo—, **Cuadro** es la flecha. Eso incluye dónde se abre el redactor, que
depende de si el panel derecho está colapsado: lo decide `app.js`, igual que
siempre.

**Dictar abre el comentario y prende el micrófono en un solo toque**, porque es
un solo gesto: señalar algo con el lápiz mientras se explica en voz alta. Si ya
hay un comentario abierto no lo vuelve a abrir —lo reanclaría a otro cuadro sin
decir nada— y **el trazo que se dibuje mientras dicta queda adjunto a ese mismo
comentario**.

**Que está grabando se ve en el iPad y no solo en la Mac.** Un marco rojo
pulsante en el borde de la ventana, la tecla en rojo con el ícono de *rec* y los
segundos de rótulo, y el estado del micrófono escrito al lado —«Cargando el
modelo de voz…», «Escuchando… 12 s», «No se pudo abrir el micrófono»—. El aviso
en rojo se ve incluso cuando *no* está grabando, que es el caso que importa: sin
eso, apretar Dictar y que falle el micrófono se veía como que no pasó nada.

**Deshacer es el del dibujo, nunca el de los comentarios.** En la Mac, `⌘Z` con
la pizarra limpia sigue desandando comentarios ya guardados; desde el iPad eso
no pasa, porque el panel no está a la vista y un toque de más no puede borrar
algo que no se ve. La tecla se apaga cuando no hay nada que deshacer.

**Dónde aparecen depende del render, y nunca encima de la imagen.** Son tres
intentos, en orden: cada paleta en su franja (en un 16:9, una arriba y otra
abajo); las dos en columna y una al lado de la otra en la franja de la izquierda
(en un 9:16, que es la «magic bar» en columna —la izquierda y no la derecha
porque la mano que dibuja viene de la derecha y taparía justo las teclas que se
van a mirar—); y recién si no sobra negro de ningún lado, encima del video y
traslúcidas. Mientras se traza, las dos bajan al 22 % de opacidad y dejan de
recibir toques: así la palma apoyada al lado del lápiz no cambia de herramienta
—ni arranca el video— a mitad de un trazo, y la silueta sigue diciendo dónde
estaban.

Lo que **no** se hace es encogerle el video para dejarle un carril fijo a la
izquierda, que sería la forma de tener la columna siempre: un render 16:9 en el
iPad pasaría de 1194 px de ancho a unos 1060, un 11 % menos de imagen para
siempre, en la pantalla cuyo único trabajo es mostrarla grande.

El tamaño de las teclas sale de una cuenta medida en el iPad, no del gusto: la
ventana del render queda de 1194 × 804 y no de 834, porque macOS no deja que una
ventana sin marco se meta abajo de la barra de menú y la reubica sola. Con eso,
un render 16:9 deja franjas de 66 px y cada paleta mide 52 de alto: entran con
7 px de aire de cada lado. Las teclas son de 62 × 44, que es el mínimo que un
dedo acierta. Cada píxel que crezcan las empuja encima de la imagen. Y son dos
paletas justamente por eso: las dieciséis teclas en una sola fila pasan de los
mil píxeles de ancho y se leen como un teclado sin orden.

**La pista de color se mudó.** Antes el color teñía el borde de la tecla de forma
elegida, porque era la única forma de saber con qué color iba a salir el trazo.
Ahora que los colores están en el iPad, eso repetía lo que ya dice la pastilla
marcada: el color pasó a pintar **el dibujo** de la tecla elegida. Una flecha
roja en la tecla quiere decir que el próximo trazo es una flecha roja.

La barra lateral de Sidecar **no** tapa la paleta en vertical: se verificó con el
iPad conectado capturando su pantalla, y el contenido llega al borde. Tampoco se
puede detectar desde la app —el `workArea` del display de Sidecar solo descuenta
la barra de menú—, así que si alguien la prende desde los ajustes de Sidecar y le
molesta, la salida es apagarla ahí.

La geometría de las formas no está escrita dos veces. Vive en `src/js/trazo.js`,
que comparten las dos pizarras y se prueba con `node tests/run.js trazo`: dos
copias de cómo nace una flecha se desincronizan, y el síntoma sería el peor de
todos —el mismo gesto da una forma en la Mac y nada en el iPad—.

---

## Qué deja en el disco

La regla que manda sobre todas: **nada se crea hasta que haya un comentario de
verdad**. Abrir una carpeta, mirar los cuatro renders y cerrar no deja ni un
archivo. Si el último comentario se borra, la carpeta se va con él.

```
Renders de Claude/
├── Clase 03 - Hooks v2.mp4
├── Clase 03 - Hooks v2/            ← se crea con el primer comentario
│   ├── feedback.md                 ← lo que se le pasa a Claude
│   ├── comentarios.json            ← lo que Reviewer vuelve a leer
│   ├── frames/c01-00h01m23s10f.png ← el cuadro, sacado del original
│   ├── dibujos/c01-00h01m23s10f.png← el cuadro con el dibujo encima
│   └── adjuntos/c01-logo-final.png ← lo que el editor le colgó a ese comentario
├── Clase 03 - Hooks v3.mp4
└── Reviewer/
    ├── comentario-general.md       ← lo que vale para todas las clases
    └── _referencias/               ← lo que se adjunta a ese comentario
```

Los dos archivos de cada versión dicen lo mismo con dos intenciones distintas.
El `.md` es para que lo lea Claude: rutas absolutas, tiempos escritos, nada que
haya que interpretar. El `.json` es la fuente de verdad que Reviewer vuelve a
abrir, y ahí las rutas son **relativas**, para que la carpeta entera se pueda
mover o mandar sin que se rompa.

### Las dos alturas del feedback

Igual que en HyperPremiere: hay cosas que valen para el curso entero y cosas que
valen para este video. El comentario general vive una sola vez en
`Reviewer/comentario-general.md` y se **copia adentro de cada `feedback.md`**,
para que Claude no tenga que abrir dos archivos. Cuando cambia, todos los
feedback de la carpeta se reescriben solos.

La precedencia está escrita adentro del archivo, no sobreentendida: lo general es
la base, y donde los dos se contradigan manda el del video. No es una invitación
a promediar.

### Adjuntarle archivos a un comentario

Un comentario puede llevar archivos colgados: una captura de otra pieza, el logo
que va en el video, la pista de música, el texto corregido. Se agregan de tres
maneras, y las tres hacen lo mismo:

- **⌘V** adentro del campo de texto pega una imagen del portapapeles. La
  miniatura aparece al instante. Un ⌘V con texto adentro sigue pegando el texto.
- **Arrastrar** archivos sobre el redactor, sobre una tarjeta ya guardada o
  sobre el panel. Si se sueltan en el panel con el redactor cerrado, se abre uno
  en el cabezal.
- El botón **Elegir…**, que abre el diálogo del sistema.

Vale cualquier tipo de archivo. De los que no son imagen se muestra un icono con
la extensión y el nombre, en vez de una miniatura rota.

#### Para mirar o para usar

De cada adjunto hay que decir para qué sirve, y es lo único de esta pantalla que
no conviene dejar en el valor que venga:

| Lo que se elige | Lo que Claude lee |
| --- | --- |
| **De referencia — para mirar** | `SOLO DE REFERENCIA, para mirar`. Que mire el archivo y haga algo en esa línea. **No** entra al video. |
| **Tal cual — para usar** | `PARA USAR TAL CUAL, es el material`. Ese archivo mismo va adentro de la pieza: no se rehace, no se imita, no se busca uno parecido. |

Entra como **de referencia** y hay que cambiarlo a mano para que sea material.
Es a propósito: los dos errores no cuestan lo mismo. Tratar un insumo como
referencia da un render donde Claude rehízo algo parecido al logo —se ve, se
dice, se arregla en una vuelta—. Tratar una referencia como insumo da un render
con el logo de otro adentro, y eso no se ve mirándolo: se ve cuando ya salió.

Los dos rótulos se escriben una sola vez, en `engine/adjuntos.js`, y de ahí
salen tanto el selector que ve el editor como la frase que va al `feedback.md`.
Dos copias de ese texto es cómo se consigue que el editor elija una cosa y
Claude lea otra.

#### Qué pasa en el disco

Los archivos se **copian** a `adjuntos/` dentro de la carpeta de la versión; no
se referencian donde estaban, porque la carpeta tiene que poder mandarse por
Drive y abrirse en otra Mac. El nombre en disco lleva adelante el id del
comentario y va pasado por el mismo `slug` que los PNG, así que
`Paleta Otoño 2024.PNG` adjuntada a `c03` queda como
`adjuntos/c03-paleta-otono-2024.png`. Dos archivos que se llamen igual no se
pisan. El nombre que escribió el editor no se pierde: se guarda en el JSON y es
el que lee Claude.

Se pueden agregar y quitar adjuntos de un comentario **ya guardado**, con el 📎
y el ✕ de la tarjeta. Como todo lo demás, pasa por el historial: quitar un
adjunto lo manda a `.papelera` y `⌘Z` lo trae de vuelta con su contenido, igual
que los cuadros. Mientras se está redactando, en cambio, los archivos viven en
la memoria de la ventana: cancelar el redactor no deja nada escrito.

**Esto no son las referencias del curso.** Las de `Reviewer/_referencias/` valen
para las treinta clases y se citan dentro del texto con una mención
`@[curso/logo.svg]`; estas pertenecen a un comentario, viven con él y mueren con
él. La decisión completa, con lo que se evaluó y se descartó, está en la
cabecera de `engine/adjuntos.js`.

#### Numerarlos y nombrarlos desde el texto

Cada archivo de un comentario —el cuadro, el dibujo y cada adjunto— lleva un
**número** en la esquina de su miniatura, empezando por el 1 en cada tarjeta.
El número sirve para señalarlo adentro de la frase:

- **Tocando la miniatura** se escribe la referencia donde está el cursor. Si el
  campo había perdido el foco, va donde estaba el cursor la última vez; si
  nunca se tocó, al final, nunca antes de la primera palabra.
- **Escribiendo `@`** se abre un menú con los archivos de ese comentario. `@2`
  y Enter elige el segundo: se puede filtrar por número o por nombre, y el
  filtro ignora acentos (`otono` encuentra «Paleta Otoño.png»).

En el campo la referencia se ve corta —`@2`— y en el `feedback.md` llega
resuelta a algo que no se puede malinterpretar: el nombre del archivo y para
qué sirve, con la ruta absoluta en la lista de abajo. El número no llega nunca
al markdown.

**El número no se guarda.** Lo que queda escrito en el comentario es
`@[adjunto/paleta.png]`, el nombre; el número se calcula al pintar. Por eso
borrar un adjunto del medio corre los badges de los que siguen y los chips del
texto se actualizan solos, sin que se reescriba un solo comentario. Si se
guardara el número, borrar un archivo haría que el comentario pasara a hablar
de otro **sin que nada fallara**, y se vería recién en el render siguiente.

Si se borra el archivo que el texto nombraba, la mención queda **colgada**: se
pinta en ámbar y muestra el nombre en vez de un número, y el `feedback.md` dice
que esa referencia ya no está adjunta en vez de callarse.

### Las versiones

Cada versión tiene sus propios comentarios. La v3 arranca limpia; los de la v2
siguen estando y se ven cambiando de versión. El `feedback.md` de la v3 lleva
solo lo de la v3, que es lo que hace que se pueda pasar sin aclarar nada.

Un comentario está **abierto** o **resuelto**. Lo resuelto sigue en el archivo —
sirve de historia— pero dice en su encabezado que no hay nada que hacer, y no
entra en el resumen que se le prepara a Claude.

### Los tiempos

Cada momento se escribe de tres formas, porque del otro lado puede haber
HyperFrames, Remotion o Premiere y cada uno cuenta distinto:

```
00:01:23:10 · 83.440 s · cuadro 2500 @ 29.97
```

El timecode es *non-drop*: a 29.97 el campo de cuadros se divide por 30, así que
se atrasa del reloj de pared. Es lo que hace cualquier NLE y es lo que hay que
poder pegar en uno.

---

## Lo que lo hace andar

**Cualquier códec.** Chromium no abre ProRes, DNxHD, HEVC ni nada de 10 bits: no
da error, se queda en negro. Cuando el render es uno de esos, Reviewer arma una
copia H.264 con ffmpeg y reproduce esa, con la barra de progreso a la vista. La
copia va al caché de la app —`~/Library/Caches/Reviewer`— y **nunca** al lado del
render: la carpeta del editor es lo que esta app promete no ensuciar. Los cuadros
que se le mandan a Claude salen siempre del original.

**El LLM local.** El botón ✨ reescribe un comentario; "Mejorar todos" hace la
lista entera. Se configura en Ajustes contra Ollama o contra cualquier cosa que
hable OpenAI (LM Studio, llama.cpp, lo que sea): URL y modelo. Por esos dos
caminos no sale nada de la máquina; hay un tercero que sí, y es el de acá abajo.

Hay una red entre el modelo y el campo de texto. Si contesta en vez de
reescribir, si se come la mitad de lo que se pidió o si pierde una referencia, el
texto original se queda como estaba y se dice por qué. El botón "Texto original"
está siempre, por si el refinado quedó peor.

### Mejorar la redacción con la cuenta de Claude

El tercer transporte de Ajustes, al lado de Ollama y del servidor compatible con
OpenAI. Es para cuando el modelo local tarda: Haiku contesta en un par de
segundos y no hay que tener nada levantado.

**No guarda ninguna credencial, y es la decisión de diseño más importante de
esta función.** La sesión la tiene el CLI de `claude`, que ya está instalado y
autenticado en la máquina de quien usa esto —esta app existe para hablarle a
Claude—. Reviewer lo invoca como subproceso y le lee la respuesta. Nunca ve un
token: no hay ninguno en `ajustes.json`, ninguno en el Llavero y ninguno en el
registro. El que renueva la sesión cuando vence también es el CLI, y eso está
comprobado: una llamada se cayó con «OAuth access token has expired» y la
siguiente, sin que nadie hiciera nada, anduvo.

La alternativa era un OAuth propio —o guardar el `sk-ant-oat…` que sale de
`claude setup-token`, que es lo que hace HyperPremiere en su panel de Premiere—.
Allá tiene sentido: el panel corre adentro de Premiere, en la máquina de un
editor que no tiene por qué abrir nunca una terminal. Acá no, y el precio de esa
comodidad sería custodiar un secreto que hoy no existe.

**Iniciar y cerrar sesión.** Iniciar es un comando, una sola vez:

```bash
claude auth login
```

El panel de Ajustes se da cuenta solo y muestra con qué cuenta está conectado y
con qué plan. «Cerrar sesión» corre `claude auth logout`, y lo avisa antes:
cierra la sesión de todo el CLI, también la de la terminal.

**Los modelos** son `haiku` (el de fábrica), `sonnet` y `opus`. Son los alias del
CLI, no versiones fijas: cuál es «el último Haiku» lo decide la versión de
`claude` que tenga instalada el editor, así que el día que Anthropic saque otro
aparece solo, sin sacar una versión de Reviewer. El CLI no tiene un comando que
liste modelos, y una lista escrita acá adentro envejecería sola.

**Qué sale de la máquina.** El texto de los comentarios, a Anthropic, para que lo
reescriba. Con Ollama no sale nada, y la diferencia la dice la pantalla de
Ajustes cada vez que se abre, no una sola vez al elegir la opción: es un cambio
de naturaleza y tiene que poder verse al decidir.

**Cuando falla, dice cuál de las cuatro cosas falló**, porque el arreglo de cada
una es distinto: la sesión no está activa (`claude auth login`), la cuenta llegó
al límite de uso (esperar, o volver a Ollama mientras tanto), el modelo no existe
(elegir otro) o no hay internet (Ollama no lo necesita). Y si el CLI no está
instalado, la app sigue andando entera: el botón de mejorar explica qué falta y
el comentario se queda tal como el editor lo escribió. Mejorar la redacción es un
extra, no el camino principal.

Para una instalación de `claude` en un lugar raro está la variable
`REVIEWER_CLAUDE_BIN`, que también es con la que los tests apuntan a un CLI de
mentira: nada de lo que se prueba toca la red ni gasta del plan de nadie.

**"Preparar para Claude"** junta todos los comentarios abiertos en una sola
instrucción y la pone arriba de todo en el `feedback.md`, citando el id de cada
uno.

**Dictado.** El micrófono transcribe en vivo contra un `whisper-server` que queda
prendido entre dictados, y al soltar el botón el texto pasa por el refinado. Todo
en esta Mac.

**Referencias.** Un `@[curso/manual-de-marca.pdf]` adentro de un comentario se
resuelve solo al escribir el archivo, y en el `feedback.md` aparece con su ruta
absoluta. Si el archivo ya no está, el feedback lo **dice** en vez de borrar la
mención calladamente.

---

## Desarrollo

```bash
npm install
npm start              # abre la app
npm test               # 141 tests, sin red y sin abrir la app
npm run atajo          # deja "Reviewer (Dev).app" en el Escritorio y en el Dock
npm run icono          # rehace build/icon.icns desde src/js/marca.js
npm run binarios       # mete ffmpeg, ffprobe, whisper-server y el modelo en bin/mac
npm run build          # arma los dos .pkg
npm run publicar       # sube el .pkg de actualización como release
```

`npm run atajo` no empaqueta nada: el `.app` que deja es una cáscara que abre el
código de esta carpeta tal como está, sin compilar y sin firmar. Si el repo se
mueve, el atajo lo dice en vez de abrir otra copia. Lo que no arranque queda en
`~/Library/Logs/reviewer-dev.log`, que es la única pista que hay cuando el doble
clic no deja nada a la vista.

### Cómo está partido

- **`engine/`** — todo lo que no sabe que existe una ventana. Es donde está el
  contrato con el disco (`workspace.js`), el escaneo de versiones, la decisión de
  proxy, el formato de los tiempos, lo que se escribe en el `feedback.md` y los
  dos transportes del LLM. Se prueba entero con `node tests/run.js`.
- **`main.js` / `preload.js`** — el proceso principal, el protocolo `reviewer://`
  y el puente. La ventana no tiene Node: habla por IPC y nada más.
- **`src/`** — la ventana, en módulos ES sin bundler ni dependencias.
  `src/index.html` es la de siempre; `src/pantalla.html` es la del segundo
  monitor, que no decide nada y solo muestra lo que la primera le cuenta.

Para mirar qué pasa adentro de una ventana mientras la app corre —sobre todo
las excepciones de un `addEventListener`, que no aparecen en ningún lado y dejan
un botón mudo sin más síntoma— está `tools/cdp.js`, que se conecta al puerto que
abre `npm run dev`:

```bash
node tools/cdp.js "document.querySelectorAll('.comentario').length"
node tools/cdp.js --errores
```

El protocolo propio existe porque `file://` no sirve: `net.fetch` ignora los
rangos HTTP y el `<video>` se queda esperando para siempre. `reviewer://` sirve
los pedazos que Chromium pide, y solo de los archivos que están en una lista de
rutas permitidas que el main arma al abrir la carpeta.

### Los tests

Son el lugar donde están escritas las decisiones que no se ven en el código:
por qué 83.44 s a 29.97 es el cuadro 2500 y no el 2501, por qué un H.264 de 10
bits igual hay que convertirlo, por qué borrar el comentario `c02` no libera ese
id. Si algo de eso hay que cambiarlo, el test de al lado dice qué se rompe.

```bash
node tests/run.js            # todos
node tests/run.js feedback   # solo los que matcheen
```

### La versión

Cada cambio que se commitea sube el patch, y lo sube un comando:

```bash
node tools/subir-version.js          # 0.1.0 -> 0.1.1
node tools/subir-version.js minor    # 0.1.7 -> 0.2.0
node tools/subir-version.js major    # 0.2.3 -> 1.0.0
```

El número está escrito en dos archivos porque lo leen dos cosas distintas:
`version.json` va adentro del `.pkg` y es lo que la app abre en runtime para
mostrar la versión en la barra de arriba, y `package.json` es lo que mira
electron-builder para nombrar el instalador. Desincronizados no rompen nada
ruidoso —el instalador se llama `Reviewer-0.1.4` y la ventana dice `0.1.2`—, y
eso se descubre tarde, cuando llega un reporte contra un número que no existió.
Por eso los mueve un solo comando y no se editan a mano; si igual quedan
distintos, `tests/modulos.test.js` lo dice.

### Publicar una versión

Lo que la app consulta para saber si hay algo nuevo son los **releases de este
mismo repo** (`DanielGutierrezB/Reviewer`). El tag es el número que compara
contra el suyo y el cuerpo del release son las notas que muestra en Ajustes. Así
que publicar es, literalmente, crear ese release.

Cuatro pasos, en este orden:

```bash
node tools/subir-version.js                    # 1. 0.1.0 -> 0.1.1 en los dos archivos
npm run build                                  # 2. los dos .pkg en dist/
bash tools/publicar-release.sh notas/0.1.1.md  # 3. el release, con notas
#                                              # 4. commitear el cambio de versión
```

Son cuatro comandos y no uno a propósito: compilar lleva varios minutos y
publicar es irreversible, y juntarlos es cómo se publica un release de algo que
no se probó. Lo que sí hace `publicar-release.sh` es negarse si falta un paso
anterior —si `version.json` y `package.json` no coinciden, si el `.pkg` no está
compilado, o si esa versión ya está publicada—.

El archivo de notas es opcional pero conviene: es lo único que el editor lee
antes de decidir si instala. Sin él se publica un texto genérico.

De los dos `.pkg` que arma `npm run build` se sube **solo el de actualización**
(`Reviewer-<v>-arm64-update.pkg`, ~130 MB). El completo (~600 MB) arrastra el
modelo de Whisper otra vez y es para instalar en una Mac nueva: ese se pasa a
mano.

**Credenciales.** Hace falta `gh` (`brew install gh`) con sesión abierta
(`gh auth login`). Si en vez de la sesión se prefiere un token, `gh` lo toma de
`GH_TOKEN` o `GITHUB_TOKEN` del entorno, y el token necesita permiso de
escritura en `contents` del repo:

```bash
export GH_TOKEN=ghp_PEGÁ_ACÁ_TU_TOKEN   # nunca en un archivo del repo
```

No hay ningún token escrito en este repo y no tiene que haberlo: un token
commiteado es un token publicado, y rotarlo no borra el historial.

### Cómo se actualiza la app

Reviewer **avisa** que hay una versión nueva y abre la página del release en el
navegador. No se reemplaza sola, y eso no es un pendiente: es lo que se puede
hacer sin un Developer ID de Apple.

La actualización automática de Electron en macOS pasa por Squirrel.Mac, que
antes de reemplazar el bundle comprueba que la firma del build nuevo case con la
del que está corriendo. Acá la firma es ad-hoc (`codesign --sign -` en
`build-pkg.sh`, porque no hay certificado) y su identificador cambia en cada
compilación, así que esa validación falla siempre —y falla después de bajar los
130 MB, con un error que no menciona nada de esto—. Además Squirrel.Mac se
actualiza desde un `.zip` con el `.app` adentro, y Reviewer se distribuye como
`.pkg` de dos componentes justamente para que el modelo de Whisper no se borre
al reemplazar la app.

Un botón «Actualizar» que falla en silencio es peor que uno que dice la verdad,
así que el botón dice «Bajar la 0.1.1» y hace eso: abre la página, el navegador
descarga y el Instalador de macOS instala, con las advertencias del sistema a la
vista. Tampoco se ejecuta nada traído de la red por cuenta propia.

Para pasar a la instalación de verdad hacen falta, en este orden: un Developer
ID, notarizar el build, cambiar el target a `zip` + `dmg` y resolver qué pasa
con el modelo. El porqué completo está arriba de `engine/actualizaciones.js`.

Mientras tanto, del lado de la app:

- **Ajustes → Actualizaciones** dice en qué versión estás, tiene el botón
  **Buscar actualizaciones** y muestra las notas de la que encontró.
- Al abrir la app pregunta sola, a los cuatro segundos y sin bloquear nada. Se
  puede apagar con la casilla de ese mismo bloque (queda en `ajustes.json`). Sin
  internet la consulta falla en silencio: la app abre igual y el motivo queda
  escrito en Ajustes y en el diario.
- Cuando hay algo nuevo aparece una cajita ámbar en la barra de arriba y nada
  más: no se abre ningún cartel, no se tapa el reproductor y no se toca el foco
  del teclado, que en esta app son todas teclas de una sola letra.
- Las versiones se comparan como números y no como texto, que es donde se
  esconde el error: ordenadas alfabéticamente, `1.0.10` va antes que `1.0.9` y la
  app no vuelve a ver ninguna actualización. Hay tests de eso en
  `tests/actualizaciones.test.js`.
