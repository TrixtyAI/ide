#!/usr/bin/env bash

set -e

# Trixty IDE Build Script (Linux / macOS)
WORKING_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$WORKING_DIR"

echo ">>> [1/4] Instalando dependencias de Node (yarn)..."
yarn install

echo ">>> [2/4] Compilando paquetes web & node..."
yarn run gulp compile-build
yarn run gulp compile-extensions-build
yarn run gulp compile-extension-media-build

# Determine Arch & Platform
if [[ "$OSTYPE" == "darwin"* ]]; then
  echo ">>> [3/4] Generando distribucion Minificada (darwin)..."
  yarn run gulp vscode-darwin-arm64-min
  
  echo ">>> [4/4] Empaquetando instalador dmg / app..."
  yarn run gulp vscode-darwin-arm64-archive
  echo ">>> [COMPLETADO] Empaquetado disponible en base de compilacion darwin (app/dmg)."
else
  echo ">>> [3/4] Generando distribucion Minificada (linux-x64)..."
  yarn run gulp vscode-linux-x64-min
  
  echo ">>> [4/4] Empaquetando archivo tar u instalador DEB/RPM..."
  yarn run gulp vscode-linux-x64-archive
  # Opciones alternativas: vscode-linux-x64-build-deb / build-rpm si se requiere instalar.
  echo ">>> [COMPLETADO] Empaquetado disponible en ../vscode-linux-x64"
fi
