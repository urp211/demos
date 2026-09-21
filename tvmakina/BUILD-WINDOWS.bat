@echo off
REM ============================================================
REM  TVmakina - gerador do instalador para Windows
REM  Corra este ficheiro num PC COM Node.js (nao precisa de ser
REM  o PC fraco onde o TVmakina vai correr).
REM ============================================================
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo [ERRO] O Node.js nao esta instalado neste computador.
  echo        Instale o Node.js 18 LTS ou mais recente em https://nodejs.org
  echo        e volte a executar este ficheiro.
  echo.
  pause
  exit /b 1
)

echo.
echo [1/4] A instalar as ferramentas de compilacao...
set ELECTRON_SKIP_BINARY_DOWNLOAD=1
call npm install --no-save --no-audit --no-fund electron@22.3.27 electron-builder@24.13.3 acorn@^8.15.0 jsdom@^24.1.3
if errorlevel 1 goto :erro

echo.
echo [2/4] A verificar que o codigo continua compativel com browsers antigos...
call npm run check
if errorlevel 1 goto :erro

echo.
echo [3/4] A correr os testes...
call npm test
if errorlevel 1 goto :erro

echo.
echo [4/4] A gerar o instalador e a versao portatil (64 e 32 bits)...
call npm run icons
call npm run build
call npx electron-builder --win nsis portable --x64 --ia32 --publish never
if errorlevel 1 goto :erro

echo.
echo ============================================================
echo  Concluido. Os ficheiros estao na pasta "release":
echo    TVmakina-Setup-1.0.0-x64.exe    instalador para Windows 64 bits
echo    TVmakina-Setup-1.0.0-ia32.exe   instalador para Windows 32 bits
echo    TVmakina-Portatil-1.0.0-*.exe   versao portatil (nao instala nada)
echo.
echo  Tambem ficou disponivel a versao de browser em "dist\TVmakina.html"
echo ============================================================
pause
exit /b 0

:erro
echo.
echo [ERRO] A compilacao falhou. Veja as mensagens acima.
pause
exit /b 1
