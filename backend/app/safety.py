"""安全钳位 Safety clamping.

所有参数写入必须经过本模块。硬性限制不可被界面绕过：
- 电流限制: 峰值 120A/电机（连续电流取决于散热）
- 电压保护阈值: 按硬件版本 (24V: 12-26V, 56V: 12-56V) 自适应
"""
from __future__ import annotations

import fnmatch
from typing import Any

# 硬件绝对极限 (path pattern -> (min, max))，与固件版本无关
_HARD_LIMITS: dict[str, tuple[float, float]] = {
    # v0.5.x
    "axis*.motor.config.current_lim": (0.0, 120.0),
    "axis*.motor.config.current_lim_margin": (0.0, 30.0),
    "axis*.motor.config.requested_current_range": (0.0, 120.0),
    "axis*.motor.config.calibration_current": (0.0, 60.0),
    "axis*.controller.config.vel_limit": (0.0, 200.0),
    # v0.6.x
    "axis*.config.motor.current_soft_max": (0.0, 120.0),
    "axis*.config.motor.current_hard_max": (0.0, 120.0),
    "axis*.config.motor.calibration_current": (0.0, 60.0),
    # 母线电流
    "config.dc_max_positive_current": (0.0, 120.0),
    "config.dc_max_negative_current": (-120.0, 0.0),
    "config.max_regen_current": (0.0, 120.0),
    # 制动电阻
    "config.brake_resistance": (0.0, 100.0),
    "config.brake_resistor0.resistance": (0.0, 100.0),
}

# 电压阈值按硬件版本适配 (variant -> (vmin, vmax))
_VOLTAGE_RANGE = {24: (8.0, 26.0), 56: (8.0, 56.0)}
_VOLTAGE_PATHS = (
    "config.dc_bus_overvoltage_trip_level",
    "config.dc_bus_undervoltage_trip_level",
)


def clamp(path: str, value: Any, hw_variant: int = 56) -> tuple[Any, str | None]:
    """返回 (钳位后的值, 警告信息或 None)。仅对数值参数生效。"""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return value, None

    lo: float | None = None
    hi: float | None = None
    if path in _VOLTAGE_PATHS:
        lo, hi = _VOLTAGE_RANGE.get(hw_variant, _VOLTAGE_RANGE[56])
    else:
        for pattern, (plo, phi) in _HARD_LIMITS.items():
            if fnmatch.fnmatch(path, pattern):
                lo, hi = plo, phi
                break
    if lo is None or hi is None:
        return value, None

    clamped = max(lo, min(hi, float(value)))
    if clamped != float(value):
        warn = (f"{path} 超出硬件安全范围 [{lo}, {hi}]，已钳位为 {clamped} "
                f"(value clamped to hardware safety limit)")
        return clamped, warn
    return value, None


def voltage_range(hw_variant: int) -> tuple[float, float]:
    return _VOLTAGE_RANGE.get(hw_variant, _VOLTAGE_RANGE[56])
