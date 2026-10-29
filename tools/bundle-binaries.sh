#!/bin/bash
#
# tools/bundle-binaries.sh — Mete ffmpeg, ffprobe y whisper-server dentro de la app.
#
# Adaptado del de Class Cut, con una diferencia que importa: acá se compila
# `whisper-server` y no `whisper-cli`. Reviewer deja el servidor prendido entre
# dictados porque el modelo tarda un segundo largo en cargar, y pagarlo cada vez
# que se aprieta el micrófono se siente como que la app se colgó.
#
    10|# La promesa del instalador es que no haya que instalar nada más, y estos
# binarios vienen de Homebrew enlazados contra librerías que viven en
# /opt/homebrew: en una Mac sin Homebrew no arrancan. Acá se copian ellos y todas
# sus dependencias a bin/mac/, se les reescribe de dónde cargan cada librería y
# se vuelven a firmar (tocar un binario invalida su firma y macOS lo mata).
#
# Dos cosas que costaron un rato entender, y que se heredan tal cual:
#
# 1. Homebrew enlaza por `@rpath/libfoo.dylib`, no por ruta absoluta. Saltarse
#    esas referencias —parecen "ya relativas, ya están bien"— deja fuera del
    20|#    bundle justo las librerías propias del programa. Hay que resolver el
#    @rpath contra los LC_RPATH del binario ORIGINAL, que es donde esas rutas
#    todavía significan algo.
# 2. Se reescribe a @executable_path/lib y @loader_path, no a @rpath: esas dos no
#    buscan en varios sitios, dicen exactamente dónde está el archivo.
#
# whisper-server no se copia de Homebrew: se compila. El paquete de Homebrew trae
# la carpeta de sus backends (Metal, BLAS, CPU) compilada adentro del binario
# —/opt/homebrew/Cellar/ggml/*/libexec—, así que reubicado seguía cargando los de
# ahí JUNTO con la librería del bundle. Con dos copias de ggml-base en el mismo
    30|# proceso, los dispositivos quedan registrados en una y buscados en la otra, y
# aborta con `GGML_ASSERT(device) failed`. Compilado desde fuente con los
# backends enlazados adentro y el shader de Metal embebido, no hay ninguna
# carpeta que encontrar y el problema desaparece de raíz.
#
#   bash tools/bundle-binaries.sh
#   bash tools/bundle-binaries.sh --sanear   (solo rehacer el enlazado)
#
set -euo pipefail

    40|cd "$(dirname "$0")/.."
DEST="bin/mac"
LIBDIR="$DEST/lib"
MODELDIR="$DEST/models"
mkdir -p "$LIBDIR" "$MODELDIR"

log() { printf '  %s\n' "$*"; }

