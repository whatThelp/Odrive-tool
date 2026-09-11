@echo off
title ODrive 上位机 Host Controller
cd /d "%~dp0"

rem 关闭可能残留的旧实例，避免端口被占用
taskkill /F /IM odrive-gui.exe >nul 2>&1
taskkill /F /IM odrive-gui-portable.exe >nul 2>&1

rem 优先使用快速版（免解包，约 2 秒启动）
if exist "dist\odrive-gui\odrive-gui.exe" goto fast
if exist "dist\odrive-gui-portable.exe" goto portable
if exist "dist\odrive-gui.exe" goto legacy
if exist ".venv\Scripts\python.exe" goto source
goto noenv

:fast
echo 正在启动 ODrive 上位机（模拟演示，无需硬件）...
echo 浏览器会在服务就绪后自动打开，通常约 2 秒。
echo 请勿关闭本窗口，关闭即退出程序。
echo.
"dist\odrive-gui\odrive-gui.exe" --mock
goto end

:portable
echo 正在启动 ODrive 上位机 便携版（模拟演示，无需硬件）...
echo 单文件版每次需解包，约需 10-20 秒，请耐心等待。
echo 浏览器会在服务就绪后自动打开。请勿关闭本窗口。
echo.
"dist\odrive-gui-portable.exe" --mock
goto end

:legacy
echo 正在启动 ODrive 上位机（模拟演示，无需硬件）...
echo 单文件版每次需解包，约需 10-20 秒，请耐心等待。
echo.
"dist\odrive-gui.exe" --mock
goto end

:source
echo 未找到打包程序，改用源码方式启动...
".venv\Scripts\python.exe" backend\run.py --mock --open
goto end

:noenv
echo [错误] 未找到可执行程序，也未找到 .venv 虚拟环境。
echo.
echo 请先执行以下任一操作：
echo   1. 运行 install.bat 安装依赖
echo   2. 运行 python scripts\build_release.py 生成独立程序
echo.
pause
goto :eof

:end
echo.
echo 程序已退出。
pause