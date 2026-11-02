@echo off
setlocal enabledelayedexpansion
title sunscraping - Auto Installer
color 0f
chcp 65001 >nul 2>&1
cd /d "%~dp0"

echo.
echo   ╔══════════════════════════════════════════╗
echo   ║   sunscraping — 1-CLICK AUTO SETUP      ║
echo   ╚══════════════════════════════════════════╝
echo.

:: ─────────────────────────────────────────────
:: 1. CHECK PYTHON
:: ─────────────────────────────────────────────
echo   [1/4] Memeriksa Python...

python --version >nul 2>&1
IF %ERRORLEVEL% NEQ 0 (
    echo   [!] Python belum terinstall.
    echo   [*] Mendownload Python 3.11.8 dari python.org...
    echo.
    
    curl -L --fail -# -o python_installer.exe https://www.python.org/ftp/python/3.11.8/python-3.11.8-amd64.exe
    
    IF NOT EXIST python_installer.exe (
        echo   [ERROR] Download gagal! Periksa koneksi internet.
        pause
        exit /b 1
    )
    
    :: Verify file size (minimum ~25MB for a valid installer)
    for %%I in (python_installer.exe) do set FILESIZE=%%~zI
    if !FILESIZE! LSS 25000000 (
        echo   [ERROR] File installer corrupt (terlalu kecil: !FILESIZE! bytes^).
        echo   [*] Hapus file dan coba lagi.
        del python_installer.exe 2>nul
        pause
        exit /b 1
    )

    :: Verify Authenticode signature before running the installer
    echo   [*] Memverifikasi tanda tangan digital installer...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "$s = Get-AuthenticodeSignature '%~dp0python_installer.exe'; if ($s.Status -ne 'Valid' -or $s.SignerCertificate.Subject -notlike '*Python Software Foundation*') { exit 1 }"
    if errorlevel 1 (
        echo   [ERROR] Verifikasi tanda tangan digital gagal^!
        echo   [*] File installer tidak berasal dari Python Software Foundation.
        echo   [*] Hapus python_installer.exe lalu download manual dari python.org.
        del python_installer.exe 2>nul
        pause
        exit /b 1
    )
    echo   [OK] Tanda tangan digital valid.
    
    echo   [*] Menginstall Python secara otomatis...
    start /wait python_installer.exe /quiet InstallAllUsers=0 PrependPath=1 Include_test=0 Include_doc=0
    
    if errorlevel 1 (
        echo   [ERROR] Instalasi Python gagal (exit code: %ERRORLEVEL%^).
        del python_installer.exe 2>nul
        pause
        exit /b 1
    )
    
    del python_installer.exe 2>nul
    
    echo.
    echo   ╔══════════════════════════════════════════╗
    echo   ║   PYTHON BERHASIL DIINSTALL!             ║
    echo   ╠══════════════════════════════════════════╣
    echo   ║   Karena PATH baru saja diperbarui,      ║
    echo   ║   TUTUP jendela ini lalu jalankan lagi.   ║
    echo   ╚══════════════════════════════════════════╝
    echo.
    pause
    exit /b 0
)

for /f "tokens=*" %%i in ('python --version 2^>^&1') do set PYVER=%%i
echo   [OK] %PYVER% terdeteksi.

:: Supported range is 3.10 - 3.12 (pandas 2.2.2 has no wheels for 3.13+)
python -c "import sys; sys.exit(0 if (3, 10) <= sys.version_info[:2] <= (3, 12) else 1)" >nul 2>&1
if errorlevel 1 (
    echo   [ERROR] Versi Python tidak didukung.
    echo   [*] sunscraping membutuhkan Python 3.10 - 3.12.
    echo   [*] Download: https://www.python.org/downloads/
    pause
    exit /b 1
)

:: ─────────────────────────────────────────────
:: 2. INSTALL DEPENDENCIES
:: ─────────────────────────────────────────────
echo   [2/4] Memeriksa dan menginstall dependencies...

cd backend
IF ERRORLEVEL 1 (
    echo   [ERROR] Folder backend tidak ditemukan.
    pause
    exit /b 1
)
python -m pip install --upgrade pip -q >nul 2>&1
python -m pip install -r requirements.txt -q

IF %ERRORLEVEL% NEQ 0 (
    echo   [ERROR] Gagal menginstall dependencies!
    echo   [*] Coba jalankan manual: cd backend ^&^& python -m pip install -r requirements.txt
    cd ..
    pause
    exit /b 1
)

echo   [OK] Semua dependencies terinstall.
cd ..

:: ─────────────────────────────────────────────
:: 3. VERIFY BACKEND CAN START
:: ─────────────────────────────────────────────
echo   [3/4] Memverifikasi backend...

cd backend
python -c "import flask; import pandas; import database; print('OK')" >nul 2>&1
IF %ERRORLEVEL% NEQ 0 (
    echo   [ERROR] Import module gagal! Periksa requirements.
    cd ..
    pause
    exit /b 1
)
cd ..
echo   [OK] Semua modul siap.

:: ─────────────────────────────────────────────
:: 4. LAUNCH
:: ─────────────────────────────────────────────
echo   [4/4] Membuka Control Panel...
echo.

start SocialAuditor.hta

echo   ╔══════════════════════════════════════════╗
echo   ║   SETUP SELESAI! Control Panel terbuka.  ║
echo   ║   Jendela ini akan tertutup otomatis.    ║
echo   ╚══════════════════════════════════════════╝

timeout /t 3 >nul
exit
