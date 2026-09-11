"""ODrive GUI 后端主应用 FastAPI application."""
from __future__ import annotations

import asyncio
import json
import os
import sys
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Body, FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import console as console_mod
from . import errors_zh, safety
from .device.base import DeviceIOError
from .device.manager import DeviceManager
from .device.mock import MockODrive
from .firmware import expand_interface
from .presets import PresetStore
from .telemetry import TelemetryHub

MOCK_MODE = os.environ.get("ODRIVE_GUI_MOCK", "0") == "1"


def _base_dir() -> Path:
    """打包 (PyInstaller) 与源码运行两种情况下的资源根目录。"""
    if getattr(sys, "frozen", False):
        return Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent))
    return Path(__file__).resolve().parents[2]


BASE_DIR = _base_dir()
FRONTEND_DIR = BASE_DIR / "frontend"
DATA_DIR = Path(os.environ.get("ODRIVE_GUI_DATA", str(BASE_DIR / "data")))
DATA_DIR.mkdir(parents=True, exist_ok=True)

manager = DeviceManager(mock_mode=MOCK_MODE)
hub = TelemetryHub(manager, DATA_DIR)
presets = PresetStore(DATA_DIR)


@asynccontextmanager
async def lifespan(app: FastAPI):
    task = asyncio.create_task(hub.run())
    yield
    task.cancel()


app = FastAPI(title="ODrive GUI", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_methods=["*"], allow_headers=["*"])


@app.middleware("http")
async def no_cache_static(request, call_next):
    """静态资源强制协商缓存，升级后浏览器不会拿到旧版前端文件。"""
    response = await call_next(request)
    if not request.url.path.startswith("/api"):
        response.headers["Cache-Control"] = "no-cache"
    return response


def _err(e: Exception, code: int = 400) -> HTTPException:
    return HTTPException(status_code=code, detail=str(e))


# ------------------------------------------------------------------- status
@app.get("/api/status")
def get_status():
    return {
        "status": manager.status,
        "mock_mode": MOCK_MODE,
        "transports": manager.transports(),
        "device": manager.device.info.as_dict() if manager.device else None,
        "recording": hub.recorder.status(),
        "voltage_range": (safety.voltage_range(manager.device.info.hw_variant)
                          if manager.device else None),
    }


@app.post("/api/scan")
async def scan():
    return {"devices": await manager.scan()}


@app.post("/api/connect")
async def connect(body: dict = Body(default={})):
    try:
        info = await manager.connect(body.get("serial"),
                                     body.get("transport", "usb"),
                                     body.get("options"))
    except DeviceIOError as e:
        raise _err(e)
    return {"device": info}


@app.post("/api/disconnect")
def disconnect():
    manager.disconnect()
    return {"ok": True}


# ---------------------------------------------------------------- interface
@app.get("/api/interface")
def get_interface():
    dev = manager.device
    if dev is None:
        raise _err(DeviceIOError("设备未连接 (not connected)"))
    return expand_interface(dev.info.fw_version, dev.info.axis_count)


# ------------------------------------------------------------------- params
@app.post("/api/params/read")
def params_read(body: dict = Body(...)):
    dev = manager.device
    if dev is None:
        raise _err(DeviceIOError("设备未连接 (not connected)"))
    try:
        return {"values": dev.read_many(list(body.get("paths", [])))}
    except DeviceIOError as e:
        raise _err(e, 503)


@app.get("/api/params/all")
def params_all():
    dev = manager.device
    if dev is None:
        raise _err(DeviceIOError("设备未连接 (not connected)"))
    iface = expand_interface(dev.info.fw_version, dev.info.axis_count)
    paths = [p["path"] for g in iface["groups"] for p in g["params"]]
    try:
        return {"values": dev.read_many(paths)}
    except DeviceIOError as e:
        raise _err(e, 503)


