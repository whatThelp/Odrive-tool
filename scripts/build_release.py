"""打包为独立可执行程序 Build standalone executable (PyInstaller).

两种产物 Two build modes:

    python scripts/build_release.py              # 默认: 快速版 (onedir)
    python scripts/build_release.py --onefile    # 便携版: 单文件
    python scripts/build_release.py --both       # 两个都构建

产物 Output:
    dist/odrive-gui/odrive-gui.exe   快速版，启动约 2 秒（推荐日常使用）
    dist/odrive-gui-portable.exe     单文件便携版，每次启动需解包约 15 秒

说明：单文件模式每次运行都要把全部内容解压到临时目录，启动明显更慢；
目录模式免解包，因此作为默认产物。
"""
from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SEP = ";" if sys.platform == "win32" else ":"


def _ensure_pyinstaller() -> None:
    try:
        import PyInstaller  # noqa: F401
    except ImportError:
        print("安装 PyInstaller ...")
        subprocess.check_call([sys.executable, "-m", "pip", "install", "pyinstaller"])


def _common_args(name: str) -> list[str]:
    args = [
        sys.executable, "-m", "PyInstaller",
        "--name", name,
        "--noconfirm",
        "--distpath", str(ROOT / "dist"),
        "--workpath", str(ROOT / "build"),
        "--specpath", str(ROOT / "build"),
        # 前端(免构建 ESM)与固件定义 JSON 一并打包
        "--add-data", f"{ROOT / 'frontend'}{SEP}frontend",
        "--add-data", f"{ROOT / 'backend' / 'app' / 'firmware'}{SEP}app/firmware",
        "--hidden-import", "uvicorn.logging",
        "--hidden-import", "uvicorn.loops.auto",
        "--hidden-import", "uvicorn.protocols.http.auto",
        "--hidden-import", "uvicorn.protocols.websockets.auto",
        "--hidden-import", "uvicorn.lifespan.on",
    ]
    # 真实硬件库为可选依赖：装了就整包收集（odrive 内含 libfibre DLL 等数据文件）
    for optional in ("odrive", "serial", "can"):
        try:
            __import__(optional)
            args += ["--collect-all", optional]
        except ImportError:
            pass
    args.append(str(ROOT / "backend" / "run_packaged.py"))
    return args


def build(onefile: bool) -> Path:
    name = "odrive-gui-portable" if onefile else "odrive-gui"
    args = _common_args(name)
    args.insert(3, "--onefile" if onefile else "--onedir")
    print(f"\n>>> 构建 {'单文件便携版' if onefile else '快速版 (目录)'}: {name}\n")
    subprocess.check_call(args, cwd=ROOT)
    exe = ".exe" if sys.platform == "win32" else ""
    return (ROOT / "dist" / f"{name}{exe}") if onefile \
        else (ROOT / "dist" / name / f"{name}{exe}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Build ODrive GUI executable")
    parser.add_argument("--onefile", action="store_true",
                        help="只构建单文件便携版 (portable single file)")
    parser.add_argument("--both", action="store_true",
                        help="两种产物都构建 (build both)")
    args = parser.parse_args()

    _ensure_pyinstaller()

    targets = [False, True] if args.both else [bool(args.onefile)]
    made = [build(onefile) for onefile in targets]

    shutil.rmtree(ROOT / "build", ignore_errors=True)
    print("\n完成 Done:")
    for p in made:
        size = p.stat().st_size / 1024 / 1024 if p.exists() else 0
        print(f"  {p}  ({size:.1f} MB)")


if __name__ == "__main__":
    main()
