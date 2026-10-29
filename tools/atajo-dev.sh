#!/bin/bash
#
# tools/atajo-dev.sh — Deja un atajo para abrir Reviewer en desarrollo con
# doble clic, y lo pone en el Dock.
#
#   bash tools/atajo-dev.sh
#   bash tools/atajo-dev.sh --donde ~/Applications
#   bash tools/atajo-dev.sh --sin-dock
#
# Es un `.app` de verdad y no un archivo `.command`, y la diferencia importa:
# el `.command` abre una ventana de Terminal que se queda ahí mientras la app
# corre, y cerrarla la mata. Un `.app` no abre nada: doble clic y aparece la
# ventana, como cualquier programa.
#
# **Esto NO es la app empaquetada.** Es un atajo al árbol de desarrollo: abre
# el código que está en esta carpeta, con los cambios sin compilar y sin
# firmar. Si se mueve o se borra el repo, el atajo deja de andar y lo dice.
# La app de verdad la arma `tools/build-pkg.sh`.
#
set -euo pipefail

cd "$(dirname "$0")/.."
RAIZ="$PWD"

DONDE="$HOME/Desktop"
AL_DOCK=1
while [ $# -gt 0 ]; do
    case "$1" in
        --donde) DONDE="${2:?falta la carpeta}"; shift 2 ;;
        --sin-dock) AL_DOCK=0; shift ;;
        *) echo "No entiendo «$1»."; exit 1 ;;
    esac
done

NOMBRE="Reviewer (Dev)"
APP="$DONDE/$NOMBRE.app"

# El binario de Electron, y NO `node_modules/.bin/electron`.
#
# Ese otro es un script de Node (`#!/usr/bin/env node`) que busca el binario y
# lo lanza, así que necesita `node` en el PATH. Desde una terminal está; con
# doble clic en el Finder, no: el PATH que macOS le da a una app son los cuatro
# directorios del sistema, y Node vive en /opt/homebrew/bin. El síntoma es un
# cartel con el código 127 («comando no encontrado»).
#
# El binario de verdad trae su propio Node adentro, así que llamándolo directo
# el atajo no depende de nada instalado aparte. La ruta relativa sale de
# `path.txt`, que es de donde la lee el propio script.
RELATIVO="node_modules/electron/dist/$(cat node_modules/electron/path.txt 2>/dev/null)"
ELECTRON="$RAIZ/$RELATIVO"

if [ ! -x "$ELECTRON" ]; then
    echo "No está Electron en node_modules. Corré: npm install"
    exit 1
fi

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

# ── El lanzador ──────────────────────────────────────────────────────
#
# La ruta del repo se congela acá, al crear el atajo, y no se busca en tiempo
# de ejecución: un atajo que "encuentra" el repo solo es un atajo que un día
# abre otra copia. Si la carpeta se movió, esto lo dice en vez de fallar en
# silencio.
#
# La salida va a un log y no se tira: cuando algo no arranca, el doble clic no
# deja NADA a la vista —no hay Terminal donde mirar— y sin el archivo la única
# pista sería que no pasó nada. Si Electron sale mal, se ofrece abrirlo.
cat > "$APP/Contents/MacOS/reviewer-dev" <<LANZADOR
#!/bin/bash
RAIZ="$RAIZ"
ELECTRON="\$RAIZ/$RELATIVO"
LOG="\$HOME/Library/Logs/reviewer-dev.log"
ICONO="\$(cd "\$(dirname "\$0")/../Resources" && pwd)/icon.icns"
mkdir -p "\$(dirname "\$LOG")"

# Con \`display dialog\` y no \`display alert\` porque es el único de los dos que
# acepta un icono: con el otro, el cartel sale con una carpeta genérica y no se
# sabe de qué app es.
aviso() {
    /usr/bin/osascript -e "display dialog \"\$1\" with title \"Reviewer (Dev)\" with icon POSIX file \"\$ICONO\" buttons {\"Ver el registro\", \"Cerrar\"} default button \"Cerrar\"" 2>/dev/null \\
        | grep -q "Ver el registro" && /usr/bin/open -a Console "\$LOG"
    exit 1
}

[ -d "\$RAIZ" ] || aviso "La carpeta del proyecto ya no está en \$RAIZ. Volvé a correr tools/atajo-dev.sh desde donde esté ahora."
[ -x "\$ELECTRON" ] || aviso "Falta Electron en node_modules. Corré npm install en \$RAIZ y después npm run atajo."

cd "\$RAIZ"
{
    echo ""
    echo "── \$(date '+%Y-%m-%d %H:%M:%S') ──"
} >> "\$LOG"

"\$ELECTRON" . --dev >> "\$LOG" 2>&1
CODIGO=\$?
# 0 es cerrar la ventana y 143 es un SIGTERM (macOS al apagar). Los dos son
# salidas normales y no tienen por qué avisar nada.
[ \$CODIGO -eq 0 ] || [ \$CODIGO -eq 143 ] || aviso "La app se cerró con el código \$CODIGO. El registro dice por qué."
LANZADOR
chmod +x "$APP/Contents/MacOS/reviewer-dev"