is_system_lib() {
    case "$1" in
    50|        /usr/lib/*|/System/*) return 0 ;;
        *) return 1 ;;
    esac
}

resign() {
    codesign --force --sign - --timestamp=none "$1" 2>/dev/null || true
}

rpaths_of() {
    60|    otool -l "$1" 2>/dev/null | awk '/LC_RPATH/{f=1;next} f&&/path /{print $2;f=0}'
}

# Una dependencia tal como la declara el binario → la ruta real en el disco.
resolve_dep() {
    local dep="$1" origin="$2"
    local dir; dir=$(dirname "$origin")

    case "$dep" in
        @rpath/*)
    70|            local base="${dep#@rpath/}"
            local candidate
            for rp in $(rpaths_of "$origin") /opt/homebrew/lib "$dir"; do
                candidate="${rp//@loader_path/$dir}"
                candidate="${candidate//@executable_path/$dir}"
                if [ -f "$candidate/$base" ]; then echo "$candidate/$base"; return 0; fi
            done
            return 1 ;;
        @loader_path/*) echo "$dir/${dep#@loader_path/}" ;;
        @executable_path/*) echo "$dir/${dep#@executable_path/}" ;;
    80|        *) echo "$dep" ;;
    esac
}

# @param 1 archivo ya copiado al bundle   2 ruta original (para resolver @rpath)
# @param 3 prefijo con el que se reescribe (@executable_path/lib/ o @loader_path/)
fix_deps() {
    local file="$1" origin="$2" prefix="$3"

    while read -r dep; do
    90|        [ -z "$dep" ] && continue
        is_system_lib "$dep" && continue

        local real base
        if ! real=$(resolve_dep "$dep" "$origin"); then
            log "no pude resolver $dep (de $(basename "$origin"))"
            continue
        fi
        is_system_lib "$real" && continue
        base=$(basename "$real")
   100|
        if [ ! -f "$LIBDIR/$base" ]; then
            if [ ! -f "$real" ]; then
                log "falta $real"
                continue
            fi
            cp "$real" "$LIBDIR/$base"
            chmod u+w "$LIBDIR/$base"
            install_name_tool -id "@loader_path/$base" "$LIBDIR/$base" 2>/dev/null || true
            add_bundle_rpath "$LIBDIR/$base" "@loader_path"
   110|            fix_deps "$LIBDIR/$base" "$real" "@loader_path/"
            resign "$LIBDIR/$base"
        fi

        # Las que ya vienen por @rpath se dejan como están: la ruta nueva es más
        # larga que la vieja y `install_name_tool -change` no siempre tiene lugar
        # para escribirla (falla en silencio y el binario queda apuntando a
        # Homebrew). Para esas alcanza con agregarle al binario un rpath que mire
        # dentro del bundle, cosa que hace `add_bundle_rpath`.
        case "$dep" in
   120|            @rpath/*) continue ;;
        esac
        install_name_tool -change "$dep" "${prefix}${base}" "$file" 2>/dev/null ||
            log "no pude reescribir $dep en $(basename "$file")"
    done < <(otool -L "$file" | tail -n +2 | awk '{print $1}')
}

# El rpath del bundle va PRIMERO: en una Mac con Homebrew, el del binario
# original todavía resuelve, y queremos que gane el nuestro.
add_bundle_rpath() {
   130|    install_name_tool -add_rpath "$2" "$1" 2>/dev/null || true
}

# Última pasada: no puede quedar NINGUNA referencia a /opt/homebrew.
#
# `fix_deps` copia una librería la primera vez que la ve y no vuelve a entrar,
# así que las referencias que una librería le hace a OTRA que ya estaba copiada
# quedaban sin reescribir. El resultado es peor que un binario que no arranca:
# arranca. En una Mac con Homebrew, libavfilter cargaba el libswscale de
# /opt/homebrew mientras ffmpeg cargaba el del bundle, y con dos copias de la
   140|# misma librería en un proceso el filtro se registra en una y se busca en la
# otra. En una Mac sin Homebrew directamente no carga.
sanear_rutas() {
    local pendientes=0
    for file in "$DEST/ffmpeg" "$DEST/ffprobe" "$LIBDIR"/*.dylib; do
        [ -f "$file" ] || continue
        # Para un ejecutable, `@loader_path` es su propia carpeta y las librerías
        # están un nivel más adentro.
        local prefijo="@loader_path/"
        case "$file" in
   150|            "$LIBDIR"/*) ;;
            *) prefijo="@executable_path/lib/" ;;
        esac
        local tocado=0
        while read -r dep; do
            case "$dep" in
                /opt/homebrew/*) ;;
                *) continue ;;
            esac
            local base; base=$(basename "$dep")
   160|            if [ ! -f "$LIBDIR/$base" ]; then
                log "queda suelta $base (no está en el bundle)"
                pendientes=$((pendientes + 1))
                continue
            fi
            chmod u+w "$file"
            if install_name_tool -change "$dep" "${prefijo}${base}" "$file" 2>/dev/null; then
                tocado=1
            else
                log "no pude reescribir $dep en $(basename "$file")"
   170|                pendientes=$((pendientes + 1))
            fi
        done < <(otool -L "$file" | tail -n +2 | awk '{print $1}')
        # Reescribir invalida la firma, y macOS mata lo que no está firmado.
        if [ "$tocado" = 1 ]; then resign "$file"; fi
    done
    return "$pendientes"
}

bundle_tool() {
   180|    local name="$1" src
    src=$(command -v "$name" || true)
    if [ -z "$src" ]; then
        echo "✗ no encuentro $name en el PATH. Instalalo con: brew install ffmpeg" >&2
        return 1
    fi
    src=$(python3 -c "import os,sys; print(os.path.realpath(sys.argv[1]))" "$src")

    log "$name ← $src"
    cp "$src" "$DEST/$name"
   190|    chmod u+w "$DEST/$name"
    add_bundle_rpath "$DEST/$name" "@executable_path/lib"
    fix_deps "$DEST/$name" "$src" "@executable_path/lib/"
    resign "$DEST/$name"
}

# Se apunta a la línea base de Apple Silicon y no a ESTA máquina: `GGML_NATIVE`
# compila para el procesador que tenga el que empaqueta, y un binario hecho en un
# M3 usa instrucciones (i8mm) que en un M1 son ilegales. El editor no se entera
# de eso hasta que le aprieta al micrófono y la app se cae.
   200|WHISPER_ARCH="armv8.2-a+dotprod+fp16"
WHISPER_SRC="${WHISPER_SRC:-$PWD/vendor/whisper.cpp}"

build_whisper() {
    if ! command -v cmake > /dev/null; then
        echo "✗ falta cmake para compilar whisper.cpp. Instalalo con: brew install cmake" >&2
        return 1
    fi
    if [ ! -d "$WHISPER_SRC/.git" ]; then
        log "whisper.cpp ← github"
   210|        mkdir -p "$(dirname "$WHISPER_SRC")"
        git clone --depth 1 https://github.com/ggml-org/whisper.cpp.git "$WHISPER_SRC" 2>&1 |
            sed 's/^/    /'
    fi

    log "compilando whisper-server para $WHISPER_ARCH"
    cmake -S "$WHISPER_SRC" -B "$WHISPER_SRC/build" \
        -DCMAKE_BUILD_TYPE=Release \
        -DBUILD_SHARED_LIBS=OFF \
        -DGGML_BACKEND_DL=OFF \
   220|        -DGGML_METAL=ON \
        -DGGML_METAL_EMBED_LIBRARY=ON \
        -DGGML_NATIVE=OFF \
        -DGGML_CPU_ARM_ARCH="$WHISPER_ARCH" \
        -DWHISPER_BUILD_TESTS=OFF \
        -DWHISPER_BUILD_SERVER=ON \
        > /dev/null || { echo "✗ falló el cmake de whisper.cpp" >&2; return 1; }

    cmake --build "$WHISPER_SRC/build" --config Release -j "$(sysctl -n hw.ncpu)" \
        > /dev/null || { echo "✗ falló la compilación de whisper.cpp" >&2; return 1; }
   230|
    cp "$WHISPER_SRC/build/bin/whisper-server" "$DEST/whisper-server"
    resign "$DEST/whisper-server"
}

# El modelo del dictado.
#
# `small` y no `base`: los comentarios de una edición están llenos de términos en
# inglés dichos en español —"el lower third", "el jump cut", "que el keyframe
# entre antes"— y `base` los escribe fonéticamente. El refinado del LLM no puede
# arreglar lo que llegó mal transcrito, así que el escalón se paga acá.
#
# Tampoco se usa uno más grande: `medium` son 1,5 GB y tarda lo suficiente como
# para que el texto en vivo deje de sentirse en vivo, que es justo lo que hace
# que dictar sea cómodo.
MODELO="ggml-small.bin"
MODELO_URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${MODELO}"

bajar_modelo() {
    if [ -f "$MODELDIR/$MODELO" ]; then
   250|        log "$MODELO ya está ($(du -h "$MODELDIR/$MODELO" | cut -f1))"
        return 0
    fi
    log "$MODELO ← huggingface"
    curl -L --fail --progress-bar -o "$MODELDIR/$MODELO.parcial" "$MODELO_URL" ||
        { echo "✗ no pude bajar $MODELO" >&2; rm -f "$MODELDIR/$MODELO.parcial"; return 1; }
    mv "$MODELDIR/$MODELO.parcial" "$MODELDIR/$MODELO"
}

# Reparar el enlazado de un bundle ya armado no necesita volver a compilar
   260|# whisper.cpp, que son varios minutos.
if [ "${1:-}" = "--sanear" ]; then
    echo "Solo saneando el enlazado de $DEST"
else
    echo "Empaquetando binarios en $DEST"
    bundle_tool ffmpeg
    bundle_tool ffprobe
    build_whisper
    bajar_modelo
fi
   270|
echo
echo "Listo:"
du -sh "$DEST" | sed 's/^/  /'
echo

# La única comprobación que vale es sin Homebrew a la vista: con él en el PATH un
# binario mal enlazado funciona igual y el problema aparece en la máquina del
# editor, que es donde no se puede arreglar.
echo "Saneando rutas absolutas que hayan quedado:"
   280|if sanear_rutas; then
    log "no queda ninguna referencia a /opt/homebrew"
else
    echo "  ✗ quedaron referencias a Homebrew sin resolver" >&2
    exit 1
fi

echo
echo "Comprobación (sin Homebrew en el PATH):"
env -i PATH=/usr/bin:/bin "$DEST/ffprobe" -version 2>&1 | head -1 | sed 's/^/  /'
   290|env -i PATH=/usr/bin:/bin "$DEST/ffmpeg" -version 2>&1 | head -1 | sed 's/^/  /'

# `-version` no arma un grafo de filtros y por eso no nota nada: con las
# librerías mal enlazadas igual imprime la versión, y el fallo aparece recién al
# convertir. Esta prueba hace las dos cosas que Reviewer le pide a ffmpeg —un
# proxy H.264 y un PNG de un cuadro suelto—, que es exactamente el camino que se
# rompe.
tmp="$(mktemp -d)"
if env -i PATH=/usr/bin:/bin "$DEST/ffmpeg" -v error -y \
   300|        -f lavfi -i "testsrc=size=640x360:rate=30:duration=1" \
        -c:v libx264 -preset veryfast -pix_fmt yuv420p -movflags +faststart "$tmp/p.mp4" 2>&1 |
        sed 's/^/  /' && [ -s "$tmp/p.mp4" ]; then
    echo "  proxy H.264: anda"
else
    echo "  ✗ ffmpeg no puede codificar H.264: revisá el enlazado" >&2
    exit 1
fi

if env -i PATH=/usr/bin:/bin "$DEST/ffmpeg" -v error -y \
   310|        -ss 0.5 -i "$tmp/p.mp4" -frames:v 1 "$tmp/c.png" 2>&1 | sed 's/^/  /' &&
        [ -s "$tmp/c.png" ]; then
    echo "  cuadro a PNG: anda"
else
    echo "  ✗ ffmpeg no puede sacar un cuadro: revisá el enlazado" >&2
    exit 1
fi

if otool -L "$DEST/whisper-server" | tail -n +2 | grep -qv -e '/usr/lib/' -e '/System/'; then
    echo "  ✗ whisper-server depende de algo que no es del sistema:" >&2
   320|    otool -L "$DEST/whisper-server" | tail -n +2 | grep -v -e '/usr/lib/' -e '/System/' >&2
    exit 1
fi
echo "  whisper-server: solo frameworks del sistema · $(du -h "$DEST/whisper-server" | cut -f1)"
echo "  modelo: $(du -h "$MODELDIR/$MODELO" | cut -f1)  $MODELO"
