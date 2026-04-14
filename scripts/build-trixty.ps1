<#
.SYNOPSIS
    Builds Trixty IDE for Windows x64.
.DESCRIPTION
    Installs dependencies, compiles typescript, and generates the final user setup installer via Inno Setup.
#>

$ErrorActionPreference = "Stop"
$WorkingDir = (Get-Item $PSScriptRoot).Parent.FullName

Set-Location $WorkingDir

Write-Host ">>> [1/4] Instalando dependencias de Node (yarn)..." -ForegroundColor Cyan
yarn install

Write-Host ">>> [2/4] Compilando paquetes web & node..." -ForegroundColor Cyan
yarn run gulp compile-build
yarn run gulp compile-extensions-build
yarn run gulp compile-extension-media-build

Write-Host ">>> [3/4] Generando distribucion Minificada (win32-x64)..." -ForegroundColor Cyan
yarn run gulp vscode-win32-x64-min

Write-Host ">>> [4/4] Compilando instalador INNO User Setup..." -ForegroundColor Cyan
yarn run gulp vscode-win32-x64-user-setup

Write-Host ">>> [COMPLETADO] El instalador deberia estar en el directorio root padre (win32-x64-user-setup)." -ForegroundColor Green
