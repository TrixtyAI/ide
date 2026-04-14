<#
.SYNOPSIS
    Builds Trixty IDE for Windows x64.
.DESCRIPTION
    Installs dependencies, compiles typescript, and generates the final user setup installer via Inno Setup.
#>

$ErrorActionPreference = "Stop"
$WorkingDir = (Get-Item $PSScriptRoot).Parent.FullName

Set-Location $WorkingDir

Write-Host ">>> [1/4] Instalando dependencias de Node (npm)..." -ForegroundColor Cyan
npm install

Write-Host ">>> [Rebuilding] Native modules for Electron 39.8.7 (ABI 140)..." -ForegroundColor Cyan
$ELECTRON_VER = "39.8.7"
$NODE_GYP = "$WorkingDir\build\npm\gyp\node_modules\.bin\node-gyp.cmd"

# Core native modules to rebuild
$NativeModules = @(
    "@vscode/policy-watcher",
    "@vscode/spdlog",
    "node-pty",
    "native-keymap",
    "@vscode/sqlite3",
    "@vscode/windows-mutex",
    "@vscode/windows-process-tree",
    "@vscode/windows-registry"
)

foreach ($module in $NativeModules) {
    if (Test-Path "node_modules\$module") {
        Write-Host "   -> Rebuilding $module..." -ForegroundColor Gray
        Push-Location "node_modules\$module"
        try {
            & $NODE_GYP rebuild --target=$ELECTRON_VER --arch=x64 --dist-url=https://electronjs.org/headers
        } catch {
            Write-Host "   [ERROR] Failed to rebuild $module" -ForegroundColor Red
        }
        Pop-Location
    }
}

Write-Host ">>> [2/4] Compilando y empaquetando Trixty IDE (win32-x64-min)..." -ForegroundColor Cyan
npx gulp trixty-win32-x64-min

Write-Host ">>> [3/4] Generando instalador de Trixty IDE (User Setup)..." -ForegroundColor Cyan
npx gulp trixty-win32-x64-user-setup

Write-Host ">>> [4/4] Verificando archivos de configuracion..." -ForegroundColor Cyan
if (Test-Path "..\Trixty-win32-x64\resources\app\product.json") {
    Write-Host ">>> [LISTO] product.json encontrado en el build." -ForegroundColor Green
} else {
    Write-Host ">>> [ADVERTENCIA] No se encontro product.json en ..\Trixty-win32-x64\resources\app\" -ForegroundColor Yellow
}

Write-Host ">>> [COMPLETADO] El instalador deberia estar en el directorio root padre (.build/win32-x64/user-setup)." -ForegroundColor Green
