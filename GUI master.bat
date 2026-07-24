@echo off
chcp 65001 >nul
cd /d "%~dp0"

set PORT=8765
set URL=http://127.0.0.1:%PORT%/
set "PYEXE="

echo.
echo  GUI Draw Master
echo  ---------------
echo.

REM 1) Явный путь Inkscape (часто есть на ПК без «нормального» Python)
if exist "C:\Program Files\Inkscape\bin\python.exe" (
  set "PYEXE=C:\Program Files\Inkscape\bin\python.exe"
)

REM 2) py launcher
if not defined PYEXE (
  where py >nul 2>&1
  if not errorlevel 1 (
    for /f "delims=" %%i in ('where py') do (
      set "PYEXE=%%i"
      goto :have_py
    )
  )
)
:have_py

REM 3) python из PATH, но не заглушка Microsoft Store
if not defined PYEXE (
  where python >nul 2>&1
  if not errorlevel 1 (
    for /f "delims=" %%i in ('where python') do (
      echo %%i | find /i "WindowsApps" >nul
      if errorlevel 1 (
        set "PYEXE=%%i"
        goto :have_python
      )
    )
  )
)
:have_python

if not defined PYEXE (
  echo  [Ошибка] Python не найден.
  echo  Установите Python с https://www.python.org/downloads/
  echo  ^(галочка «Add python.exe to PATH»^) или Inkscape.
  echo.
  pause
  exit /b 1
)

REM Проверка, что это не Store-заглушка и http.server доступен
"%PYEXE%" -c "import http.server" >nul 2>&1
if errorlevel 1 (
  echo  [Ошибка] "%PYEXE%"
  echo  не может запустить модуль http.server.
  echo  Установите Python с python.org ^(не из Microsoft Store^).
  echo.
  pause
  exit /b 1
)

echo  Python: %PYEXE%
echo  Сервер: %URL%
echo  Строки ниже — обычный лог запросов браузера ^(это нормально^).
echo  Закройте это окно, чтобы остановить сервер.
echo.

REM Открыть браузер через 1 сек после старта сервера (без кривых кавычек)
start /b cmd /c "timeout /t 1 /nobreak >nul & start %URL%"

"%PYEXE%" -m http.server %PORT%
if errorlevel 1 (
  echo.
  echo  [Ошибка] Не удалось слушать порт %PORT%.
  echo  Возможно, порт занят — закройте другое окно GUI master.bat
  echo  или смените PORT в этом файле.
  echo.
  pause
)
