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
# Se escribe en las preferencias y después se reinicia el Dock, que es la única
# forma sin pedirle nada al usuario. Primero se saca cualquier entrada vieja que
# apunte a este mismo atajo: correr el script dos veces no tiene que dejar dos
# iconos.
if [ "$AL_DOCK" = 1 ]; then
    /usr/bin/python3 - "$APP" <<'PYDOCK'
import subprocess
import sys

app = sys.argv[1]

def plist(*args):
    return subprocess.run(['defaults'] + list(args), capture_output=True, text=True)

# Cuántas hay, para recorrerlas de atrás para adelante y que borrar una no
# corra las de abajo.
salida = plist('read', 'com.apple.dock', 'persistent-apps').stdout
cuantas = salida.count('_CFURLString =')

for i in range(cuantas - 1, -1, -1):
    url = plist('read', 'com.apple.dock',
                f'persistent-apps:{i}:tile-data:file-data:_CFURLString').stdout.strip()
    if url.rstrip('/').endswith(app.rstrip('/').replace(' ', '%20')) or url.rstrip('/') == app.rstrip('/'):
        subprocess.run(['/usr/libexec/PlistBuddy', '-c',
                        f'Delete :persistent-apps:{i}',
                        f'{subprocess.os.path.expanduser("~")}/Library/Preferences/com.apple.dock.plist'],
                       capture_output=True)

entrada = ('<dict><key>tile-data</key><dict><key>file-data</key><dict>'
           '<key>_CFURLString</key><string>' + app + '</string>'
           '<key>_CFURLStringType</key><integer>0</integer>'
           '</dict></dict></dict>')
subprocess.run(['defaults', 'write', 'com.apple.dock', 'persistent-apps', '-array-add', entrada],
               check=True)
PYDOCK
    /usr/bin/killall Dock 2>/dev/null || true
fi

/usr/bin/killall -u "$USER" Finder 2>/dev/null || true

echo "$APP"
echo ""
echo "Doble clic y abre la app con el código de $RAIZ."
[ "$AL_DOCK" = 1 ] && echo "También quedó en el Dock."
echo "El registro queda en ~/Library/Logs/reviewer-dev.log"
