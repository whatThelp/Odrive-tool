#!/usr/bin/env bash
# ODrive GUI 安装脚本 (Linux / macOS)
set -e
cd "$(dirname "$0")"

echo "[1/3] 创建 Python 虚拟环境 Creating venv..."
python3 -m venv .venv

echo "[2/3] 安装后端依赖 Installing backend deps..."
.venv/bin/python -m pip install --upgrade pip
.venv/bin/python -m pip install -r backend/requirements.txt

read -r -p "是否安装真实硬件支持库 (odrive/pyserial/python-can)? [y/N] " yn
if [[ "$yn" =~ ^[Yy]$ ]]; then
  .venv/bin/python -m pip install -r backend/requirements-hardware.txt
fi

echo "[3/3] 安装前端开发依赖 Installing frontend dev deps (可选，需要 Node.js)..."
if command -v npm >/dev/null 2>&1; then
  (cd frontend && npm install)
else
  echo "  未检测到 Node.js —— 跳过。不影响直接运行:"
  echo "  .venv/bin/python backend/run.py --mock --open"
fi

echo
echo "安装完成 Done!"
echo "  模拟模式运行:  .venv/bin/python backend/run.py --mock --open"
echo "  真实硬件运行:  .venv/bin/python backend/run.py --open"
echo "  开发模式:      cd frontend && npm run mock_dev"
