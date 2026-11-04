---
name: reviewer
description: Cómo trabajar con Reviewer, la app con la que el editor revisa los renders de un curso y le devuelve el feedback a Claude. Leelo al empezar un curso, antes de abrir una carpeta Feedback/, antes de entregar una versión nueva de una clase y antes de tocar el render del Mac.
---

# Reviewer v{{version}} · cómo trabajar con el editor

Reviewer es la app de escritorio con la que el editor mira lo que vos
entregás, comenta sobre el video —en un momento exacto, con el cuadro, con un
dibujo encima si hace falta— y te lo devuelve ordenado. El ciclo entero es:

1. Vos dejás un render (o una edición para preview) en la carpeta del curso.
2. El editor lo revisa en Reviewer y comenta.
3. Reviewer arma la carpeta `Feedback/` y el editor te la pasa.
4. Vos hacés los ajustes, marcás cada uno como hecho en ese mismo documento,
   y entregás la versión siguiente.
5. Reviewer avisa que llegó, lee lo que marcaste, y el editor revisa de nuevo.

Este documento sale de la propia app (Ajustes → Skill para Claude), así que
corresponde a la versión {{version}}, exportado el {{fecha}}. Si el editor
actualiza Reviewer, pedile que te lo exporte de nuevo.

## 1. La carpeta de renders y cómo se nombran las cosas

El editor abre en Reviewer **la carpeta donde están los renders** (por ejemplo
`Clases_Finales/V2`). Reviewer agrupa los archivos en clases y versiones
mirando solo el nombre:

```
Clase 03 - Hooks.mp4        ← v1: sin sufijo
Clase 03 - Hooks v2.mp4     ← v2
Clase 03 - Hooks_v3.mp4     ← v3: vale espacio, guion bajo o guion
06_Curso_p1_V2_v4.mp4       ← la parte 1 de una clase partida; p1 y p2 se
06_Curso_p2_V2_v4.mp4          muestran como UNA clase en dos partes
```

- El sufijo de versión va **al final**, con separador: ` v2`, `_v2` o `-v2`.
  Un número pegado a una palabra (`Nivel2`) es parte del nombre.
- La extensión no agrupa: `.mp4` y `.mov` de la misma clase son la misma clase.
- Si una clase se llama `01_Curso_V2`, ese `V2` es del nombre y Reviewer lo
  entiende mirando a sus hermanas. No lo cambies de una versión a otra.
- `Pre versions/`: las versiones anteriores van ahí, **cada una con su carpeta
  de comentarios al lado**. Siguen visibles en Reviewer como historia.

Al lado de cada render que el editor comentó, Reviewer crea una carpeta con
el mismo nombre del archivo, sin extensión:

```
Clase 03 - Hooks v2.mp4
Clase 03 - Hooks v2/
├── feedback.md          ← lo que te dice el editor, para leer
├── comentarios.json     ← lo que Reviewer vuelve a leer: NO lo toques
├── frames/              ← el cuadro de cada comentario, sacado del original
├── dibujos/             ← el cuadro con el dibujo del editor encima
└── adjuntos/            ← los archivos que el editor le colgó al comentario
Reviewer/
├── comentario-general.md   ← lo que vale para todas las clases del curso
└── _referencias/           ← archivos del curso que se citan desde los comentarios
```

Reglas que no se rompen:

- **No renombres ni muevas un render que ya tiene carpeta de comentarios** sin
  mover la carpeta con él, y con el mismo nombre. Al archivar en
  `Pre versions/`, van los dos juntos.
- **No edites `comentarios.json` ni nada dentro de `frames/`, `dibujos/`,
  `adjuntos/`.** Lo que vos escribís va en el documento de `Feedback/`.
- Nada de eso se crea hasta que el editor comenta de verdad: una carpeta sin
  comentarios no deja archivos.

## 2. Cómo te llega el feedback: la carpeta `Feedback/`

Cuando el editor exporta, Reviewer deja en la carpeta de renders:

```
Feedback/
├── FEEDBACK.md              ← el curso entero, clase por clase, en orden
├── <clase>_feedback.md      ← o una clase sola, si exportó solo esa
├── References/              ← cuadros, dibujos y adjuntos de todos los comentarios
└── .reviewer-export.json    ← el índice de Reviewer: NO lo toques ni lo borres
```

Cómo leer el documento:

- Todas las rutas empiezan con `{FEEDBACK}`: es la carpeta donde está el
  archivo que estás leyendo. La línea de base está escrita arriba del todo.
- **Solo viene lo que falta.** Los comentarios ya resueltos no están.
- Cada clase trae primero **"Qué hay que hacer"**, una lista de trabajo
  ordenada que resume los comentarios, y después **"Los comentarios"**, tal
  cual los escribió el editor. El resumen ordena; los comentarios mandan.
- **"Lo que vale para todas las clases del curso"** es la base: marca,
  tipografía, tono. Donde un comentario de una clase diga algo distinto,
  manda el comentario. No es una invitación a promediar.
