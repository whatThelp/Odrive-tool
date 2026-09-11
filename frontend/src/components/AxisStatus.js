// 电机实时状态卡：状态量全量显示（手动测试 / 校准向导 共用）
// 包括：闭环状态、校准状态、控制/输入模式、位置、转速、设定转速、
// 电机电流(Iq)与设定、母线电压/电流、温度、错误码。
import { store, axisCalibrated } from '../store.js';
import { stateLabel, stateBadgeClass, controlModeLabel, inputModeLabel, fmtNum } from '../labels.js';

export default {
  name: 'AxisStatus',
  props: { axis: { type: Number, required: true } },
  computed: {
    store() { return store; },
    n() { return this.axis; },
    axisErr() {
      return store.errorsActive.filter((e) => e.source.startsWith(`axis${this.n}`));
    },
  },
  methods: {
    fmtNum, stateLabel, stateBadgeClass, controlModeLabel, inputModeLabel, axisCalibrated,
    t(labelEn) {
      const p = (store.iface?.telemetry_paths || []).find(
        (x) => x.label_en === labelEn && (x.axis === undefined || x.axis === this.n));
      return p ? store.tele[p.path] : undefined;
    },
    s(leaf) { return store.tele[`axis${this.n}.controller.config.${leaf}`]; },
    tempStyle(v) {
      if (v == null) return '';
      if (v >= 80) return 'color:var(--critical); font-weight:700';
      if (v >= 60) return 'color:var(--warning)';
      return '';
    },
  },
  template: `
  <div class="card axis-card" :class="['a' + n, { uncal: axisCalibrated(n) === false }]">
    <h3>
      电机实时状态 <span class="en">Motor Live Status</span> —
      <span class="axis-name">轴 Axis {{ n }}</span>
      <span v-if="axisCalibrated(n) === false" class="badge uncal">⚠ 未校准 UNCALIBRATED</span>
      <span v-else-if="axisCalibrated(n)" class="badge green">已校准 Calibrated</span>
      <span class="badge" :class="stateBadgeClass(t('Axis State'))" style="margin-left:auto">
        {{ stateLabel(t('Axis State')) }}
      </span>
    </h3>
    <div class="status-grid">
      <div class="kv"><span class="k">控制模式 Control Mode</span>
        <span class="v">{{ controlModeLabel(s('control_mode')) }}</span></div>
      <div class="kv"><span class="k">输入模式 Input Mode</span>
        <span class="v">{{ inputModeLabel(s('input_mode')) }}</span></div>
      <div class="kv"><span class="k">位置 Position</span>
        <span class="v">{{ fmtNum(t('Position')) }} turns</span></div>
      <div class="kv"><span class="k">位置设定 Pos Setpoint</span>
        <span class="v">{{ fmtNum(t('Pos Setpoint')) }} turns</span></div>
      <div class="kv"><span class="k">电机转速 Velocity</span>
        <span class="v">{{ fmtNum(t('Velocity')) }} turns/s</span></div>
      <div class="kv"><span class="k">设定转速 Vel Setpoint</span>
        <span class="v">{{ fmtNum(t('Vel Setpoint')) }} turns/s</span></div>
      <div class="kv"><span class="k">电机电流 Iq Measured</span>
        <span class="v">{{ fmtNum(t('Iq Measured'), 2) }} A</span></div>
      <div class="kv"><span class="k">电流设定 Iq Setpoint</span>
        <span class="v">{{ fmtNum(t('Iq Setpoint'), 2) }} A</span></div>
      <div class="kv"><span class="k">母线电压 Bus Voltage</span>
        <span class="v">{{ fmtNum(store.tele.vbus_voltage, 2) }} V</span></div>
      <div class="kv"><span class="k">母线电流 Bus Current</span>
        <span class="v">{{ fmtNum(store.tele.ibus, 2) }} A</span></div>
      <div class="kv"><span class="k">MOSFET 温度 FET Temp</span>
        <span class="v" :style="tempStyle(t('FET Temp'))">{{ fmtNum(t('FET Temp'), 1) }} °C</span></div>
      <div class="kv"><span class="k">电机温度 Motor Temp</span>
        <span class="v" :style="tempStyle(t('Motor Temp'))">{{ fmtNum(t('Motor Temp'), 1) }} °C</span></div>
      <div class="kv"><span class="k">轴错误 Axis Error</span>
        <span class="v" :style="t('Axis Error') ? 'color:var(--critical); font-weight:700' : 'color:var(--good)'">
          {{ t('Axis Error') ? '0x' + t('Axis Error').toString(16).toUpperCase() : '无 OK' }}</span></div>
    </div>
    <div v-if="axisErr.length" style="margin-top:6px">
      <span class="errchip" v-for="e in axisErr" :key="e.source">
        <b class="mono">{{ e.source }}</b> —
        <template v-for="(d, i) in e.decoded" :key="d.bit">{{ i ? '; ' : '' }}{{ d.zh }} ({{ d.en }})</template>
      </span>
    </div>
  </div>`,
};
