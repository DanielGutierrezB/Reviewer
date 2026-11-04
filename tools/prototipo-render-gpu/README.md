# Prototipo: render en la GPU desde Reviewer

**Es un prototipo y no forma parte de la app.** Existe para contestar con
números una sola pregunta: ¿un compositor en el navegador, decodificando y
codificando por VideoToolbox a través de WebCodecs, da la misma imagen que
`render7.py` y a qué velocidad? Reproduce la ruta más pesada y más común del
exportador —la toma SCREEN con zoom animado, subrayados, recuadro de cámara
con grade, máscara, aro y logo—, que es la mitad de los cuadros de una clase.

## Correrlo

```bash
npm install --no-save mediabunny      # lee y escribe MP4 desde JS; no va en package.json
node tools/prototipo-render-gpu/correr.js \
    ~/Movies/CUR/2610_NemoClaw_Course/_claude_edit v7/plan_c5p1c.json 53 300 3
```

`correr.js` le pide a `render7.py` los parámetros exactos de la toma, genera
la tabla 3D del grade con ffmpeg, renderiza la referencia sin pérdida y el
render de producción, corre el prototipo solo y en paralelo, y compara con
VMAF y PSNR. Deja un cuadro lado a lado en `$TMPDIR/poc-gpu/`.

## Resultados (M3 Max, toma 53 de `plan_c5p1c`, 300 cuadros)

| | tiempo | cuadros/s |
|---|---|---|
| ffmpeg, 1 proceso | 2,5 s | 120 |
| ffmpeg, 3 a la vez (como el worker) | 4,5 s | 201 |
| prototipo, 1 tubería | 2,0 s | 147 |
| prototipo, 3 tuberías | 3,3 s | **269** |
| prototipo sin componer (techo de decodificar + codificar) | 2,5 s | 353 |

| Calidad contra la referencia sin pérdida | VMAF | PSNR |
|---|---|---|
| ffmpeg con VideoToolbox | 91,9 | 32,1 |
| prototipo | **89,2** | 31,8 |

## Lo que hubo que resolver para llegar a paridad

1. **El grade de color.** Reproducir `curves`, `colorbalance`,
   `selectivecolor` y `eq` a mano era el obstáculo. Se evita: ffmpeg aplica el
   grade real sobre una imagen Hald de nivel 8 y la salida es una tabla 3D de
   64³ colores, que un shader aplica a costo cero. Contra el grade directo:
   51 dB de PSNR. Si Claude cambia el grade, la tabla se regenera con un
   comando.
2. **La cuantización de `zoompan`.** Con la trayectoria matemática exacta la
   imagen se ve igual a ojo, pero durante el movimiento cada borde de texto
   queda doble contra la de ffmpeg (21 dB donde quieta da 32). `zoompan`
   trabaja a 4K, trunca el tamaño a entero y la posición a entero par. Se
   reproduce ese redondeo.
3. **El escalador.** Canvas 2D escala con el bicúbico de Skia, más blando que
   el Lanczos de ffmpeg: VMAF 78. Con un shader Lanczos-3: 89. El costo fue
   velocidad (355 → 269), en parte por el remuestreo y en parte por las
   copias entre el canvas 2D y WebGL.

## Lo que falta para que sea un renderer

- Los otros seis layouts y el blur temporizado; todos están ya escritos en
  Canvas 2D en `src/js/preview/compositor.js`, para el preview.
- Un solo contexto WebGL de punta a punta y codificar desde él, sin pasar por
  canvas 2D: el techo medido de 353 dice que hay un 30 % de margen.
- Los overlays VP9 con alfa del plan (`libvpx-vp9` yuva420p), que WebCodecs no
  decodifica con alfa: habría que partirlos en color + alfa como ya se hace
  con las escenas.
- Unión de segmentos, mux con el audio y control de calidad, que hoy hace
  `step.py`.

## La conclusión, con los números

El render en GPU **no es tres o cinco veces más rápido**, como sugiere la
intuición de la GPU: es 1,3 veces, quizá 1,7 con el margen de arriba. La
razón es que el render con ffmpeg nunca estuvo lejos del techo del Media
Engine: seis procesos en la CPU ya dan 200 cuadros/s, y el camino de
WebCodecs topa en 353. Sobre una clase de 10 minutos son entre 15 y 30
segundos menos, y el audio pasa a ser el camino crítico.

Lo que sí cambia es arquitectural: el preview y el render saldrían del mismo
código, así que lo que se ve al revisar sería por construcción lo que se
exporta, y el render dejaría de depender del taller de Python.
