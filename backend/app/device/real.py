"""真实 ODrive 硬件适配 Real hardware adapters.

- UsbODrive : 基于官方 `odrive` 库 (fibre native protocol)，功能完整。推荐。
- UartODrive: 基于 pyserial 的 ASCII 协议，支持任意属性读写 (r/w 命令)。
- CanODrive : CANSimple 协议，仅支持设定值下发 / 状态反馈等有限功能。

三个依赖均为可选安装（requirements-hardware.txt），导入失败时对应
传输方式在扫描结果中不可用，模拟器模式不受影响。
"""
from __future__ import annotations

import time
from functools import reduce
from typing import Any

from .base import BaseDevice, DeviceIOError, DeviceInfo

try:
    import odrive  # type: ignore
    import odrive.enums  # noqa: F401
    HAS_ODRIVE = True
except Exception:  # pragma: no cover - optional dependency
    HAS_ODRIVE = False

try:
    import serial  # type: ignore
    HAS_SERIAL = True
except Exception:  # pragma: no cover
    HAS_SERIAL = False

try:
    import can  # type: ignore
    HAS_CAN = True
except Exception:  # pragma: no cover
    HAS_CAN = False


# ---------------------------------------------------------------------- USB
class UsbODrive(BaseDevice):
    """官方 fibre/USB 协议，属性树与 odrivetool 完全一致。"""

    def __init__(self, odrv: Any) -> None:
        self._odrv = odrv
        fw = f"{odrv.fw_version_major}.{odrv.fw_version_minor}.{odrv.fw_version_revision}"
        hw = f"{odrv.hw_version_major}.{odrv.hw_version_minor}"
        variant = int(getattr(odrv, "hw_version_variant", 56))
        axis_count = 2 if hasattr(odrv, "axis1") else 1
        self.info = DeviceInfo(
            serial_number=format(odrv.serial_number, "X"),
            fw_version=fw, hw_version=hw, hw_variant=variant,
            axis_count=axis_count, transport="usb")

    def _resolve(self, path: str) -> Any:
        try:
            return reduce(getattr, path.split("."), self._odrv)
        except AttributeError as e:
            raise KeyError(path) from e
        except Exception as e:
            raise DeviceIOError(str(e)) from e

    def read(self, path: str) -> Any:
        val = self._resolve(path)
        if callable(val):
            raise KeyError(f"{path} is a function")
        return val

    def write(self, path: str, value: Any) -> Any:
        parent_path, _, leaf = path.rpartition(".")
        parent = self._resolve(parent_path) if parent_path else self._odrv
        try:
            setattr(parent, leaf, value)
            return getattr(parent, leaf)
        except AttributeError as e:
            raise KeyError(path) from e
        except Exception as e:
            raise DeviceIOError(str(e)) from e

    def call(self, path: str, args: list | None = None) -> Any:
        fn = self._resolve(path)
        if not callable(fn):
            raise KeyError(f"{path} is not a function")
        try:
            return fn(*(args or []))
        except Exception as e:
            # reboot / erase_configuration 会主动断开 USB，属预期行为
            if path in ("reboot", "erase_configuration"):
                return True
            raise DeviceIOError(str(e)) from e

    @staticmethod
    def scan(timeout: float = 3.0) -> list["UsbODrive"]:
        if not HAS_ODRIVE:
            return []
        found: list[UsbODrive] = []
        try:
            odrv = odrive.find_any(timeout=timeout)
            if odrv is not None:
                found.append(UsbODrive(odrv))
        except Exception:
            pass
        return found


