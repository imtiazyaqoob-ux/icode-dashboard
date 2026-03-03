@echo off
cd /d "%~dp0"
echo Starting iCode Glen Ellyn Dashboard...
start http://localhost:3000
node server.js
pause
