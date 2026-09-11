"""模拟 ODrive 设备 Mock ODrive simulator.

无硬件时提供完整功能测试，包括：
- 双轴一阶动力学仿真（位置 / 速度 / 扭矩三种控制模式）
- 完整校准序列（电机参数辨识 -> 编码器偏移校准）
- MOSFET / 电机温度模型
- 故障注入：通信中断、轴错误、欠压、过温（用于测试上位机容错性）
"""
from __future__ import annotations

import math
import random
import time
from typing import Any

from .base import BaseDevice, DeviceIOError, DeviceInfo

# ---- ODrive v0.5.x 常量 ----
AXIS_STATE_UNDEFINED = 0
AXIS_STATE_IDLE = 1
AXIS_STATE_STARTUP_SEQUENCE = 2
AXIS_STATE_FULL_CALIBRATION_SEQUENCE = 3
AXIS_STATE_MOTOR_CALIBRATION = 4
AXIS_STATE_ENCODER_INDEX_SEARCH = 6
AXIS_STATE_ENCODER_OFFSET_CALIBRATION = 7
AXIS_STATE_CLOSED_LOOP_CONTROL = 8

CONTROL_MODE_VOLTAGE = 0
CONTROL_MODE_TORQUE = 1
CONTROL_MODE_VELOCITY = 2
CONTROL_MODE_POSITION = 3

# 错误位 (v0.5.x)
AXIS_ERROR_MOTOR_FAILED = 0x40
AXIS_ERROR_ENCODER_FAILED = 0x100
MOTOR_ERROR_DRV_FAULT = 0x08
MOTOR_ERROR_MOTOR_THERMISTOR_OVER_TEMP = 0x400000
ENCODER_ERROR_NO_RESPONSE = 0x04
ODRIVE_ERROR_DC_BUS_UNDER_VOLTAGE = 0x08
ODRIVE_ERROR_DC_BUS_OVER_VOLTAGE = 0x04


def _default_axis_config() -> dict:
    return {
        "startup_closed_loop_control": False,
        "startup_encoder_offset_calibration": False,
        "startup_motor_calibration": False,
        "enable_watchdog": False,
        "watchdog_timeout": 0.0,
        "can": {"node_id": 0, "heartbeat_rate_ms": 100},
    }


def _default_motor(variant: int) -> dict:
    return {
        "error": 0,
        "is_calibrated": False,
        "current_control": {"Iq_measured": 0.0, "Iq_setpoint": 0.0},
        "config": {
            "pole_pairs": 7,
            "motor_type": 0,           # MOTOR_TYPE_HIGH_CURRENT
            "phase_resistance": 0.0,
            "phase_inductance": 0.0,
            "torque_constant": 8.27 / 270.0,
            "current_lim": 10.0,
            "current_lim_margin": 8.0,
            "calibration_current": 10.0,
            "resistance_calib_max_voltage": 2.0 if variant == 24 else 4.0,
            "requested_current_range": 60.0,
            "pre_calibrated": False,
        },
    }


def _default_encoder() -> dict:
    return {
        "error": 0,
        "is_ready": False,
        "index_found": False,
        "shadow_count": 0,
        "pos_estimate": 0.0,
        "vel_estimate": 0.0,
        "config": {
            "mode": 0,                 # ENCODER_MODE_INCREMENTAL
            "cpr": 8192,
            "use_index": False,
            "pre_calibrated": False,
            "bandwidth": 1000.0,
            "calib_scan_distance": 50.265,
        },
    }


def _default_controller() -> dict:
    return {
        "error": 0,
        "input_pos": 0.0,
        "input_vel": 0.0,
        "input_torque": 0.0,
        "pos_setpoint": 0.0,
        "vel_setpoint": 0.0,
        "torque_setpoint": 0.0,
        "config": {
            "control_mode": CONTROL_MODE_POSITION,
            "input_mode": 1,           # INPUT_MODE_PASSTHROUGH
            "pos_gain": 20.0,
            "vel_gain": 0.16,
            "vel_integrator_gain": 0.32,
            "vel_limit": 10.0,
            "vel_limit_tolerance": 1.2,
            "vel_ramp_rate": 10.0,
            "torque_ramp_rate": 0.01,
            "circular_setpoints": False,
            "inertia": 0.0,
            "input_filter_bandwidth": 2.0,
        },
    }