- Cada comentario dice su momento de tres formas, porque del otro lado puede
  haber cualquier herramienta: `00:01:23:10 · 83.440 s · cuadro 2500 @ 29.97`.
  El timecode es *non-drop*. Si el comentario es sobre un tramo, trae desde y
  hasta.
- Si el comentario trae el cuadro o el dibujo, la ruta está ahí. Si no lo
  trae, el momento alcanza: mirá el plan.
- Los adjuntos dicen para qué sirven, y las dos frases son exactas:
  - `SOLO DE REFERENCIA, para mirar`: miralo y hacé algo en esa línea. **No**
    entra al video.
  - `PARA USAR TAL CUAL, es el material`: ese archivo mismo va adentro de la
    pieza. No lo rehagas, no lo imites, no busques uno parecido.
- Una mención como «el logo (`adjunto`, para usar tal cual)» ya viene
  resuelta al nombre del archivo; la ruta absoluta está en la lista de abajo.
  Si dice que la referencia ya no está adjunta, es que el editor la borró:
  seguí el texto, no la busques.

## 3. Marcar lo que hiciste, en el mismo documento

Cada comentario tiene una casilla con un código entre corchetes:

```
- [ ] Hecho · [03-curso-v2-v4-c01]
```

Cuando terminás ese ajuste, cambiá `[ ]` por `[x]` **en ese archivo**, y si
querés agregá al final qué hiciste:

```
- [x] Hecho · [03-curso-v2-v4-c01] — bajé el logo a la esquina inferior derecha
```

Reviewer lee esas casillas y da el comentario por resuelto, así no vuelve a
pedirse en el próximo export. Por eso:

- Marcá **solo lo que de verdad quedó hecho**. Lo que quedó a medias o no se
  pudo, dejalo sin marcar y explicá por qué debajo.
- **No cambies el código ni el resto del renglón.** Reviewer lo busca tal cual,
  al principio de la línea y sin sangría.
- Una marca vale para el comentario tal como se exportó. Si el editor lo
  cambió después, es otro pedido y va a volver a salir.
- Si el editor reabre un comentario que marcaste, la casilla vieja no lo
  vuelve a cerrar: va a salir de nuevo en el próximo export.

## 4. Entregar una versión nueva

- Mismo nombre de clase, **sufijo de versión siguiente**, en la misma carpeta
  de renders: después de `Clase 03 - Hooks v2.mp4` va `Clase 03 - Hooks v3.mp4`.
- Mové la versión anterior **y su carpeta de comentarios** a `Pre versions/`.
- **Nunca sobrescribas una versión que ya tiene comentarios** ni reutilices
  su nombre. Una versión es un archivo nuevo.
- Escribí el archivo completo antes de que aparezca donde Reviewer mira:
  renderizá en otra carpeta y movelo al final. Reviewer espera a que un
  archivo deje de crecer, pero un render a medias que después se renombra
  confunde.
- Reviewer le avisa al editor que llegó algo nuevo; no recarga sola. No hace
  falta que avises por otro lado, pero decí en tu mensaje qué clases
  entregaste y con qué versión.

## 5. Entregar una edición para preview, sin renderizar

Reviewer puede componer una clase en vivo a partir de un `edit.json` y los
medios en proxy, para que el editor revise sin esperar el render. La carpeta
de la edición vive junto a los renders y Reviewer la muestra como una versión
más de su clase. Lo que Reviewer exige del `edit.json`, en este orden:

1. `"format": "claude-edit-preview"`. Sin eso no es una edición.
2. `width`, `height` y `fps` de **1920×1080 a 30**. Otro tamaño se rechaza
   con los números.
3. `media.mix`: el audio ya mezclado y normalizado (`.m4a`). Es el reloj del
   preview; sin él no hay nada que mirar.
4. `shots` que cubran `duration_frames` entero, **sin huecos**: cada cuadro
   tiene que caer en un shot.
5. Los archivos esenciales tienen que existir: los medios en proxy
   (`media.*.file`), las escenas (`scenes.*.file`) y los overlays. Las
   máscaras, aros y subrayados (`geometry.*.mask|ring`,
   `shots[].screen.highlights[].file`) son adornos: si falta uno se avisa,
   pero la edición abre.

Todas las rutas del `edit.json` cuelgan de la carpeta de la edición, incluidas
las que apuntan al curso (`reference_render`, `media.*.original`), con el
`../` escrito adentro. `title` y `based_on` son lo que el editor ve.

Lo que el editor comenta sobre una edición queda en `feedback/` dentro de esa
misma carpeta, y entra al export igual que lo demás. Reviewer no escribe nada
más ahí: la carpeta de la edición es tuya.

## 6. Renderizar en el Mac desde Reviewer

Reviewer es el worker de render en vez de una ventana de Terminal. Arranca
solo al abrir la app, sobre el último curso que renderizó, y la pestaña
**Render** está desde la primera pantalla: el editor no tiene que abrir
ninguna carpeta para que el Mac trabaje. Lo que Reviewer hace, y lo que vos
tenés que respetar:

