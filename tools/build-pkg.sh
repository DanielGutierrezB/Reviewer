#!/bin/bash
#
# tools/build-pkg.sh — Arma los dos instaladores de una versión.
#
# Son dos porque el modelo del dictado pesa 465 MB de los ~600 y es el mismo en
# todas las versiones. Si viajara dentro del `.app`, actualizar sería volver a
# bajarlo para cambiar unos kilobytes de código; peor todavía, reemplazar el
# `.app` lo borraría y habría que reinstalarlo igual.
#
#   Reviewer-<v>-arm64.pkg          completo   ~600 MB  primera instalación
#   Reviewer-<v>-arm64-update.pkg   solo app   ~130 MB  el que se baja después
#
# El completo son dos componentes: la app a /Applications y el modelo a
# /Library/Application Support/Reviewer, que es uno de los `DATA_DIRS` donde
# `engine/paths.js` lo busca. El de actualización lleva solo el primero, así que
# se instala sobre lo que ya está y deja el modelo en su lugar, intacto.
#
#   bash tools/build-pkg.sh
#
set -euo pipefail

cd "$(dirname "$0")/.."

VERSION=$(node -p "require('./package.json').version")
IDENT=$(node -p "require('./package.json').build.appId")
APP_NAME="Reviewer"
DATA_DIR="/Library/Application Support/${APP_NAME}"
OUT="dist"
STAGE="$OUT/pkg-stage"

echo "Reviewer ${VERSION}"

# La app reporta la de `version.json` y el instalador se llama con la de
# `package.json`. Si no son la misma, la app se compara contra los releases con
# un número que no es el suyo: o no ve una actualización que existe, o se ofrece
# a sí misma para siempre.
REPORTADA=$(node -p "require('./version.json').version")
if [ "$REPORTADA" != "$VERSION" ]; then
    echo "version.json dice ${REPORTADA} y package.json ${VERSION}. Igualalos antes de compilar."
    exit 1
fi

for tool in pkgbuild productbuild; do
    command -v "$tool" >/dev/null || { echo "Falta $tool (viene con las Command Line Tools)."; exit 1; }
done

# Los tests antes de compilar y no después: lo que se quiere evitar es firmar un
# instalador con un `feedback.md` que escribe mal un timecode, que es un defecto
# que no se ve abriendo la app.
echo "→ corriendo los tests"
node tests/run.js > /dev/null || { echo "Hay tests en rojo. Corré: npm test"; exit 1; }

# ── 1. La app ────────────────────────────────────────────────────────
# `--dir` deja el .app sin empaquetar: el empaquetado lo hacemos acá abajo,
# porque el target `pkg` de electron-builder solo sabe armar un componente y
# necesitamos dos.
echo "→ compilando la app"
npx electron-builder --mac --dir

APP="$OUT/mac-arm64/${APP_NAME}.app"
[ -d "$APP" ] || { echo "No quedó el .app en $APP"; exit 1; }

# Que los binarios hayan entrado se comprueba acá y no se asume: el `filter` de
# `extraResources` en package.json saca `models/**`, y un cambio en ese filtro
# que de paso se lleve ffmpeg deja una app que abre, lista las clases y no
# reproduce nada.
for bin in ffmpeg ffprobe whisper-server; do
    [ -x "$APP/Contents/Resources/bin/$bin" ] ||
        { echo "Falta $bin adentro del .app: corré tools/bundle-binaries.sh"; exit 1; }
done
if [ -d "$APP/Contents/Resources/bin/models" ]; then
    echo "El modelo se coló adentro del .app: revisá el filter de extraResources."
    exit 1
fi

# Sin certificado de Apple la firma es ad-hoc. Alcanza para que macOS la deje
# correr después del primer "Abrir igual", y es lo que hay hasta que exista un
# Developer ID.
echo "→ firmando ad-hoc"
codesign --force --deep --sign - "$APP" 2>/dev/null || true

# ── 2. El modelo ─────────────────────────────────────────────────────
MODELS="bin/mac/models"
[ -d "$MODELS" ] || { echo "Falta el modelo de Whisper: corré tools/bundle-binaries.sh"; exit 1; }

rm -rf "$STAGE"
mkdir -p "$STAGE/payload"
echo "→ juntando el modelo"
# `ditto` y no `cp`: sin `--norsrc` cada archivo viaja con un `._` al lado.
ditto --norsrc --noextattr --noacl "$MODELS" "$STAGE/payload/models"

# Al payload van archivos y nada más: un enlace simbólico a la carpeta de
# modelos de otra app resuelve en ESTA Mac y llega colgado a la del editor.
colgados=$(find "$STAGE/payload" -type l)
if [ -n "$colgados" ]; then
    echo "→ enlaces que NO viajan (su destino no existe donde se instala):"
    while IFS= read -r enlace; do
        echo "    $(basename "$enlace") → $(readlink "$enlace")"
    done <<< "$colgados"
    find "$STAGE/payload" -type l -delete
fi

echo "→ lo que viaja:"
for m in "$STAGE/payload/models"/*; do
    [ -e "$m" ] || continue
    echo "    $(du -sh "$m" | cut -f1)  $(basename "$m")"
done

# ── 3. Los componentes ───────────────────────────────────────────────
echo "→ armando los componentes"
pkgbuild --quiet \
    --component "$APP" \
    --install-location "/Applications" \
    --identifier "${IDENT}" \
    --version "$VERSION" \
    "$STAGE/app.pkg"

pkgbuild --quiet \
    --root "$STAGE/payload" \
    --install-location "$DATA_DIR" \
    --identifier "${IDENT}.models" \
    --version "$VERSION" \
    "$STAGE/models.pkg"

# ── 4. Los instaladores ──────────────────────────────────────────────
distribution() {
    local title="$1"; shift
    {
        echo '<?xml version="1.0" encoding="utf-8"?>'
        echo '<installer-gui-script minSpecVersion="2">'
        echo "  <title>${title}</title>"
        echo '  <options customize="never" require-scripts="false" hostArchitectures="arm64"/>'
        echo '  <volume-check><allowed-os-versions><os-version min="11.0"/></allowed-os-versions></volume-check>'
        echo '  <choices-outline>'
        for pkg in "$@"; do echo "    <line choice=\"${pkg}\"/>"; done
        echo '  </choices-outline>'
        for pkg in "$@"; do
            echo "  <choice id=\"${pkg}\" visible=\"false\"><pkg-ref id=\"${pkg}\"/></choice>"
            echo "  <pkg-ref id=\"${pkg}\">${pkg}.pkg</pkg-ref>"
        done
        echo '</installer-gui-script>'
    }
}

echo "→ instalador completo"
distribution "${APP_NAME} ${VERSION}" app models > "$STAGE/full.dist"
productbuild --distribution "$STAGE/full.dist" --package-path "$STAGE" \
    "$OUT/Reviewer-${VERSION}-arm64.pkg"

echo "→ instalador de actualización"
distribution "${APP_NAME} ${VERSION}" app > "$STAGE/update.dist"
productbuild --distribution "$STAGE/update.dist" --package-path "$STAGE" \
    "$OUT/Reviewer-${VERSION}-arm64-update.pkg"

rm -rf "$STAGE"

echo ""
echo "Listo:"
for f in "$OUT/Reviewer-${VERSION}-arm64.pkg" "$OUT/Reviewer-${VERSION}-arm64-update.pkg"; do
    echo "  $(du -h "$f" | cut -f1)  $f"
done
