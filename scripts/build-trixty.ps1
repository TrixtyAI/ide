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

Write-Host ">>> [2/4] Compilando paquetes web & node..." -ForegroundColor Cyan
npx gulp compile-build
npx gulp compile-extensions-build
npx gulp compile-extension-media-build

Write-Host ">>> [3/4] Generando distribucion Minificada (win32-x64)..." -ForegroundColor Cyan
npx gulp vscode-win32-x64-min

Write-Host ">>> [4/4] Compilando instalador INNO User Setup..." -ForegroundColor Cyan
npx gulp vscode-win32-x64-user-setup

Write-Host ">>> [COMPLETADO] El instalador deberia estar en el directorio root padre (win32-x64-user-setup)." -ForegroundColor Green
