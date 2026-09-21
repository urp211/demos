@echo off
setlocal
cd /d "%~dp0"
echo Installing dependencies...
npm install
if errorlevel 1 exit /b 1
echo Building Signal TV installer...
npm run dist:win
if errorlevel 1 exit /b 1
echo Done. Check the release folder.
pause