@app.post("/api/params/write")
def params_write(body: dict = Body(...)):
    """变更追踪写入：仅收到实际修改的参数；逐项做硬性安全钳位。"""
    dev = manager.device
    if dev is None:
        raise _err(DeviceIOError("设备未连接 (not connected)"))
    applied, warnings, failed = [], [], []
    for change in body.get("changes", []):
        path, value = change["path"], change["value"]
        value, warn = safety.clamp(path, value, dev.info.hw_variant)
        if warn:
            warnings.append(warn)
        try:
            old = None
            try:
                old = dev.read(path)
            except KeyError:
                pass
            actual = dev.write(path, value)
            applied.append({"path": path, "value": actual, "old": old})
        except KeyError:
            failed.append({"path": path, "reason": "参数不存在 (unknown path)"})
        except DeviceIOError as e:
            failed.append({"path": path, "reason": str(e)})
    return {"applied": applied, "warnings": warnings, "failed": failed}


# ------------------------------------------------------------------ presets
@app.get("/api/presets")
def presets_list():
    return {"presets": presets.list()}


@app.post("/api/presets")
def presets_save(body: dict = Body(...)):
    dev = manager.device
    if dev is None:
        raise _err(DeviceIOError("设备未连接 (not connected)"))
    try:
        p = presets.snapshot(dev, body.get("name", "未命名 Unnamed"),
                             body.get("categories") or None)
    except DeviceIOError as e:
        raise _err(e, 503)
    return {"preset": {k: p[k] for k in ("id", "name", "created", "fw_version",
                                         "categories")}}


@app.get("/api/presets/{preset_id}/diff")
def presets_diff(preset_id: str):
    dev = manager.device
    if dev is None:
        raise _err(DeviceIOError("设备未连接 (not connected)"))
    try:
        return presets.diff(preset_id, dev)
    except FileNotFoundError as e:
        raise _err(e, 404)


@app.post("/api/presets/{preset_id}/apply")
def presets_apply(preset_id: str, body: dict = Body(default={})):
    dev = manager.device
    if dev is None:
        raise _err(DeviceIOError("设备未连接 (not connected)"))
    try:
        preset = presets.get(preset_id)
    except FileNotFoundError as e:
        raise _err(e, 404)
    if not presets.fw_compatible(preset["fw_version"], dev.info.fw_version) \
            and not body.get("force"):
        raise _err(ValueError(
            f"预设固件版本 {preset['fw_version']} 与设备 {dev.info.fw_version} 不兼容，"
            f"如确认无误请使用强制应用 (fw mismatch, use force to override)"))
    applied, warnings, skipped = [], [], []
    for path, want in preset["values"].items():
        want, warn = safety.clamp(path, want, dev.info.hw_variant)
        if warn:
            warnings.append(warn)
        try:
            current = dev.read(path)
            same = (abs(current - want) < 1e-9
                    if isinstance(want, float) and isinstance(current, (int, float))
                    else current == want)
            if same:
                skipped.append(path)
                continue
            actual = dev.write(path, want)
            applied.append({"path": path, "value": actual, "old": current})
        except KeyError:
            skipped.append(path)
        except DeviceIOError as e:
            raise _err(e, 503)
    return {"applied": applied, "skipped_count": len(skipped), "warnings": warnings}


@app.get("/api/presets/{preset_id}/export")
def presets_export(preset_id: str):
    try:
        data = presets.get(preset_id)
    except FileNotFoundError as e:
        raise _err(e, 404)
    return JSONResponse(data, headers={
        "Content-Disposition":
            f"attachment; filename=odrive_preset_{data.get('name', preset_id)}.json"})


@app.post("/api/presets/import")
def presets_import(body: dict = Body(...)):
    try:
        p = presets.import_json(body["json"] if isinstance(body.get("json"), str)
                                else json.dumps(body.get("json")))
    except (ValueError, KeyError, json.JSONDecodeError) as e:
        raise _err(e)
    return {"preset": {k: p[k] for k in ("id", "name", "fw_version")}}


