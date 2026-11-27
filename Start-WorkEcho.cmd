@echo off
cd /d "%~dp0"
if not exist "dist\index.html" (
  call npm.cmd run build
  if errorlevel 1 goto failed
)
node --env-file-if-exists=.env server/index.mjs --open
if errorlevel 1 goto failed
exit /b 0
:failed
pause
exit /b 1