# ── La ficha ─────────────────────────────────────────────────────────
#
# El uso del micrófono va acá además de en `package.json`: corriendo así, la
# app que macOS ve es ESTE bundle, y sin el texto el sistema niega el permiso
# sin preguntar y el dictado se queda mudo sin decir por qué.
#
# El identificador lleva `.dev` a propósito: con el mismo que la app
# empaquetada, los permisos y las preferencias de las dos se pisarían.
cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleName</key>               <string>Reviewer (Dev)</string>
    <key>CFBundleDisplayName</key>        <string>Reviewer (Dev)</string>
    <key>CFBundleExecutable</key>         <string>reviewer-dev</string>
    <key>CFBundleIdentifier</key>         <string>com.codigo.reviewer.dev</string>
    <key>CFBundleIconFile</key>           <string>icon</string>
    <key>CFBundlePackageType</key>        <string>APPL</string>
    <key>CFBundleShortVersionString</key> <string>dev</string>
    <key>LSMinimumSystemVersion</key>     <string>11.0</string>
    <key>NSHighResolutionCapable</key>    <true/>
    <key>NSMicrophoneUsageDescription</key>
    <string>Reviewer escucha el micrófono para que puedas dictar un comentario en vez de escribirlo. El audio se transcribe en esta misma Mac y no se guarda.</string>
</dict>
</plist>
PLIST

[ -f build/icon.icns ] || node tools/hacer-icono.js > /dev/null
cp build/icon.icns "$APP/Contents/Resources/icon.icns"

# Firma ad-hoc. Sin ella macOS trata al bundle como un binario suelto y no le
# da acceso al micrófono, que es justo lo que esto tiene que poder probar.
codesign --force --sign - "$APP" 2>/dev/null || true

# Y se le avisa al Finder, que si no muestra el icono genérico hasta que
# alguien toque la carpeta.
touch "$APP"

# ── El Dock ──────────────────────────────────────────────────────────
#
# Todo por `defaults export` / `defaults import`, en una sola lectura y una
# sola escritura.
#
# La primera versión de esto borraba los duplicados con `PlistBuddy` y agregaba
# el nuevo con `defaults -array-add`, y dejaba DOS iconos iguales. Las dos
# herramientas no hablan con lo mismo: `PlistBuddy` edita a mano el archivo de
# ~/Library/Preferences, mientras que `defaults` —y el Dock— pasan por
# `cfprefsd`, que tiene su propia copia en memoria y la vuelca cuando quiere.
# El borrado tocaba un archivo que `cfprefsd` después pisaba con lo que él
# creía, así que las entradas viejas volvían y la nueva se sumaba encima.
# Leyendo y escribiendo la lista entera por el mismo camino eso no puede pasar.
if [ "$AL_DOCK" = 1 ]; then
    /usr/bin/python3 - "$APP" <<'PYDOCK'
import plistlib
import subprocess
import sys
from urllib.parse import quote, unquote

app = sys.argv[1].rstrip('/')

# El Dock guarda una URL `file://` escapada, no una ruta. Con
# `_CFURLStringType: 15` —el que usa para una baldosa de archivo— y una ruta
# POSIX cruda, el espacio de «Reviewer (Dev).app» la invalida y el Dock la
# reduce a `file:///`: la baldosa aparece, con su nombre, y no abre nada.
url_app = 'file://' + quote(app) + '/'

prefs = plistlib.loads(
    subprocess.run(['defaults', 'export', 'com.apple.dock', '-'],
                   capture_output=True, check=True).stdout
)

def apunta_al_atajo(entrada):
    """Si esta baldosa del Dock es este mismo .app.

    Se compara el camino ya desescapado y sin la barra final, porque el Dock
    reescribe lo que uno le pone: la barra la agrega él y los paréntesis los
    escapa o no según por dónde haya entrado la entrada.
    """
    url = entrada.get('tile-data', {}).get('file-data', {}).get('_CFURLString', '')
    if not isinstance(url, str):
        return False
    camino = unquote(url)
    if camino.startswith('file://'):
        camino = camino[len('file://'):]
    return camino.rstrip('/') == app

prefs['persistent-apps'] = [e for e in prefs.get('persistent-apps', [])
                            if not apunta_al_atajo(e)] + [{
    'tile-data': {'file-data': {'_CFURLString': url_app, '_CFURLStringType': 15}},
    'tile-type': 'file-tile'
}]

subprocess.run(['defaults', 'import', 'com.apple.dock', '-'],
               input=plistlib.dumps(prefs), check=True)
PYDOCK
    /usr/bin/killall Dock 2>/dev/null || true
fi

/usr/bin/killall -u "$USER" Finder 2>/dev/null || true

echo "$APP"
echo ""
echo "Doble clic y abre la app con el código de $RAIZ."
[ "$AL_DOCK" = 1 ] && echo "También quedó en el Dock."
echo "El registro queda en ~/Library/Logs/reviewer-dev.log"
