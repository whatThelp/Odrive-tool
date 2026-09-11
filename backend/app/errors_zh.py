"""ODrive 错误代码中文解读 Error code decoding (zh + en)."""
from __future__ import annotations

AXIS_STATES = {
    0: ("未定义", "UNDEFINED"),
    1: ("空闲", "IDLE"),
    2: ("启动序列", "STARTUP_SEQUENCE"),
    3: ("完整校准序列", "FULL_CALIBRATION_SEQUENCE"),
    4: ("电机校准", "MOTOR_CALIBRATION"),
    6: ("编码器索引搜索", "ENCODER_INDEX_SEARCH"),
    7: ("编码器偏移校准", "ENCODER_OFFSET_CALIBRATION"),
    8: ("闭环控制", "CLOSED_LOOP_CONTROL"),
    9: ("锁相旋转", "LOCKIN_SPIN"),
    10: ("编码器方向搜索", "ENCODER_DIR_FIND"),
    11: ("回零", "HOMING"),
}

_ODRIVE_ERRORS = {
    0x01: ("控制迭代丢失", "CONTROL_ITERATION_MISSED"),
    0x02: ("母线欠压", "DC_BUS_UNDER_VOLTAGE"),
    0x04: ("母线过压", "DC_BUS_OVER_VOLTAGE"),
    0x08: ("母线欠压", "DC_BUS_UNDER_VOLTAGE"),
    0x10: ("制动占空比过高", "BRAKE_DEADTIME_VIOLATION"),
    0x20: ("制动电阻未配置", "BRAKE_DUTY_CYCLE_NAN"),
    0x40: ("回馈电流超限", "INVALID_BRAKE_RESISTANCE"),
}

_AXIS_ERRORS = {
    0x01: ("初始化状态无效", "INVALID_STATE"),
    0x40: ("电机故障（见电机错误）", "MOTOR_FAILED"),
    0x80: ("传感器缺失错误", "SENSORLESS_ESTIMATOR_FAILED"),
    0x100: ("编码器故障（见编码器错误）", "ENCODER_FAILED"),
    0x200: ("控制器故障（见控制器错误）", "CONTROLLER_FAILED"),
    0x800: ("看门狗超时", "WATCHDOG_TIMER_EXPIRED"),
    0x1000: ("最小续航电压", "MIN_ENDSTOP_PRESSED"),
    0x2000: ("最大限位触发", "MAX_ENDSTOP_PRESSED"),
    0x4000: ("限位开关无效", "ESTOP_REQUESTED"),
    0x20000: ("回零未完成", "HOMING_WITHOUT_ENDSTOP"),
    0x40000: ("过温", "OVER_TEMP"),
    0x80000: ("未知位置", "UNKNOWN_POSITION"),
}

_MOTOR_ERRORS = {
    0x01: ("相电阻超范围", "PHASE_RESISTANCE_OUT_OF_RANGE"),
    0x02: ("相电感超范围", "PHASE_INDUCTANCE_OUT_OF_RANGE"),
    0x08: ("DRV 驱动芯片故障", "DRV_FAULT"),
    0x10: ("控制超时", "CONTROL_DEADLINE_MISSED"),
    0x80: ("调制幅值超限", "MODULATION_MAGNITUDE"),
    0x400: ("电流采样超时", "CURRENT_SENSE_SATURATION"),
    0x1000: ("电流超限", "CURRENT_LIMIT_VIOLATION"),
    0x10000: ("调制指数为 NaN", "MODULATION_IS_NAN"),
    0x20000: ("电机过热", "MOTOR_THERMISTOR_OVER_TEMP"),
    0x400000: ("电机热敏电阻过温", "MOTOR_THERMISTOR_OVER_TEMP"),
    0x800000: ("MOSFET 热敏电阻过温", "FET_THERMISTOR_OVER_TEMP"),
    0x1000000: ("超时", "TIMER_UPDATE_MISSED"),
    0x2000000: ("电流测量不可用", "CURRENT_MEASUREMENT_UNAVAILABLE"),
    0x4000000: ("控制器故障", "CONTROLLER_FAILED"),
    0x8000000: ("I 总线超限", "I_BUS_OUT_OF_RANGE"),
    0x10000000: ("制动电阻断开", "BRAKE_RESISTOR_DISARMED"),
    0x20000000: ("系统级错误", "SYSTEM_LEVEL"),
    0x40000000: ("坏轴", "BAD_TIMING"),
}

_ENCODER_ERRORS = {
    0x01: ("编码器不稳定", "UNSTABLE_GAIN"),
    0x02: ("CPR 与极对数不匹配", "CPR_POLEPAIRS_MISMATCH"),
    0x04: ("编码器无响应", "NO_RESPONSE"),
    0x08: ("索引信号未找到但被要求", "UNSUPPORTED_ENCODER_MODE"),
    0x10: ("非法霍尔状态", "ILLEGAL_HALL_STATE"),
    0x20: ("索引未找到", "INDEX_NOT_FOUND_YET"),
    0x40: ("绝对值编码器 SPI 通信失败", "ABS_SPI_TIMEOUT"),
    0x80: ("SPI 通信未确认", "ABS_SPI_COM_FAIL"),
    0x100: ("绝对值编码器未就绪", "ABS_SPI_NOT_READY"),
    0x200: ("霍尔信号未校准", "HALL_NOT_CALIBRATED_YET"),
}

_CONTROLLER_ERRORS = {
    0x01: ("超速", "OVERSPEED"),
    0x02: ("输入模式无效", "INVALID_INPUT_MODE"),
    0x04: ("不满足回零条件", "UNSTABLE_GAIN"),
    0x08: ("镜像轴无效", "INVALID_MIRROR_AXIS"),
    0x10: ("负载编码器无效", "INVALID_LOAD_ENCODER"),
    0x20: ("估计值无效", "INVALID_ESTIMATE"),
    0x40: ("输出限幅", "INVALID_CIRCULAR_RANGE"),
    0x80: ("自旋检测", "SPINOUT_DETECTED"),
}

_MAPS = {
    "odrive": _ODRIVE_ERRORS,
    "axis": _AXIS_ERRORS,
    "motor": _MOTOR_ERRORS,
    "encoder": _ENCODER_ERRORS,
    "controller": _CONTROLLER_ERRORS,
}


def decode(kind: str, code: int) -> list[dict]:
    """把错误位掩码解码为 [{bit, zh, en}]。"""
    table = _MAPS.get(kind, {})
    out = []
    if not code:
        return out
    bit = 1
    while bit <= code:
        if code & bit:
            zh, en = table.get(bit, ("未知错误位", f"UNKNOWN_0x{bit:X}"))
            out.append({"bit": bit, "zh": zh, "en": en})
        bit <<= 1
    return out


def axis_state_label(state: int) -> dict:
    zh, en = AXIS_STATES.get(int(state), ("未知", f"STATE_{state}"))
    return {"value": int(state), "zh": zh, "en": en}
