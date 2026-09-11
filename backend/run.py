"""ODrive GUI 启动入口 Entry point.

用法:
    python run.py                # 真实硬件模式 (USB)
    python run.py --mock         # 模拟设备模式，无需硬件
    python run.py --port 8000 --host 127.0.0.1 [--open]
"""
import argparse
import os
import socket
import threading
import time
import webbrowser


def _open_when_ready(host: str, port: int, timeout: float = 60.0) -> None:
    """等服务真正监听后再打开浏览器，避免出现“无法访问此网站”。"""
    url = f"http://{host}:{port}"
    deadline = time.time() + timeout
    while time.time() < deadline:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(0.5)
            if s.connect_ex((host, port)) == 0:
                time.sleep(0.3)
                webbrowser.open(url)
                return
        time.sleep(0.3)
    print(f"服务启动超时，请手动访问 open manually: {url}")


def main() -> None:
    parser = argparse.ArgumentParser(description="ODrive GUI backend")
    parser.add_argument("--mock", action="store_true",
                        help="模拟设备模式 (mock device mode, no hardware needed)")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--open", action="store_true",
                        help="启动后自动打开浏览器 (open browser after start)")
    args = parser.parse_args()

    if args.mock:
        os.environ["ODRIVE_GUI_MOCK"] = "1"

    import uvicorn
    from app.main import app  # noqa: PLC0415 (延迟导入以便先设置环境变量)

    if args.open:
        threading.Thread(target=_open_when_ready,
                         args=(args.host, args.port), daemon=True).start()

    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
