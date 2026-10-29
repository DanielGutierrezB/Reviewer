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
3. **Comentás.** Pausás donde sea y apretás `C`, o marcás un tramo con `I` y `O`,
   o directamente dibujás encima del cuadro: el primer trazo abre el comentario
   solo.
4. **El archivo se escribe mientras tanto.** No hay botón de exportar.
5. **Copiás la ruta** del `feedback.md` y se la pegás a Claude.

### Teclas

| | |
|---|---|
| `espacio` | play / pausa |
| `←` `→` | un cuadro; con `Shift`, diez |
| `J` `K` `L` | atrás / pausa / adelante |
| `I` `O` | entrada y salida del tramo |
| `C` | comentar en este momento |
| `Esc` | cerrar lo que esté abierto |

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
│   └── dibujos/c01-00h01m23s10f.png← el cuadro con el dibujo encima
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
hable OpenAI (LM Studio, llama.cpp, lo que sea): URL y modelo. Nada sale de la
máquina.

Hay una red entre el modelo y el campo de texto. Si contesta en vez de
reescribir, si se come la mitad de lo que se pidió o si pierde una referencia, el
texto original se queda como estaba y se dice por qué. El botón "Texto original"
está siempre, por si el refinado quedó peor.

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
