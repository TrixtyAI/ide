#!/usr/bin/env bash

set -e

# Trixty IDE Build Script (Linux / macOS)
WORKING_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$WORKING_DIR"

echo ">>> [1/4] Instalando dependencias de Node (npm)..."
npm install

echo ">>> [Rebuilding] Native modules for Electron 39.8.7 (ABI 140)..."
ELECTRON_VER="39.8.7"
NODE_GYP="./build/npm/gyp/node_modules/.bin/node-gyp"

# Core native modules to rebuild
NATIVE_MODULES=(
    "@vscode/policy-watcher"
    "@vscode/spdlog"
    "node-pty"
    "native-keymap"
    "@vscode/sqlite3"
)

# Determine Arch
ARCH="x64"
if [[ "$OSTYPE" == "darwin"* ]]; then
  ARCH="arm64"
fi

for module in "${NATIVE_MODULES[@]}"; do
    if [ -d "node_modules/$module" ]; then
        echo "   -> Rebuilding $module..."
        pushd "node_modules/$module" > /dev/null
        $NODE_GYP rebuild --target=$ELECTRON_VER --arch=$ARCH --dist-url=https://electronjs.org/headers || echo "   [ERROR] Failed to rebuild $module"
        popd > /dev/null
    fi
done



# Determine Arch & Platform
if [[ "$OSTYPE" == "darwin"* ]]; then
  echo ">>> [3/4] Generando distribucion Minificada (darwin)..."
  npx gulp vscode-darwin-arm64-min

  echo ">>> [4/4] Empaquetando instalador dmg / app..."
  npx gulp vscode-darwin-arm64-archive
  echo ">>> [COMPLETADO] Empaquetado disponible en base de compilacion darwin (app/dmg)."
else
  echo ">>> [3/4] Generando distribucion Minificada (linux-x64)..."
  npx gulp vscode-linux-x64-min

  echo ">>> [4/4] Empaquetando archivo tar u instalador DEB/RPM..."
  npx gulp vscode-linux-x64-archive
  # Opciones alternativas: vscode-linux-x64-build-deb / build-rpm si se requiere instalar.
  echo ">>> [COMPLETADO] Empaquetado disponible en ../vscode-linux-x64"
fi
