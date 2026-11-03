@echo off
title sunscraping - Backend Server
color 0A
chcp 65001 >nul 2>&1

echo.
echo   ==========================================
echo          sunscraping - Backend Server
echo   ==========================================
echo.

cd /d "%~dp0"
cd backend

set "PYTHONIOENCODING=utf-8"

echo   [*] Checking dependencies...
python -c "import flask, flask_cors, pandas, openpyxl" >nul 2>&1
if errorlevel 1 (
    python -m pip install -r requirements.txt -q
)

echo   [*] Starting server...
echo   [*] Dashboard will open automatically.
echo.
echo   Press Ctrl+C in this window to stop the server.
echo.

if not defined SA_PORT set "SA_PORT=5000"
start "" powershell -WindowStyle Hidden -Command "Start-Sleep -Seconds 4; Start-Process 'http://localhost:%SA_PORT%'"
python "%~dp0backend\app.py"

pause
