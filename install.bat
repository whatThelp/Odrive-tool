@echo off
rem ODrive GUI 安装脚本 (Windows)
rem 创建 Python 虚拟环境并安装依赖；如已安装 Node.js 则一并安装前端开发依赖。
setlocal
cd /d "%~dp0"

echo [1/3] 创建 Python 虚拟环境 Creating venv...
python -m venv .venv || goto :err

echo [2/3] 安装后端依赖 Installing backend deps...
.venv\Scripts\python.exe -m pip install --upgrade pip
.venv\Scripts\python.exe -m pip install -r backend\requirements.txt || goto :err

echo.
echo 是否安装真实硬件支持 (odrive/pyserial/python-can)? 模拟模式无需安装。
choice /C YN /M "Install hardware support libs (Y/N)"
if errorlevel 2 goto :skiphw
.venv\Scripts\python.exe -m pip install -r backend\requirements-hardware.txt
:skiphw

echo [3/3] 安装前端开发依赖 Installing frontend dev deps (可选，需要 Node.js)...
where npm >nul 2>nul
if %errorlevel%==0 (
  pushd frontend && call npm install && popd
) else (
  echo   未检测到 Node.js —— 跳过。不影响直接运行:
  echo   .venv\Scripts\python backend\run.py --mock --open
)

echo.
echo 安装完成 Done!
echo   模拟模式运行:  .venv\Scripts\python backend\run.py --mock --open
echo   真实硬件运行:  .venv\Scripts\python backend\run.py --open
echo   开发模式:      cd frontend ^&^& npm run mock_dev
exit /b 0

:err
echo 安装失败 Installation failed.
exit /b 1
