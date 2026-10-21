@echo off
setlocal
cd /d "%~dp0server"
if not exist node_modules (
  echo First-time setup: installing FreshNest server packages...
  call npm install
  if errorlevel 1 (
    echo.
    echo Installation failed. Check that Node.js and npm are installed and internet is available.
    pause
    exit /b 1
  )
)
echo.
echo Starting FreshNest website and API...
echo Open http://localhost:3000 in your browser.
echo Keep this window open while using FreshNest.
echo Press Ctrl+C to stop the server.
echo.
call npm start
pause
