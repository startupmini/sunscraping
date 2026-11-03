@echo off
setlocal
cd /d "%~dp0"

rem One-click live audit: install what is missing, then follow the file to done.
rem Usage:  RUN_live_audit.bat            (uses C:\Users\Vv\Downloads\link.xlsx)
rem         RUN_live_audit.bat "D:\data\link2.xlsx"

set "TARGET=%~1"
if "%TARGET%"=="" set "TARGET=C:\Users\Vv\Downloads\link.xlsx"
if not exist "%TARGET%" (
    echo File tidak ditemukan: %TARGET%
    echo Contoh: RUN_live_audit.bat "D:\path\file.xlsx"
    pause
    exit /b 1
)

where python >nul 2>nul
if errorlevel 1 (
    echo Python tidak ditemukan. Pasang Python 3.10-3.12 dulu.
    pause
    exit /b 1
)

set "PYTHONIOENCODING=utf-8"

python -c "import flask, flask_cors, pandas, openpyxl" >nul 2>&1
if errorlevel 1 (
    echo Memasang dependencies backend, mungkin perlu beberapa menit...
    python -m pip install -r backend\requirements.txt
    if errorlevel 1 (
        echo Gagal memasang dependencies. Lihat pesan di atas.
        pause
        exit /b 1
    )
)

python tools\live_audit.py --file "%TARGET%" --name "Uji live" --wait --export

echo.
echo ============================================================
echo   Jendela ini akan tetap terbuka supaya outputnya terbaca.
echo   Jalankan lagi nanti bila ada yang belum selesai:
echo     python tools\live_audit.py --watch --export
echo ============================================================
pause
