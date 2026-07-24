@echo off
chcp 65001 >nul
cd /d "%~dp0"

set PORT=8765
set URL=http://127.0.0.1:%PORT%/

echo.
echo  GUI Draw Master
echo  ---------------
echo  Локальный сервер: %URL%
echo  Закройте это окно, чтобы остановить сервер.
echo.

where py >nul 2>&1
if %ERRORLEVEL%==0 (
  start "" cmd /c "timeout /t 1 /nobreak >nul & start \"\" \"%URL%\""
  py -3 -m http.server %PORT%
  goto :eof
)

where python >nul 2>&1
if %ERRORLEVEL%==0 (
  start "" cmd /c "timeout /t 1 /nobreak >nul & start \"\" \"%URL%\""
  python -m http.server %PORT%
  goto :eof
)

if exist "C:\Program Files\Inkscape\bin\python.exe" (
  start "" cmd /c "timeout /t 1 /nobreak >nul & start \"\" \"%URL%\""
  "C:\Program Files\Inkscape\bin\python.exe" -m http.server %PORT%
  goto :eof
)

echo Не найден Python. Откройте index.html через Live Server
echo или установите Python с https://www.python.org/downloads/
pause
