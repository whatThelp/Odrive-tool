"""odrivetool 风格命令控制台 Command console.

支持:
    odrv0.vbus_voltage                          读取 (odrv0. 前缀可选)
    axis0.controller.input_pos = 3.14           写入
    axis0.requested_state = AXIS_STATE_CLOSED_LOOP_CONTROL   写入(枚举名)
    odrv0.save_configuration()                  调用
    axis0.clear_errors()                        调用
    dump_errors(odrv0)                          错误汇总
    help                                        帮助
"""
from __future__ import annotations

import re
from typing import Any

from . import errors_zh, safety
from .device.base import BaseDevice, DeviceIOError

_ENUMS = {
    "AXIS_STATE_UNDEFINED": 0, "AXIS_STATE_IDLE": 1,
    "AXIS_STATE_STARTUP_SEQUENCE": 2, "AXIS_STATE_FULL_CALIBRATION_SEQUENCE": 3,
    "AXIS_STATE_MOTOR_CALIBRATION": 4, "AXIS_STATE_ENCODER_INDEX_SEARCH": 6,
    "AXIS_STATE_ENCODER_OFFSET_CALIBRATION": 7, "AXIS_STATE_CLOSED_LOOP_CONTROL": 8,
    "AXIS_STATE_LOCKIN_SPIN": 9, "AXIS_STATE_ENCODER_DIR_FIND": 10,
    "AXIS_STATE_HOMING": 11,
    "CONTROL_MODE_VOLTAGE_CONTROL": 0, "CONTROL_MODE_TORQUE_CONTROL": 1,
    "CONTROL_MODE_VELOCITY_CONTROL": 2, "CONTROL_MODE_POSITION_CONTROL": 3,
    "INPUT_MODE_INACTIVE": 0, "INPUT_MODE_PASSTHROUGH": 1,
    "INPUT_MODE_VEL_RAMP": 2, "INPUT_MODE_POS_FILTER": 3,
    "INPUT_MODE_TRAP_TRAJ": 5, "INPUT_MODE_TORQUE_RAMP": 6,
    "MOTOR_TYPE_HIGH_CURRENT": 0, "MOTOR_TYPE_GIMBAL": 2,
    "ENCODER_MODE_INCREMENTAL": 0, "ENCODER_MODE_HALL": 1,
    "True": 1, "False": 0, "true": 1, "false": 0,
}

HELP_TEXT = """可用命令 Available commands:
  <path>                    读取属性   e.g. vbus_voltage / axis0.encoder.pos_estimate
  <path> = <value>          写入属性   e.g. axis0.controller.input_vel = 2.5
  <path>(<args>)            调用函数   e.g. save_configuration() / axis0.clear_errors()
  dump_errors(odrv0)        汇总所有错误并解码
  help                      显示本帮助
说明: odrv0. 前缀可省略; 枚举名可直接使用, 如
  axis0.requested_state = AXIS_STATE_CLOSED_LOOP_CONTROL"""


def _parse_value(text: str) -> Any:
    t = text.strip()
    if t in _ENUMS:
        return _ENUMS[t]
    if t.lower() in ("true", "false"):
        return t.lower() == "true"
    try:
        return int(t)
    except ValueError:
        pass
    try:
        return float(t)
    except ValueError:
        pass
    return t.strip("\"'")


def _strip_prefix(path: str) -> str:
    path = path.strip()
    for prefix in ("odrv0.", "dev0.", "odrv."):
        if path.startswith(prefix):
            return path[len(prefix):]
    return path


def _dump_errors(device: BaseDevice) -> str:
    lines = []
    try:
        sys_err = device.read("error")
        lines.append("system:")
        errs = errors_zh.decode("odrive", int(sys_err))
        lines += [f"  {e['en']} ({e['zh']})" for e in errs] or ["  无错误 no error"]
    except (KeyError, DeviceIOError):
        pass
    for n in range(device.info.axis_count):
        lines.append(f"axis{n}:")
        for kind, path in (("axis", f"axis{n}.error"),
                           ("motor", f"axis{n}.motor.error"),
                           ("encoder", f"axis{n}.encoder.error"),
                           ("controller", f"axis{n}.controller.error")):
            try:
                code = int(device.read(path))
            except (KeyError, DeviceIOError):
                continue
            errs = errors_zh.decode(kind, code)
            tag = f"  {kind}.error = 0x{code:04X}: "
            lines.append(tag + ("; ".join(f"{e['en']} ({e['zh']})" for e in errs)
                                if errs else "无错误 no error"))
    return "\n".join(lines)


def execute(device: BaseDevice, command: str) -> dict:
    """执行一条控制台命令，返回 {ok, output, kind}。"""
    cmd = command.strip()
    if not cmd:
        return {"ok": True, "output": "", "kind": "empty"}
    if cmd in ("help", "?"):
        return {"ok": True, "output": HELP_TEXT, "kind": "help"}
    if re.fullmatch(r"dump_errors\s*\(\s*\w*\s*\)", cmd):
        return {"ok": True, "output": _dump_errors(device), "kind": "call"}

    try:
        # 函数调用: path(args)
        m = re.fullmatch(r"([\w.\[\]]+)\s*\(\s*(.*?)\s*\)", cmd)
        if m:
            path = _strip_prefix(m.group(1))
            args = [_parse_value(a) for a in m.group(2).split(",") if a.strip()] \
                if m.group(2) else []
            result = device.call(path, args)
            return {"ok": True, "output": f"{path}(...) -> {result}", "kind": "call"}

        # 写入: path = value
        m = re.fullmatch(r"([\w.\[\]]+)\s*=\s*(.+)", cmd)
        if m:
            path = _strip_prefix(m.group(1))
            value = _parse_value(m.group(2))
            value, warn = safety.clamp(path, value, device.info.hw_variant)
            actual = device.write(path, value)
            out = f"{path} = {actual}"
            if warn:
                out += f"\n⚠ {warn}"
            return {"ok": True, "output": out, "kind": "write",
                    "path": path, "value": actual}

        # 读取: path
        if re.fullmatch(r"[\w.\[\]]+", cmd):
            path = _strip_prefix(cmd)
            value = device.read(path)
            return {"ok": True, "output": f"{path} = {value}", "kind": "read",
                    "path": path, "value": value}

        return {"ok": False, "output": f"无法解析命令 (cannot parse): {cmd}\n输入 help 查看用法",
                "kind": "error"}
    except KeyError as e:
        return {"ok": False, "output": f"属性不存在 (unknown attribute): {e}", "kind": "error"}
    except DeviceIOError as e:
        return {"ok": False, "output": f"设备通信错误 (device I/O error): {e}", "kind": "error"}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "output": f"执行失败 (failed): {e}", "kind": "error"}
