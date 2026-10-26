@echo off
title MAX Auto-post Panel
cd /d "%~dp0"

echo ============================================
echo   MAX Auto-post - launch panel
echo ============================================
echo.

where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js not found. Install Node.js and retry.
    pause
    exit /b 1
)

if /i "%~1"=="/kill" goto kill_first

netstat -ano | findstr ":3001" | findstr "LISTENING" >nul 2>&1
if not errorlevel 1 (
    echo [WARN] Port 3001 is busy (old panel may hang).
    set /p choice="Free port and restart? [y/N]: "
    if /i "%choice%"=="y" goto kill_first
    echo.
    echo Continue without freeing - panel may fail to start.
    echo If it fails, close this window and run:  start-panel.bat /kill
    echo.
    goto run
)

:kill_first
echo Freeing port 3001...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3001" ^| findstr "LISTENING"') do (
    echo   Killing process %%a
    taskkill /F /PID %%a >nul 2>&1
)
timeout /t 2 /nobreak >nul

:run
set NODE_TLS_REJECT_UNAUTHORIZED=0
if not exist ".env" (
    echo [WARN] .env file not found.
    echo   Copy .env.example to .env and put bot token inside.
    echo.
)

if not exist "node_modules" (
    echo Installing dependencies...
    call npm install
    if errorlevel 1 (
        echo [ERROR] Failed to install dependencies.
        pause
        exit /b 1
    )
)

echo.
echo Starting panel at http://localhost:3001 ...
echo Press Ctrl+C to stop.
echo.

start "" cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:3001"

node server.js

pause