#!/bin/bash
#
# tools/publicar-release.sh — Publica la versión que ya está compilada, para que
# la app la encuentre.
#
#   bash tools/publicar-release.sh
#   bash tools/publicar-release.sh notas/0.2.0.md
#
# Sube el `.pkg` de actualización como release del propio repo. Eso es lo que
# `engine/actualizaciones.js` consulta: el tag es el número que la app compara
# contra el suyo, y el cuerpo del release son las notas que muestra en Ajustes
# antes de que el editor decida bajarlo.
#
# Las notas salen de un archivo si se le pasa uno, y si no del texto de abajo.
# El archivo es el caso normal de una versión con algo que contar: son lo único
# que el editor lee antes de instalar, y un párrafo escrito para él no se
# redacta cómodo adentro de un heredoc.
#
# Lo que NO hace: subir la versión (eso es `node tools/subir-version.js`),
# compilar (`npm run build`) ni commitear. Cada uno es una decisión distinta y
# juntarlas en un comando es cómo se publica un release de algo que no se
# probó. Lo que sí hace es negarse si los pasos de antes faltan.
#
# Credenciales: ninguna escrita acá. `gh` usa la sesión de `gh auth login`, y si
# en vez de eso hay un token en `GH_TOKEN` o `GITHUB_TOKEN`, lo toma del
# entorno. Un token en el repo es un token publicado.
#
set -euo pipefail

cd "$(dirname "$0")/.."

NOTAS="${1:-}"
if [ -n "$NOTAS" ] && [ ! -f "$NOTAS" ]; then
    echo "No existe el archivo de notas: $NOTAS"
    exit 1
fi

VERSION=$(node -p "require('./package.json').version")
REPORTADA=$(node -p "require('./version.json').version")
OWNER=$(node -p "require('./engine/actualizaciones').DEFAULTS.owner")
REPO=$(node -p "require('./engine/actualizaciones').DEFAULTS.repo")
PKG="dist/Reviewer-${VERSION}-arm64-update.pkg"

command -v gh >/dev/null || { echo "Falta gh (brew install gh)."; exit 1; }

# La app reporta la de `version.json` y el tag se arma con la de `package.json`.
# Desfasadas, la app se compara contra los releases con un número que no es el
# suyo: o no ve la actualización que existe, o se ofrece a sí misma para
# siempre. `subir-version.js` mueve las dos justamente para que esto no pase.
if [ "$REPORTADA" != "$VERSION" ]; then
    echo "version.json dice ${REPORTADA} y package.json ${VERSION}."
    echo "Corré: node tools/subir-version.js"
    exit 1
fi

# El de actualización y no el completo: el completo arrastra el modelo de
# Whisper de nuevo, 600 MB para cambiar código que ya está instalado. Los dos
# los arma `build-pkg.sh`; el completo se pasa a mano a una Mac nueva.
[ -f "$PKG" ] || { echo "No está $PKG. Corré primero: npm run build"; exit 1; }

gh repo view "${OWNER}/${REPO}" >/dev/null 2>&1 || {
    echo "No se ve ${OWNER}/${REPO}. Revisá 'gh auth status'."; exit 1;
}

# Republicar una versión que ya salió —o una menor que la última— deja la app
# ofreciendo algo que ya tiene, o nada.
if gh release view "v${VERSION}" --repo "${OWNER}/${REPO}" >/dev/null 2>&1; then
    echo "La v${VERSION} ya está publicada. Subí la versión: node tools/subir-version.js"
    exit 1
fi

ULTIMA=$(gh release view --repo "${OWNER}/${REPO}" --json tagName --jq .tagName 2>/dev/null || echo "")
if [ -n "$ULTIMA" ]; then
    if [ "$(node -p "require('./engine/actualizaciones').comparar('${VERSION}', '${ULTIMA}')")" -le 0 ]; then
        echo "La ${VERSION} no es posterior a la ${ULTIMA}, que es la última publicada."
        echo "GitHub la daría como 'latest' igual y la app no vería nada nuevo."
        exit 1
    fi
fi

echo "→ publicando v${VERSION} en ${OWNER}/${REPO}"
if [ -n "$NOTAS" ]; then
    echo "   notas: $NOTAS"
    gh release create "v${VERSION}" "$PKG" \
        --repo "${OWNER}/${REPO}" \
        --title "Reviewer ${VERSION}" \
        --notes-file "$NOTAS"
else
    gh release create "v${VERSION}" "$PKG" \
        --repo "${OWNER}/${REPO}" \
        --title "Reviewer ${VERSION}" \
        --notes "$(cat <<'TEXTO'
Instalador de Reviewer para Macs con Apple Silicon.

Para actualizar: abrí el .pkg que está acá abajo. Reemplaza la app y deja tus
ajustes, los comentarios y el modelo del dictado donde están.

macOS va a avisar que no sabe quién hizo el instalador, porque no está firmado
con un Developer ID de Apple. Clic derecho sobre el .pkg → Abrir.
TEXTO
)"
fi

echo ""
echo "Publicado. Las apps instaladas lo ven al abrirse, o con"
echo "Ajustes → Actualizaciones → Buscar actualizaciones."