@app.delete("/api/presets/{preset_id}")
def presets_delete(preset_id: str):
    presets.delete(preset_id)
    return {"ok": True}


# ------------------------------------------------------------------ actions
@app.post("/api/actions/{action}")
def do_action(action: str):
    dev = manager.device
    if dev is None:
        raise _err(DeviceIOError("设备未连接 (not connected)"))
    try:
        if action == "estop":
            # 紧急停止: 所有轴立即 IDLE
            if dev.info.transport == "can":
                dev.call("estop")
            else:
                for n in range(dev.info.axis_count):
                    dev.write(f"axis{n}.requested_state", 1)
            hub.push_event({"type": "estop", "message": "紧急停止已执行 (E-Stop executed)"})
            return {"ok": True}
        if action == "save":
            dev.call("save_configuration")
            return {"ok": True, "message": "配置已保存 (configuration saved)"}
        if action == "erase_reboot":
            dev.call("erase_configuration")
            try:
                dev.call("reboot")
            except DeviceIOError:
                pass
            hub.push_event({"type": "info",
                            "message": "配置已擦除，设备重启中 (erased, rebooting)"})
            return {"ok": True}
        if action == "reboot":
            dev.call("reboot")
            return {"ok": True}
        if action == "clear_errors":
            try:
                dev.call("clear_errors")
            except KeyError:
                for n in range(dev.info.axis_count):
                    dev.call(f"axis{n}.clear_errors")
            return {"ok": True}
        raise _err(ValueError(f"未知操作 {action}"))
    except DeviceIOError as e:
        raise _err(e, 503)


@app.post("/api/axes/{n}/state")
def set_axis_state(n: int, body: dict = Body(...)):
    dev = manager.device
    if dev is None:
        raise _err(DeviceIOError("设备未连接 (not connected)"))
    try:
        dev.write(f"axis{n}.requested_state", int(body["state"]))
    except DeviceIOError as e:
        raise _err(e, 503)
    return {"ok": True}


@app.post("/api/axes/{n}/input")
def set_axis_input(n: int, body: dict = Body(...)):
    """手动测试: 下发控制模式与设定值。"""
    dev = manager.device
    if dev is None:
        raise _err(DeviceIOError("设备未连接 (not connected)"))
    try:
        if "control_mode" in body:
            dev.write(f"axis{n}.controller.config.control_mode",
                      int(body["control_mode"]))
        if "input_mode" in body:
            dev.write(f"axis{n}.controller.config.input_mode",
                      int(body["input_mode"]))
        for key, path in (("pos", "input_pos"), ("vel", "input_vel"),
                          ("torque", "input_torque")):
            if key in body:
                dev.write(f"axis{n}.controller.{path}", float(body[key]))
    except DeviceIOError as e:
        raise _err(e, 503)
    return {"ok": True}


# -------------------------------------------------------------- calibration
@app.post("/api/calibration/{n}/start")
def calibration_start(n: int, body: dict = Body(default={})):
    dev = manager.device
    if dev is None:
        raise _err(DeviceIOError("设备未连接 (not connected)"))
    mode = body.get("mode", "full")
    state = {"full": 3, "motor": 4, "encoder": 7}.get(mode)
    if state is None:
        raise _err(ValueError(f"未知校准模式 {mode}"))
    try:
        dev.write(f"axis{n}.requested_state", state)
    except DeviceIOError as e:
        raise _err(e, 503)
    return {"ok": True, "mode": mode}


