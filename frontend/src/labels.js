// 轴状态与常量的双语标签 Bilingual labels for states/constants
export const AXIS_STATES = {
  0: { zh: '未定义', en: 'UNDEFINED' },
  1: { zh: '空闲', en: 'IDLE' },
  2: { zh: '启动序列', en: 'STARTUP' },
  3: { zh: '完整校准', en: 'FULL_CALIBRATION' },
  4: { zh: '电机校准', en: 'MOTOR_CALIB' },
  6: { zh: '索引搜索', en: 'INDEX_SEARCH' },
  7: { zh: '编码器校准', en: 'ENCODER_CALIB' },
  8: { zh: '闭环控制', en: 'CLOSED_LOOP' },
  9: { zh: '锁相旋转', en: 'LOCKIN_SPIN' },
  10: { zh: '方向搜索', en: 'DIR_FIND' },
  11: { zh: '回零', en: 'HOMING' },
};

export function stateLabel(v) {
  const s = AXIS_STATES[v] || { zh: '未知', en: `STATE_${v}` };
  return `${s.zh} ${s.en}`;
}

export function stateBadgeClass(v) {
  if (v === 8) return 'green';
  if (v === 1) return '';
  if (v === 0 || v === undefined || v === null) return '';
  return 'yellow'; // 校准等过渡状态
}

export const CONTROL_MODES = [
  { value: 3, zh: '位置控制', en: 'Position' },
  { value: 2, zh: '速度控制', en: 'Velocity' },
  { value: 1, zh: '扭矩控制', en: 'Torque' },
];

export function controlModeLabel(v) {
  const m = { 0: '电压控制 Voltage', 1: '扭矩控制 Torque', 2: '速度控制 Velocity', 3: '位置控制 Position' };
  return m[v] ?? '—';
}

export function inputModeLabel(v) {
  const m = {
    0: '失效 Inactive', 1: '直通 Passthrough', 2: '速度斜坡 Vel Ramp',
    3: '位置滤波 Pos Filter', 5: '梯形轨迹 Trap Traj', 6: '扭矩斜坡 Torque Ramp',
  };
  return m[v] ?? '—';
}

// 图表可选序列颜色（经验证的深色面板类别色）
export const SERIES_COLORS = [
  '#3987e5', '#199e70', '#c98500', '#008300',
  '#9085e9', '#e66767', '#d55181', '#d95926',
];

export function fmtNum(v, digits = 3) {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v !== 'number') return String(v);
  if (Number.isInteger(v)) return String(v);
  return v.toFixed(digits);
}
