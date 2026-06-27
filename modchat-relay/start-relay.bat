@echo off
cd /d "%~dp0"
if not exist node_modules\ws (
  echo Installing dependencies...
  call npm install
)
node server.js
pause