**Dónde busca el taller.** Sube hasta tres niveles desde la carpeta abierta
buscando `_claude_edit/` con `step.py` y `macworker_jobs.txt` adentro. Si tu
curso no tiene esa forma, la pestaña dice que la carpeta no tiene taller.

**El protocolo**, el mismo que `mac_worker.sh`:

| Archivo | Qué hace Reviewer |
|---|---|
| `macworker.alive` | Lo escribe cada 20 s con la hora Unix en segundos. Un worker está vivo si tiene menos de 90 s. |
| `STOP_WORKER` | Si existe, se detiene. |
| `macworker_jobs.txt` | El nombre del archivo de cola (`jobs8.json`), una línea. |
| `step.py` | Lo corre como `python3 step.py <cola> 100000`, una pasada tras otra, 15 s entre una y otra. |
| `step_status.json` | Lo lee cada 2 s para pintar las etapas. |
| `macworker.log` | Lee el final; ahí busca los motivos de error. |
| `mac_tasks/*.sh` | Las tareas sueltas; `.run` mientras corre, `.done` al terminar, `.log` al lado. |

Con el entorno: `WORKER=1`, `NP` (la mitad de los núcleos de rendimiento,
entre 2 y 8; medido, 6 es lo mejor en un M3 Max), y un `PATH` que empieza por
`<taller>/.macvenv/bin`, `<taller>/macbin`, el ffmpeg que Reviewer trae
adentro, y Homebrew. No hace falta ffmpeg instalado. Si falta `numpy`,
`soundfile` o `Pillow`, Reviewer arma `.macvenv` y los instala la primera vez.
Si falta `tesseract`, avisa y sigue.

**Nunca dos workers a la vez.** Reviewer no arranca si ve un latido ajeno
fresco, y la Terminal tiene que hacer lo mismo. Para saber si el Mac está
renderizando, mirá `macworker.alive` como siempre; no le pidas al editor que
abra una Terminal.

**Las etapas** son las de `step.py`: `ocr`, `render`, `audio`, `video`, `mux`,
`qa`, `delivered`; más `error` y `unchanged`. Reviewer las muestra por clase,
con las partes de una clase agrupadas y una barra por parte. El avance sale
de leer el disco, así que estos contratos hay que mantenerlos si cambiás los
scripts:

- Render: las tomas terminadas son los `NNNN.mp4` de la carpeta `seg` del
  trabajo; un `.tmp.mp4` no cuenta hasta que se renombra. El total sale de
  `shots` del plan.
- OCR: `v7/ocr3_<tag>.json` con `done`, contra los tramos de 45 s que salen de
  las tomas `SCREEN` del plan.
- Unión: bytes de `<tag>_video.mp4` contra la suma de los segmentos.
- Armado: bytes de `Clases_Editadas/<nombre>` contra video más audio.

**Los errores.** `step_status.json` solo guarda que la etapa es `error`, nunca
por qué. El motivo tiene que ir al log en un renglón que empiece con **el
nombre del trabajo, un espacio, `ERROR` y el motivo**:

```
V2/03_Curso_V2_v4.mp4 ERROR render :: ffmpeg: no such file scn/titulo_a.mp4
```

Reviewer lo busca con ese formato, lo muestra en rojo y le da al editor un
botón para copiártelo. Un trabajo en `error` **se reintenta cada 15 s para
siempre** y nadie lo arregla solo: cuando algo falle, decidí en el momento si
lo rehacés con otro tag o lo sacás de la cola.

**La entrega.** El trabajo termina moviendo el archivo a
`Clases_Finales/<nombre del trabajo>`; Reviewer le avisa al editor y le ofrece
abrirlo. Creá la carpeta de destino antes de mover: `os.rename` no la crea, y
un `V2/_x/` que no existe deja el render terminado y aprobado sin entregar.
No dejes entregas de prueba dentro de la carpeta de renders: Reviewer las
muestra como clases.

## 7. Lo que no se toca

- `comentarios.json` y las carpetas `frames/`, `dibujos/`, `adjuntos/` de cada
  versión: son del editor.
- `Feedback/.reviewer-export.json`: es cómo Reviewer sabe qué código es qué
  comentario y qué marcas ya usó.
- Lo que hay en `Pre versions/`: es historia, con sus comentarios.
- Las grabaciones originales del curso.

## 8. Antes de empezar, en una línea cada cosa

1. Leé `Feedback/FEEDBACK.md` (o el `<clase>_feedback.md` que te pasaron).
2. Lo general es la base; donde un comentario diga otra cosa, manda el comentario.
3. `SOLO DE REFERENCIA` se mira; `PARA USAR TAL CUAL` entra al video.
4. Marcá `[x]` solo lo hecho, sin tocar el código ni el renglón.
5. Entregá con el sufijo de versión siguiente y archivá la anterior con su carpeta.
6. Si el Mac renderiza, mirá `macworker.alive`; los errores van al log como `<trabajo> ERROR <motivo>`.
