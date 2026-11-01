@echo off
rem Double-click to run first-time setup. Arguments are passed on, e.g. setup.cmd -ChromiumOnly
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1" %*
set EXITCODE=%ERRORLEVEL%
echo.
pause
exit /b %EXITCODE%