class _SimAxis:
    """单轴仿真状态（物理量，不进 config 树）。"""

    def __init__(self) -> None:
        self.pos = 0.0            # turns
        self.vel = 0.0            # turns/s
        self.iq = 0.0             # A
        self.state = AXIS_STATE_IDLE
        self.calib_phase = ""     # motor / encoder_dir / encoder_offset
        self.calib_t = 0.0
        self.calib_progress = 0.0
        self.motor_temp = 28.0
        self.fet_temp = 30.0


class MockODrive(BaseDevice):
    def __init__(self, serial: str = "SIM-000001", fw_version: str = "0.5.11",
                 variant: int = 24) -> None:
        self.info = DeviceInfo(
            serial_number=serial, fw_version=fw_version, hw_version="3.6",
            hw_variant=variant, axis_count=2, transport="mock", is_mock=True)
        self._variant = variant
        self._vbus_nominal = 24.0 if variant == 24 else 48.0
        self._sim = [_SimAxis(), _SimAxis()]
        self._comm_lost_until = 0.0
        self._vbus_dip_until = 0.0
        self._overtemp_axis: int | None = None
        self._t = time.monotonic()
        self.tree: dict[str, Any] = self._build_tree()

    # ------------------------------------------------------------------ tree
    def _build_tree(self) -> dict:
        vmax = 26.0 if self._variant == 24 else 56.0
        dev = {
            "vbus_voltage": self._vbus_nominal,
            "ibus": 0.0,
            "error": 0,
            "serial_number": self.info.serial_number,
            "fw_version_major": 0,
            "fw_version_minor": int(self.info.fw_version.split(".")[1]),
            "fw_version_revision": int(self.info.fw_version.split(".")[2]),
            "hw_version_major": 3,
            "hw_version_minor": 6,
            "hw_version_variant": self._variant,
            "brake_resistor_armed": True,
            "brake_resistor_saturated": False,
            "config": {
                "enable_brake_resistor": False,
                "brake_resistance": 2.0,
                "dc_bus_overvoltage_trip_level": vmax,
                "dc_bus_undervoltage_trip_level": 8.0,
                "dc_max_positive_current": 60.0,
                "dc_max_negative_current": -0.01,
                "max_regen_current": 0.0,
                "enable_uart_a": True,
                "uart_a_baudrate": 115200,
                "enable_can_a": True,
                "can": {"baud_rate": 250000},
            },
        }
        for n in range(2):
            dev[f"axis{n}"] = {
                "error": 0,
                "current_state": AXIS_STATE_IDLE,
                "requested_state": AXIS_STATE_UNDEFINED,
                "is_homed": False,
                "config": _default_axis_config(),
                "motor": _default_motor(self._variant),
                "encoder": _default_encoder(),
                "controller": _default_controller(),
                "fet_thermistor": {"temperature": 30.0},
                "motor_thermistor": {"temperature": 28.0, "config": {"enabled": False}},
            }
        return dev

    # ---------------------------------------------------------- v0.6 aliases
    # SIM 设备内部统一使用 v0.5 属性树；固件为 0.6.x 时通过别名层
    # 把 v0.6 风格路径翻译到内部树，使两套 interface JSON 都可完整测试。
    _V06_LEAF_ALIASES = {
        "config.brake_resistor0.enable": "config.enable_brake_resistor",
        "config.brake_resistor0.resistance": "config.brake_resistance",
        "can.config.baud_rate": "config.can.baud_rate",
    }

    def _alias(self, path: str) -> str:
        if not self.info.fw_version.startswith("0.6"):
            return path
        if path in self._V06_LEAF_ALIASES:
            return self._V06_LEAF_ALIASES[path]
        if path.startswith("inc_encoder"):
            n = path[11]
            leaf = path.split(".", 1)[1] if "." in path else ""
            if leaf == "config.cpr":
                return f"axis{n}.encoder.config.cpr"
        if path.startswith("axis"):
            n, rest = path[4], path[6:]
            m = {
                "pos_estimate": f"axis{n}.encoder.pos_estimate",
                "vel_estimate": f"axis{n}.encoder.vel_estimate",
                "config.encoder_bandwidth": f"axis{n}.encoder.config.bandwidth",
                "config.motor.current_soft_max": f"axis{n}.motor.config.current_lim",
                "config.motor.current_hard_max": f"axis{n}.motor.config.requested_current_range",
                "motor.foc.Iq_measured": f"axis{n}.motor.current_control.Iq_measured",
                "motor.foc.Iq_setpoint": f"axis{n}.motor.current_control.Iq_setpoint",
                "motor.fet_thermistor.temperature": f"axis{n}.fet_thermistor.temperature",
                "motor.motor_thermistor.temperature": f"axis{n}.motor_thermistor.temperature",
            }
            if rest in m:
                return m[rest]
            if rest.startswith("config.motor."):
                return f"axis{n}.motor.config.{rest[13:]}"
        return path

    # ------------------------------------------------------------- accessors
    def _check_comm(self) -> None:
        if time.monotonic() < self._comm_lost_until:
            raise DeviceIOError("simulated communication loss")

    def _walk(self, path: str) -> tuple[dict, str]:
        path = self._alias(path)
        node = self.tree
        parts = path.split(".")
        for p in parts[:-1]:
            nxt = node.get(p)
            if not isinstance(nxt, dict):
                raise KeyError(path)
            node = nxt
        if parts[-1] not in node:
            raise KeyError(path)
        return node, parts[-1]

    def read(self, path: str) -> Any:
        self._check_comm()
        node, leaf = self._walk(path)
        val = node[leaf]
        if isinstance(val, dict):
            raise KeyError(f"{path} is an object, not a property")
        return val

    def write(self, path: str, value: Any) -> Any:
        self._check_comm()
        node, leaf = self._walk(path)
        old = node[leaf]
        if isinstance(old, bool):
            value = bool(value)
        elif isinstance(old, int) and not isinstance(old, bool):
            value = int(value)
        elif isinstance(old, float):
            value = float(value)
        node[leaf] = value
        # requested_state 触发状态机
        if leaf == "requested_state" and path.startswith("axis"):
            n = int(path[4])
            self._request_state(n, int(value))
            node[leaf] = AXIS_STATE_UNDEFINED
        return node[leaf]

    def call(self, path: str, args: list | None = None) -> Any:
        self._check_comm()
        if path == "save_configuration":
            return True
        if path == "erase_configuration":
            self.tree = self._build_tree()
            for sim in self._sim:
                sim.state = AXIS_STATE_IDLE
            return True
        if path == "reboot":
            self._comm_lost_until = time.monotonic() + 2.0
            for sim in self._sim:
                sim.state = AXIS_STATE_IDLE
                sim.vel = sim.iq = 0.0
            return True
        if path == "clear_errors":
            self._clear_errors()
            return True
        if path.startswith("axis") and path.endswith("clear_errors"):
            self._clear_errors(int(path[4]))
            return True
        raise KeyError(f"unknown function: {path}")

    def _clear_errors(self, axis: int | None = None) -> None:
        self.tree["error"] = 0
        for n in range(2):
            if axis is not None and n != axis:
                continue
            ax = self.tree[f"axis{n}"]
            ax["error"] = 0
            ax["motor"]["error"] = 0
            ax["encoder"]["error"] = 0
            ax["controller"]["error"] = 0

    # ---------------------------------------------------------- state machine
    def _request_state(self, n: int, state: int) -> None:
        sim = self._sim[n]
        ax = self.tree[f"axis{n}"]
        if state == AXIS_STATE_IDLE:
            sim.state = AXIS_STATE_IDLE
            sim.iq = 0.0
        elif state in (AXIS_STATE_FULL_CALIBRATION_SEQUENCE,
                       AXIS_STATE_MOTOR_CALIBRATION):
            sim.state = state
            sim.calib_phase = "motor"
            sim.calib_t = 0.0
            sim.calib_progress = 0.0
        elif state == AXIS_STATE_ENCODER_OFFSET_CALIBRATION:
            if not ax["motor"]["is_calibrated"]:
                ax["error"] |= AXIS_ERROR_MOTOR_FAILED
                sim.state = AXIS_STATE_IDLE
                return
            sim.state = state
            sim.calib_phase = "encoder_offset"
            sim.calib_t = 0.0
            sim.calib_progress = 0.0
        elif state == AXIS_STATE_CLOSED_LOOP_CONTROL:
            if not (ax["motor"]["is_calibrated"] and ax["encoder"]["is_ready"]):
                ax["error"] |= (AXIS_ERROR_MOTOR_FAILED
                                if not ax["motor"]["is_calibrated"]
                                else AXIS_ERROR_ENCODER_FAILED)
                sim.state = AXIS_STATE_IDLE
                return
            ctl = ax["controller"]
            ctl["input_pos"] = sim.pos
            ctl["input_vel"] = 0.0
            ctl["input_torque"] = 0.0
            sim.state = AXIS_STATE_CLOSED_LOOP_CONTROL
        ax["current_state"] = sim.state

    # ------------------------------------------------------------- simulation
    def step(self, dt: float) -> None:
        if time.monotonic() < self._comm_lost_until:
            return
        vbus = self._vbus_nominal + 0.08 * math.sin(time.monotonic() * 2.1) \
            + random.uniform(-0.03, 0.03)
        if time.monotonic() < self._vbus_dip_until:
            vbus = 7.2  # 模拟欠压
            self.tree["error"] |= ODRIVE_ERROR_DC_BUS_UNDER_VOLTAGE
            for n in range(2):
                if self._sim[n].state == AXIS_STATE_CLOSED_LOOP_CONTROL:
                    self._sim[n].state = AXIS_STATE_IDLE
                    self.tree[f"axis{n}"]["current_state"] = AXIS_STATE_IDLE
        self.tree["vbus_voltage"] = round(vbus, 3)

        ibus_total = 0.0
        for n in range(2):
            ibus_total += self._step_axis(n, dt, vbus)
        self.tree["ibus"] = round(ibus_total + random.uniform(-0.02, 0.02), 3)

    def _step_axis(self, n: int, dt: float, vbus: float) -> float:
        sim = self._sim[n]
        ax = self.tree[f"axis{n}"]
        ctl = ax["controller"]
        mcfg = ax["motor"]["config"]

        # ---- 校准序列 ----
        if sim.state in (AXIS_STATE_FULL_CALIBRATION_SEQUENCE,
                         AXIS_STATE_MOTOR_CALIBRATION,
                         AXIS_STATE_ENCODER_OFFSET_CALIBRATION):
            sim.calib_t += dt
            if sim.calib_phase == "motor":
                dur = 4.0
                sim.iq = mcfg["calibration_current"] * min(1.0, sim.calib_t / 0.5)
                sim.calib_progress = min(1.0, sim.calib_t / dur)
                if sim.calib_t >= dur:
                    mcfg["phase_resistance"] = round(random.uniform(0.035, 0.042), 5)
                    mcfg["phase_inductance"] = round(random.uniform(1.4e-5, 1.7e-5), 8)
                    ax["motor"]["is_calibrated"] = True
                    sim.iq = 0.0
                    if sim.state == AXIS_STATE_FULL_CALIBRATION_SEQUENCE:
                        sim.calib_phase = "encoder_offset"
                        sim.calib_t = 0.0
                    else:
                        sim.state = AXIS_STATE_IDLE
            elif sim.calib_phase == "encoder_offset":
                dur = 6.0
                # 电机正反各转一段
                sim.vel = 8.0 if sim.calib_t < dur / 2 else -8.0
                sim.pos += sim.vel * dt
                sim.iq = mcfg["calibration_current"] * 0.4
                sim.calib_progress = min(1.0, sim.calib_t / dur)
                if sim.calib_t >= dur:
                    ax["encoder"]["is_ready"] = True
                    sim.vel = 0.0
                    sim.iq = 0.0
                    sim.state = AXIS_STATE_IDLE
            ax["current_state"] = sim.state

        # ---- 闭环控制 ----
        elif sim.state == AXIS_STATE_CLOSED_LOOP_CONTROL:
            mode = ctl["config"]["control_mode"]
            vel_lim = ctl["config"]["vel_limit"]
            kt = max(1e-4, mcfg["torque_constant"])
            if mode == CONTROL_MODE_POSITION:
                target_vel = ctl["config"]["pos_gain"] * (ctl["input_pos"] - sim.pos)
                target_vel = max(-vel_lim, min(vel_lim, target_vel)) + ctl["input_vel"]
            elif mode == CONTROL_MODE_VELOCITY:
                target_vel = max(-vel_lim, min(vel_lim, ctl["input_vel"]))
                # INPUT_MODE_VEL_RAMP: 设定值按 vel_ramp_rate 斜坡逼近
                if ctl["config"]["input_mode"] == 2:
                    rate = max(0.01, ctl["config"]["vel_ramp_rate"])
                    cur = ctl["vel_setpoint"]
                    step = max(-rate * dt, min(rate * dt, target_vel - cur))
                    target_vel = cur + step
            elif mode == CONTROL_MODE_TORQUE:
                # 扭矩模式：无负载 -> 速度向 vel_limit 加速，带粘滞阻尼
                accel = ctl["input_torque"] / 0.008  # J = 0.008 kg·m² 等效
                sim.vel += accel * dt
                sim.vel *= (1.0 - 0.8 * dt)  # 阻尼
                sim.vel = max(-vel_lim, min(vel_lim, sim.vel))
                target_vel = sim.vel
            else:
                target_vel = 0.0
            # 一阶速度环响应
            tau = 0.12
            if mode != CONTROL_MODE_TORQUE:
                sim.vel += (target_vel - sim.vel) * min(1.0, dt / tau)
            sim.pos += sim.vel * dt
            # 电流估计: 加速项 + 摩擦项
            torque = 0.008 * (target_vel - sim.vel) / tau + 0.02 * sim.vel
            if mode == CONTROL_MODE_TORQUE:
                torque = ctl["input_torque"]
            iq = torque / kt
            iq_lim = mcfg["current_lim"]
            sim.iq = max(-iq_lim, min(iq_lim, iq)) + random.uniform(-0.05, 0.05)
            ctl["pos_setpoint"] = ctl["input_pos"]
            ctl["vel_setpoint"] = target_vel
            ctl["torque_setpoint"] = torque
        else:
            sim.iq = 0.0
            sim.vel *= (1.0 - 2.0 * dt)  # 惰转
            sim.pos += sim.vel * dt

        # ---- 温度模型 ----
        heat = 0.05 * sim.iq * sim.iq
        sim.fet_temp += (30.0 + heat * 8 - sim.fet_temp) * 0.02 * dt * 50
        sim.motor_temp += (28.0 + heat * 5 - sim.motor_temp) * 0.008 * dt * 50
        if self._overtemp_axis == n:
            sim.fet_temp = 96.0
            ax["motor"]["error"] |= MOTOR_ERROR_MOTOR_THERMISTOR_OVER_TEMP
            if sim.state == AXIS_STATE_CLOSED_LOOP_CONTROL:
                sim.state = AXIS_STATE_IDLE
                ax["current_state"] = AXIS_STATE_IDLE
                ax["error"] |= AXIS_ERROR_MOTOR_FAILED

        # ---- 写回可观测量 ----
        enc = ax["encoder"]
        enc["pos_estimate"] = round(sim.pos, 5)
        enc["vel_estimate"] = round(sim.vel + random.uniform(-0.004, 0.004), 5)
        enc["shadow_count"] = int(sim.pos * enc["config"]["cpr"])
        ax["motor"]["current_control"]["Iq_measured"] = round(sim.iq, 4)
        ax["motor"]["current_control"]["Iq_setpoint"] = round(sim.iq, 4)
        ax["fet_thermistor"]["temperature"] = round(sim.fet_temp, 2)
        ax["motor_thermistor"]["temperature"] = round(sim.motor_temp, 2)
        return abs(sim.iq) * 0.35  # 折算母线电流

    # -------------------------------------------------------- fault injection
    def inject_fault(self, kind: str, axis: int = 0, duration: float = 5.0) -> str:
        """故障注入，用于测试上位机容错。"""
        if kind == "comm_loss":
            self._comm_lost_until = time.monotonic() + duration
            return f"通信将中断 {duration}s (communication loss)"
        if kind == "undervoltage":
            self._vbus_dip_until = time.monotonic() + duration
            return f"母线电压将跌落至 7.2V，持续 {duration}s (undervoltage)"
        if kind == "axis_error":
            ax = self.tree[f"axis{axis}"]
            ax["error"] |= AXIS_ERROR_ENCODER_FAILED
            ax["encoder"]["error"] |= ENCODER_ERROR_NO_RESPONSE
            self._sim[axis].state = AXIS_STATE_IDLE
            ax["current_state"] = AXIS_STATE_IDLE
            return f"轴 {axis} 已注入编码器错误 (encoder error injected)"
        if kind == "overtemp":
            self._overtemp_axis = axis
            return f"轴 {axis} 已注入过温 (overtemperature injected)"
        if kind == "clear":
            self._overtemp_axis = None
            self._vbus_dip_until = 0.0
            self._clear_errors()
            return "已清除注入的故障 (injected faults cleared)"
        raise ValueError(f"unknown fault kind: {kind}")

    def calib_progress(self, axis: int) -> dict:
        sim = self._sim[axis]
        return {"phase": sim.calib_phase, "progress": sim.calib_progress,
                "state": sim.state}
