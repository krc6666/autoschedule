@echo off
setlocal
cd /d "%~dp0"

where py >nul 2>nul
if %errorlevel%==0 (
  py dev.py
) else (
  python dev.py
)

if not %errorlevel%==0 (
  echo.
  echo 启动失败，以上是具体错误信息。
  pause
)