# --------------------------------------------------------------------- UART
class UartODrive(BaseDevice):
    """ASCII 协议 (r/w 命令)。要求固件启用 UART_A 且协议为 ASCII。"""

    def __init__(self, port: str, baudrate: int = 115200) -> None:
        if not HAS_SERIAL:
            raise DeviceIOError("pyserial 未安装 (pyserial not installed)")
        try:
            self._ser = serial.Serial(port, baudrate, timeout=0.5)
        except Exception as e:
            raise DeviceIOError(f"无法打开串口 {port}: {e}") from e
        self._port = port
        fw = self._probe_fw()
        self.info = DeviceInfo(
            serial_number=f"UART@{port}", fw_version=fw, hw_version="3.6",
            hw_variant=self._probe_variant(), axis_count=2, transport="uart")

    def _txrx(self, line: str) -> str:
        try:
            self._ser.reset_input_buffer()
            self._ser.write((line + "\n").encode("ascii"))
            resp = self._ser.readline().decode("ascii", "replace").strip()
        except Exception as e:
            raise DeviceIOError(str(e)) from e
        if resp.startswith("invalid"):
            raise KeyError(line)
        return resp

    def _probe_fw(self) -> str:
        try:
            major = self._txrx("r fw_version_major")
            minor = self._txrx("r fw_version_minor")
            rev = self._txrx("r fw_version_revision")
            return f"{int(float(major))}.{int(float(minor))}.{int(float(rev))}"
        except Exception:
            return "0.5.x"

    def _probe_variant(self) -> int:
        try:
            return int(float(self._txrx("r hw_version_variant")))
        except Exception:
            return 56

    @staticmethod
    def _parse(text: str) -> Any:
        t = text.strip()
        if t in ("True", "true", "1") and t != "1":
            return True
        if t in ("False", "false"):
            return False
        try:
            f = float(t)
            return int(f) if f.is_integer() and "." not in t and "e" not in t.lower() else f
        except ValueError:
            return t

    def read(self, path: str) -> Any:
        return self._parse(self._txrx(f"r {path}"))

    def write(self, path: str, value: Any) -> Any:
        if isinstance(value, bool):
            value = int(value)
        self._ser.write(f"w {path} {value}\n".encode("ascii"))
        return self.read(path)

    def call(self, path: str, args: list | None = None) -> Any:
        # ASCII 协议无通用函数调用；映射常用系统命令
        mapping = {"save_configuration": "ss", "erase_configuration": "se",
                   "reboot": "sr", "clear_errors": "sc"}
        if path in mapping:
            self._ser.write((mapping[path] + "\n").encode("ascii"))
            return True
        raise KeyError(f"UART 模式不支持调用 {path} (not supported over UART)")

    def close(self) -> None:
        try:
            self._ser.close()
        except Exception:
            pass


# ---------------------------------------------------------------------- CAN
class CanODrive(BaseDevice):
    """CANSimple 协议。仅支持有限命令集（设定值、状态请求、急停），
    不支持完整参数树读写 —— 参数配置请使用 USB 连接。"""

    _CMD_HEARTBEAT = 0x01
    _CMD_ESTOP = 0x02
    _CMD_SET_AXIS_STATE = 0x07
    _CMD_SET_INPUT_POS = 0x0C
    _CMD_SET_INPUT_VEL = 0x0D
    _CMD_SET_INPUT_TORQUE = 0x0E

    def __init__(self, channel: str, bitrate: int = 250000, node_ids: tuple = (0, 1)) -> None:
        if not HAS_CAN:
            raise DeviceIOError("python-can 未安装 (python-can not installed)")
        try:
            self._bus = can.Bus(channel=channel, interface="slcan"
                                if channel.upper().startswith("COM") else "socketcan",
                                bitrate=bitrate)
        except Exception as e:
            raise DeviceIOError(f"无法打开 CAN 通道 {channel}: {e}") from e
        self._node_ids = node_ids
        self.info = DeviceInfo(
            serial_number=f"CAN@{channel}", fw_version="unknown",
            hw_version="3.6", hw_variant=56, axis_count=len(node_ids),
            transport="can")

    def _send(self, node_id: int, cmd: int, data: bytes = b"") -> None:
        import struct  # noqa: F401
        msg = can.Message(arbitration_id=(node_id << 5) | cmd,
                          data=data, is_extended_id=False)
        try:
            self._bus.send(msg)
        except Exception as e:
            raise DeviceIOError(str(e)) from e

    def read(self, path: str) -> Any:
        raise KeyError("CAN 模式不支持任意属性读取，请使用 USB (not supported over CAN)")

    def write(self, path: str, value: Any) -> Any:
        import struct
        parts = path.split(".")
        if parts[0].startswith("axis"):
            node = self._node_ids[int(parts[0][4])]
            leaf = parts[-1]
            if leaf == "requested_state":
                self._send(node, self._CMD_SET_AXIS_STATE, struct.pack("<I", int(value)))
                return value
            if leaf == "input_pos":
                self._send(node, self._CMD_SET_INPUT_POS,
                           struct.pack("<fhh", float(value), 0, 0))
                return value
            if leaf == "input_vel":
                self._send(node, self._CMD_SET_INPUT_VEL,
                           struct.pack("<ff", float(value), 0.0))
                return value
            if leaf == "input_torque":
                self._send(node, self._CMD_SET_INPUT_TORQUE, struct.pack("<f", float(value)))
                return value
        raise KeyError(f"CAN 模式不支持写入 {path} (not supported over CAN)")

    def call(self, path: str, args: list | None = None) -> Any:
        if path == "estop" or path.endswith(".estop"):
            for node in self._node_ids:
                self._send(node, self._CMD_ESTOP)
            return True
        raise KeyError(f"CAN 模式不支持调用 {path} (not supported over CAN)")

    def close(self) -> None:
        try:
            self._bus.shutdown()
        except Exception:
            pass
