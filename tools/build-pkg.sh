#!/bin/bash
#
# tools/build-pkg.sh — Arma el instalador de una versión.
#
# Es uno solo y no trae el modelo del dictado, igual que en Note Taker: el
# modelo pesa 488 MB, es el mismo en todas las versiones, y la app lo baja y
# lo verifica la primera vez que arranca sin él (`engine/dependencias.js`).
# Así actualizar son los ~135 MB de la app, y el modelo ya instalado se queda
# donde está —en `/Library/Application Support/Reviewer` si vino de un
# instalador viejo, en el de la carpeta del usuario si lo bajó la app—.
#
#   Reviewer-<v>-arm64.pkg   ~135 MB   sirve para instalar y para actualizar
#
# Antes había dos —completo con el modelo y de actualización sin él— y era una
# cosa más que explicar en cada release. El de actualización era este mismo.
#
#   bash tools/build-pkg.sh
#
set -euo pipefail

cd "$(dirname "$0")/.."

VERSION=$(node -p "require('./package.json').version")
IDENT=$(node -p "require('./package.json').build.appId")
APP_NAME="Reviewer"
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
# `--dir` deja el .app sin empaquetar: el empaquetado lo hacemos acá abajo con
# `pkgbuild` y `productbuild`, que es donde se fijan la arquitectura y la
# versión mínima de macOS que el Instalador comprueba.
echo "→ compilando la app"
npx electron-builder --mac --dir

APP="$OUT/mac-arm64/${APP_NAME}.app"
[ -d "$APP" ] || { echo "No quedó el .app en $APP"; exit 1; }

# Que los binarios hayan entrado se comprueba acá y no se asume: el `filter` de
# `extraResources` en package.json saca `models/**`, y un cambio en ese filtro
# que de paso se lleve ffmpeg deja una app que abre, lista las clases y no
# reproduce nada.
for bin in ffmpeg ffprobe; do
    [ -x "$APP/Contents/Resources/bin/$bin" ] ||
        { echo "Falta $bin adentro del .app: corré tools/bundle-binaries.sh"; exit 1; }
done
if [ -d "$APP/Contents/Resources/bin/models" ]; then
    echo "El modelo se coló adentro del .app: revisá el filter de extraResources."
    exit 1
fi

# El motor del dictado es una librería nativa, y una librería nativa no se puede
# abrir desde adentro del asar: tiene que haber quedado afuera, en
# app.asar.unpacked, que es lo que pide el `asarUnpack` de package.json. Si eso
# se rompe la app abre igual y falla recién cuando alguien aprieta el micrófono.
DYLIB="$(find "$APP/Contents/Resources/app.asar.unpacked/node_modules/@transcribe-cpp" \
    -name 'libtranscribe*.dylib' 2>/dev/null | head -1)"
[ -n "$DYLIB" ] ||
    { echo "El motor del dictado quedó adentro del asar: revisá asarUnpack en package.json"; exit 1; }

# Sin certificado de Apple la firma es ad-hoc. Alcanza para que macOS la deje
# correr después del primer "Abrir igual", y es lo que hay hasta que exista un
# Developer ID.
echo "→ firmando ad-hoc"
codesign --force --deep --sign - "$APP" 2>/dev/null || true

# ── 2. El componente ─────────────────────────────────────────────────
rm -rf "$STAGE"
mkdir -p "$STAGE"
echo "→ armando el componente"
pkgbuild --quiet \
    --component "$APP" \
    --install-location "/Applications" \
    --identifier "${IDENT}" \
    --version "$VERSION" \
    "$STAGE/app.pkg"

# ── 3. El instalador ─────────────────────────────────────────────────
# `productbuild` y no el `app.pkg` pelado: el distribution es lo que fija la
# arquitectura y la versión mínima de macOS, y lo que el Instalador muestra.
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

echo "→ instalador"
distribution "${APP_NAME} ${VERSION}" app > "$STAGE/app.dist"
productbuild --distribution "$STAGE/app.dist" --package-path "$STAGE" \
    "$OUT/Reviewer-${VERSION}-arm64.pkg"

rm -rf "$STAGE"

echo ""
echo "Listo:"
echo "  $(du -h "$OUT/Reviewer-${VERSION}-arm64.pkg" | cut -f1)  $OUT/Reviewer-${VERSION}-arm64.pkg"
