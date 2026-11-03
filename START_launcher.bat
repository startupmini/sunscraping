@echo off
setlocal
title sunscraping - Launcher
chcp 65001 >nul 2>&1
cd /d "%~dp0"

set "PYTHONIOENCODING=utf-8"

where python >nul 2>&1
if errorlevel 1 (
    echo.
    echo   Python belum terpasang atau belum ada di PATH.
    echo   Jalankan INSTALL_sunscraping.bat terlebih dahulu.
    echo.
    pause
    exit /b 1
)

if not exist "%~dp0launcher.py" (
    echo.
    echo   File launcher.py tidak ditemukan di folder ini.
    echo.
    pause
    exit /b 1
)

where pythonw >nul 2>&1
if errorlevel 1 (
    echo   Menjalankan launcher dengan jendela konsol...
    python "%~dp0launcher.py"
) else (
    start "" /b pythonw "%~dp0launcher.py"
)
