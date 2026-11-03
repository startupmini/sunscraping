@echo off
:: sunscraping — Hidden Server Runner
:: Called by sunscraping.hta to run server without visible console window
cd /d "%~dp0"
cd backend

if not exist runtime mkdir runtime

:: Log is redirected to a file, so force UTF-8; the default codepage mangles
:: accented usernames and crashes the worker on non-ASCII output.
set "PYTHONIOENCODING=utf-8"

:: Only install dependencies when an import is actually missing
python -c "import flask, flask_cors, pandas, openpyxl" >nul 2>&1
if errorlevel 1 (
    python -m pip install -r requirements.txt -q >> runtime\server_log.txt 2>&1
)

:: Rotate log when it grows past 5 MB
if exist runtime\server_log.txt (
    for %%A in (runtime\server_log.txt) do if %%~zA GTR 5242880 (
        del /q runtime\server_log.old 2>nul
        move /y runtime\server_log.txt runtime\server_log.old >nul
    )
)

:: Start server (absolute path so the Control Panel can find this process by command line)
python "%~dp0backend\app.py" >> runtime\server_log.txt 2>&1
