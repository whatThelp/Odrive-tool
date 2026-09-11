"""设备管理器 Device manager.

负责：设备扫描/发现、连接/断开、连接状态跟踪、通信中断检测与自动重连提示。
"""
from __future__ import annotations

import asyncio
import time
from typing import Any, Callable

from .base import BaseDevice, DeviceIOError
from .mock import MockODrive
from .real import HAS_CAN, HAS_ODRIVE, HAS_SERIAL, CanODrive, UartODrive, UsbODrive


class DeviceManager:
    def __init__(self, mock_mode: bool = False) -> None:
        self.mock_mode = mock_mode
        self.device: BaseDevice | None = None
        self.status: str = "disconnected"   # disconnected/connecting/connected/lost
        self._scan_cache: list[dict] = []
        self._mock_pool: dict[str, MockODrive] = {}
        self.on_event: Callable[[dict], None] | None = None
        if mock_mode:
            # 预置两台模拟设备: 一台 24V v0.5.11, 一台 56V v0.6.8
            self._mock_pool = {
                "SIM-000001": MockODrive("SIM-000001", "0.5.11", 24),
                "SIM-000002": MockODrive("SIM-000002", "0.6.8", 56),
            }

    # ------------------------------------------------------------------ scan
    def transports(self) -> dict:
        return {
            "usb": HAS_ODRIVE or self.mock_mode,
            "uart": HAS_SERIAL,
            "can": HAS_CAN,
            "mock": self.mock_mode,
        }

    async def scan(self, timeout: float = 3.0) -> list[dict]:
        results: list[dict] = []
        if self.mock_mode:
            results += [d.info.as_dict() for d in self._mock_pool.values()]
        if HAS_ODRIVE and not self.mock_mode:
            loop = asyncio.get_running_loop()
            devices = await loop.run_in_executor(None, UsbODrive.scan, timeout)
            for d in devices:
                results.append(d.info.as_dict())
                # 缓存实例避免重复枚举
                self._mock_pool[d.info.serial_number] = d  # type: ignore[assignment]
        self._scan_cache = results
        return results

    # --------------------------------------------------------------- connect
    async def connect(self, serial: str | None = None, transport: str = "usb",
                      options: dict | None = None) -> dict:
        options = options or {}
        self.disconnect()
        self.status = "connecting"
        try:
            if self.mock_mode or (serial and serial.startswith("SIM-")):
                key = serial or next(iter(self._mock_pool))
                if key not in self._mock_pool:
                    raise DeviceIOError(f"未找到模拟设备 {key}")
                self.device = self._mock_pool[key]
            elif transport == "usb":
                cached = self._mock_pool.get(serial or "")
                if cached is not None:
                    self.device = cached
                else:
                    loop = asyncio.get_running_loop()
                    devices = await loop.run_in_executor(None, UsbODrive.scan, 5.0)
                    match = [d for d in devices
                             if serial is None or d.info.serial_number == serial]
                    if not match:
                        raise DeviceIOError("未发现 USB ODrive 设备 (no USB device found)")
                    self.device = match[0]
            elif transport == "uart":
                self.device = UartODrive(options.get("port", "COM3"),
                                         int(options.get("baudrate", 115200)))
            elif transport == "can":
                self.device = CanODrive(options.get("channel", "can0"),
                                        int(options.get("bitrate", 250000)))
            else:
                raise DeviceIOError(f"未知传输方式 {transport}")
        except DeviceIOError:
            self.status = "disconnected"
            raise
        self.status = "connected"
        self._emit({"type": "connection", "status": "connected",
                    "device": self.device.info.as_dict()})
        return self.device.info.as_dict()

    def disconnect(self) -> None:
        if self.device is not None and not self.device.info.is_mock:
            self.device.close()
        self.device = None
        if self.status != "disconnected":
            self.status = "disconnected"
            self._emit({"type": "connection", "status": "disconnected"})

    # ---------------------------------------------------------------- helpers
    def require(self) -> BaseDevice:
        if self.device is None:
            raise DeviceIOError("设备未连接 (device not connected)")
        return self.device

    def mark_lost(self) -> None:
        if self.status == "connected":
            self.status = "lost"
            self._emit({"type": "connection", "status": "lost",
                        "message": "设备通信中断 (communication lost)"})

    def mark_recovered(self) -> None:
        if self.status == "lost":
            self.status = "connected"
            self._emit({"type": "connection", "status": "connected",
                        "message": "通信已恢复 (communication recovered)",
                        "device": self.device.info.as_dict() if self.device else None})

    def _emit(self, event: dict) -> None:
        event.setdefault("t", time.time())
        if self.on_event:
            self.on_event(event)
