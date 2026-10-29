@echo off
chcp 65001 >nul
cd /d "%~dp0"
title MedAI
color 0A

echo.
echo   ============================================
echo      MedAI  -  Intelligent Medical Assistant
echo   ============================================
echo.

netstat -ano | findstr /C:":3100" | findstr /C:"LISTENING" >nul 2>&1
if not errorlevel 1 (
    echo   [OK] Server is already running.
    echo   [..] Opening http://localhost:3100
    start "" http://localhost:3100
    ping -n 3 127.0.0.1 >nul
    exit /b 0
)

REM ---- 首次准备的三件事：配置文件 / 依赖 / Prisma 客户端 + 空库 ----
REM 这三步任何一步缺了都表现为"页面能开、一登录就 500"，
REM 所以启动前统一补齐，不指望用户自己记得跑。

if not exist ".env" (
    echo   [..] No .env found, creating a default one from .env.example ...
    copy /Y ".env.example" ".env" >nul
    echo   [!!] Edit .env and set DEEPSEEK_API_KEY if you want real AI answers.
    echo        Without it, set MEDAI_DEMO_AI=1 to use the offline demo replies.
    echo.
)

if not exist "node_modules" (
    echo   [..] Installing dependencies, this takes a few minutes on first run...
    call npm ci
    if errorlevel 1 (
        echo.
        echo   [X] npm ci failed. Check your network, then run this file again.
        pause
        exit /b 1
    )
)

if not exist "node_modules\.prisma\client\index.js" (
    echo   [..] Generating Prisma client...
    call npx prisma generate
    if errorlevel 1 (
        echo.
        echo   [X] prisma generate failed.
        pause
        exit /b 1
    )
)

if not exist "prisma\dev.db" (
    echo   [..] Creating the database...
    call npx prisma db push --skip-generate
    if errorlevel 1 (
        echo.
        echo   [X] prisma db push failed.
        pause
        exit /b 1
    )
)

if not exist ".next\BUILD_ID" (
    echo   [..] First run: building the app, please wait 1-2 minutes...
    echo.
    call npx next build
    if errorlevel 1 (
        echo.
        echo   [X] Build failed. Please send this window's text to the assistant.
        pause
        exit /b 1
    )
)

echo   [..] Starting server, browser opens in 4 seconds.
echo   [!!] KEEP THIS WINDOW OPEN while using the site.
echo        Press Ctrl+C or close this window to stop it.
echo.

start "" /min cmd /c "ping -n 5 127.0.0.1 >nul & start http://localhost:3100"

call npx next start -p 3100

echo.
echo   Server stopped.
pause