@app.get("/api/calibration/{n}/progress")
def calibration_progress(n: int):
    dev = manager.device
    if dev is None:
        raise _err(DeviceIOError("设备未连接 (not connected)"))
    try:
        state = int(dev.read(f"axis{n}.current_state"))
        result = {
            "state": errors_zh.axis_state_label(state),
            "motor_calibrated": bool(dev.read(
                f"axis{n}.motor.is_calibrated")
                if dev.info.fw_version.startswith("0.5") else True),
            "encoder_ready": bool(dev.read(f"axis{n}.encoder.is_ready")
                                  if dev.info.fw_version.startswith("0.5") else True),
            "error": int(dev.read(f"axis{n}.error")),
        }
    except (KeyError, DeviceIOError) as e:
        raise _err(e, 503)
    if isinstance(dev, MockODrive):
        result["sim"] = dev.calib_progress(n)
    return result


# ------------------------------------------------------------------ console
@app.post("/api/console")
def console_exec(body: dict = Body(...)):
    dev = manager.device
    if dev is None:
        return {"ok": False, "output": "设备未连接 (not connected)", "kind": "error"}
    return console_mod.execute(dev, body.get("command", ""))


# ------------------------------------------------------------------- errors
@app.get("/api/errors")
def get_errors():
    dev = manager.device
    active = []
    if dev is not None:
        try:
            sources = [("odrive", "error")]
            for n in range(dev.info.axis_count):
                sources += [("axis", f"axis{n}.error"),
                            ("motor", f"axis{n}.motor.error"),
                            ("encoder", f"axis{n}.encoder.error"),
                            ("controller", f"axis{n}.controller.error")]
            for kind, path in sources:
                try:
                    code = int(dev.read(path))
                except KeyError:
                    continue
                if code:
                    active.append({"source": path, "code": code,
                                   "decoded": errors_zh.decode(kind, code)})
        except DeviceIOError:
            pass
    return {"active": active, "history": hub.error_log.entries[::-1]}


@app.post("/api/errors/log/clear")
def clear_error_log():
    hub.error_log.clear()
    return {"ok": True}


# ------------------------------------------------------------ mock控制
@app.post("/api/mock/fault")
def mock_fault(body: dict = Body(...)):
    dev = manager.device
    if not isinstance(dev, MockODrive):
        raise _err(ValueError("当前设备不是模拟器 (not a mock device)"))
    try:
        msg = dev.inject_fault(body.get("kind", ""), int(body.get("axis", 0)),
                               float(body.get("duration", 5.0)))
    except ValueError as e:
        raise _err(e)
    hub.push_event({"type": "info", "message": f"故障注入: {msg}"})
    return {"ok": True, "message": msg}


# ---------------------------------------------------------------- recording
@app.post("/api/record/start")
def record_start(body: dict = Body(...)):
    if manager.device is None:
        raise _err(DeviceIOError("设备未连接 (not connected)"))
    try:
        info = hub.recorder.start(list(body.get("paths", [])),
                                  float(body.get("rate_hz", 10)))
    except RuntimeError as e:
        raise _err(e)
    return info


@app.post("/api/record/stop")
def record_stop():
    result = hub.recorder.stop()
    return {"stopped": result}


@app.get("/api/record/list")
def record_list():
    files = []
    for f in sorted(hub.recorder.dir.glob("*.csv"), reverse=True):
        files.append({"name": f.name, "size": f.stat().st_size,
                      "mtime": time.strftime("%Y-%m-%d %H:%M:%S",
                                             time.localtime(f.stat().st_mtime))})
    return {"files": files}


@app.get("/api/record/download/{name}")
def record_download(name: str):
    if "/" in name or "\\" in name or ".." in name:
        raise _err(ValueError("invalid name"))
    f = hub.recorder.dir / name
    if not f.exists():
        raise _err(FileNotFoundError(name), 404)
    return FileResponse(f, media_type="text/csv", filename=name)


# --------------------------------------------------------------- WebSocket
@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await hub.attach(ws)
    try:
        while True:
            text = await ws.receive_text()
            try:
                hub.handle_message(ws, json.loads(text))
            except json.JSONDecodeError:
                pass
    except WebSocketDisconnect:
        pass
    finally:
        hub.detach(ws)


# ------------------------------------------------------------------- static
if FRONTEND_DIR.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True),
              name="frontend")
