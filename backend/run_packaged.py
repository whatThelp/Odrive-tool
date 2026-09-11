"""独立可执行文件入口 Packaged entry: 启动服务并在服务就绪后打开浏览器。

用法 Usage:
    odrive-gui.exe                 # 真实硬件模式
    odrive-gui.exe --mock          # 模拟设备模式（无需硬件）
    odrive-gui.exe --port 8080     # 指定端口
    odrive-gui.exe --no-browser    # 不自动打开浏览器
"""
import argparse
import os
import socket
import sys
import threading
import time
import webbrowser


def _port_free(host: str, port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.4)
        return s.connect_ex((host, port)) != 0


def _pick_port(host: str, port: int) -> int:
    """端口被占用时自动顺延，避免启动即失败。"""
    for candidate in range(port, port + 20):
        if _port_free(host, candidate):
            return candidate
    return port


def _open_when_ready(host: str, port: int, timeout: float = 120.0) -> None:
    """轮询直到 HTTP 服务真正可连接后再打开浏览器。

    打包为单文件时解包需要数秒，过早打开浏览器会显示“无法访问此网站”，
    这正是双击后看似“打不开”的原因。
    """
    url = f"http://{host}:{port}"
    deadline = time.time() + timeout
    while time.time() < deadline:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(0.5)
            if s.connect_ex((host, port)) == 0:
                time.sleep(0.4)          # 让 uvicorn 完成最后的路由挂载
                print(f"\n服务已就绪，正在打开浏览器… Ready: {url}\n", flush=True)
                try:
                    webbrowser.open(url)
                except Exception:
                    print(f"浏览器打开失败，请手动访问 Please open manually: {url}",
                          flush=True)
                return
        time.sleep(0.3)
    print(f"\n服务启动超时，请手动访问 Timed out, open manually: {url}\n", flush=True)


def main() -> None:
    parser = argparse.ArgumentParser(description="ODrive GUI")
    parser.add_argument("--mock", action="store_true",
                        help="模拟设备模式 (mock device mode)")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--no-browser", action="store_true",
                        help="不自动打开浏览器 (do not open browser)")
    args = parser.parse_args()

    # 打包运行时数据目录放到用户目录，避免写入只读位置
    if getattr(sys, "frozen", False):
        data = os.path.join(os.path.expanduser("~"), ".odrive-gui")
        os.environ.setdefault("ODRIVE_GUI_DATA", data)
    if args.mock:
        os.environ["ODRIVE_GUI_MOCK"] = "1"

    mode = "模拟模式 MOCK" if args.mock else "真实硬件 REAL"
    print("=" * 58, flush=True)
    print(f"  ODrive 上位机 Host Controller   [{mode}]", flush=True)
    print("  正在启动，首次启动需要数秒，请稍候…", flush=True)
    print("  Starting up, this may take a few seconds…", flush=True)
    print("=" * 58, flush=True)

    import uvicorn
    from app.main import app

    port = _pick_port(args.host, args.port)
    if port != args.port:
        print(f"端口 {args.port} 被占用，改用 {port} "
              f"(port busy, using {port})", flush=True)
    url = f"http://{args.host}:{port}"

    if not args.no_browser:
        threading.Thread(target=_open_when_ready, args=(args.host, port),
                         daemon=True).start()
    print(f"服务地址 URL: {url}    按 Ctrl+C 退出 (Ctrl+C to quit)", flush=True)

    try:
        uvicorn.run(app, host=args.host, port=port, log_level="warning")
    except KeyboardInterrupt:
        pass
    except Exception as e:                                    # noqa: BLE001
        print(f"\n启动失败 Startup failed: {e}", flush=True)
        if getattr(sys, "frozen", False):
            input("按回车键退出 Press Enter to exit...")
        raise


if __name__ == "__main__":
    main()
