"""设备抽象层 Device abstraction layer.

所有传输方式（USB / UART / CAN / 模拟器）都实现同一套接口，
上层业务代码不感知具体传输细节。
Path 统一使用点分字符串，例如 "axis0.motor.config.current_lim"。
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any


class DeviceIOError(Exception):
    """设备通信错误（超时 / 断开 / 无响应）。"""


@dataclass
class DeviceInfo:
    serial_number: str
    fw_version: str          # e.g. "0.5.11"
    hw_version: str          # e.g. "3.6"
    hw_variant: int          # 母线电压版本: 24 或 56
    axis_count: int = 2
    transport: str = "usb"   # usb / uart / can / mock
    is_mock: bool = False

    def as_dict(self) -> dict:
        return {
            "serial_number": self.serial_number,
            "fw_version": self.fw_version,
            "hw_version": self.hw_version,
            "hw_variant": self.hw_variant,
            "axis_count": self.axis_count,
            "transport": self.transport,
            "is_mock": self.is_mock,
        }


class BaseDevice(ABC):
    """ODrive 设备统一接口。实现类: MockODrive / UsbODrive / UartODrive / CanODrive."""

    info: DeviceInfo

    @abstractmethod
    def read(self, path: str) -> Any:
        """读取属性。不存在时抛 KeyError，通信失败抛 DeviceIOError。"""

    @abstractmethod
    def write(self, path: str, value: Any) -> Any:
        """写入属性，返回写入后的实际值。"""

    @abstractmethod
    def call(self, path: str, args: list | None = None) -> Any:
        """调用设备端函数，例如 save_configuration / clear_errors。"""

    def read_many(self, paths: list[str]) -> dict[str, Any]:
        out: dict[str, Any] = {}
        for p in paths:
            try:
                out[p] = self.read(p)
            except KeyError:
                out[p] = None
        return out

    def step(self, dt: float) -> None:
        """仿真步进（仅模拟器需要实现）。"""

    def close(self) -> None:
        """释放底层资源。"""
