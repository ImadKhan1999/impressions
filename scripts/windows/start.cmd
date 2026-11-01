@echo off
setlocal
rem Starts the Redirect & Compatibility Checker and opens it in your default browser.
rem Close this window (or press Ctrl+C) to stop; running tests are paused and can be resumed.
title Redirect ^& Compatibility Checker
cd /d "%~dp0..\.."

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install Node.js 22 LTS from https://nodejs.org/ and run scripts\windows\setup.cmd first.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo Dependencies are not installed. Running setup first...
  call "%~dp0setup.cmd"
  if errorlevel 1 exit /b 1
)

if not exist "apps\server\dist\index.js" goto build
if not exist "apps\web\dist\index.html" goto build
goto run

:build
echo Building the app (first run only)...
call npm.cmd run build
if errorlevel 1 (
  echo Build failed. See the messages above.
  pause
  exit /b 1
)

:run
if "%OPEN_BROWSER%"=="" set OPEN_BROWSER=1
node apps\server\dist\index.js
set EXITCODE=%ERRORLEVEL%
if not "%EXITCODE%"=="0" (
  echo.
  echo The app stopped with exit code %EXITCODE%. See the messages above.
  pause
)
exit /b %EXITCODE%
