@echo off
:: sunscraping — Hidden Server Runner
:: Called by SocialAuditor.hta to run server without visible console window
cd /d "%~dp0"
cd backend

:: Only install dependencies when an import is actually missing
python -c "import flask, flask_cors, pandas, openpyxl" >nul 2>&1
if errorlevel 1 (
    python -m pip install -r requirements.txt -q >> server_log.txt 2>&1
)

:: Rotate log when it grows past 5 MB
if exist server_log.txt (
    for %%A in (server_log.txt) do if %%~zA GTR 5242880 (
        del /q server_log.old 2>nul
        move /y server_log.txt server_log.old >nul
    )
)

:: Start server (output goes to log file)
python app.py >> server_log.txt 2>&1
