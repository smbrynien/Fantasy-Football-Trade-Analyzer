@echo off
rem Double-click this file to start the Fantasy Football Trade Analyzer on Windows.
rem It uses the bundled runtime if present, otherwise downloads a private copy of Node.js into .\runtime (once).
setlocal
title Fantasy Football Trade Analyzer
cd /d "%~dp0"
echo ==============================================
echo    Fantasy Football Trade Analyzer
echo ==============================================
set /p NODE_VERSION=<".node-version"
set "ARCH=x64"
if /i "%PROCESSOR_ARCHITECTURE%"=="ARM64" set "ARCH=arm64"
set "NODE_EXE=%~dp0runtime\win-%ARCH%\node.exe"
if exist "%NODE_EXE%" goto run
if exist "%~dp0runtime\win-x64\node.exe" (
  set "NODE_EXE=%~dp0runtime\win-x64\node.exe"
  goto run
)

rem Use an installed Node.js 18+ if there is one.
where node >nul 2>nul
if errorlevel 1 goto download
node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 18 ? 0 : 1)"
if errorlevel 1 goto download
set "NODE_EXE=node"
goto run

:download
echo.
echo First-time setup: downloading the app's engine (Node.js, about 30 MB).
echo This only happens once. Please wait...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; $v='%NODE_VERSION%'.Trim(); $a='%ARCH%'; $z=Join-Path $env:TEMP 'ffta-node.zip'; $t=Join-Path $env:TEMP 'ffta-node'; Invoke-WebRequest -UseBasicParsing -Uri ('https://nodejs.org/dist/v'+$v+'/node-v'+$v+'-win-'+$a+'.zip') -OutFile $z; if (Test-Path $t) { Remove-Item $t -Recurse -Force }; Expand-Archive -Path $z -DestinationPath $t -Force; New-Item -ItemType Directory -Force -Path ('runtime\win-'+$a) | Out-Null; Copy-Item (Join-Path $t ('node-v'+$v+'-win-'+$a+'\node.exe')) ('runtime\win-'+$a+'\node.exe') -Force; Remove-Item $z -Force; Remove-Item $t -Recurse -Force"
if errorlevel 1 (
  echo.
  echo Download failed. Please check your internet connection and double-click this file again.
  pause
  exit /b 1
)

:run
echo.
"%NODE_EXE%" "%~dp0server\index.js" --open
echo.
echo The Trade Analyzer has stopped.
pause
