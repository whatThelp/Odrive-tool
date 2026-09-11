// 仪表盘：母线电压/电流、轴状态、温度、虚拟 LED、错误诊断
import { store, deviceAction, refreshErrors, axisCalibrated } from '../store.js';
import { api } from '../api.js';
import { stateLabel, stateBadgeClass, fmtNum } from '../labels.js';

export default {
  name: 'Dashboard',
  computed: {
    store() { return store; },
    axes() {
      return Array.from({ length: store.device?.axis_count ?? 0 }, (_, n) => n);
    },
    vbus() { return store.tele.vbus_voltage; },
    ibus() { return store.tele.ibus; },
    vRange() { return store.voltageRange || [8, 56]; },
    vbusPct() {
      const [lo, hi] = this.vRange;
      if (this.vbus == null) return 0;
      return Math.max(0, Math.min(100, ((this.vbus - lo) / (hi - lo)) * 100));
    },
    vbusClass() {
      const ov = store.values['config.dc_bus_overvoltage_trip_level'];
      const uv = store.values['config.dc_bus_undervoltage_trip_level'];
      if (this.vbus == null) return '';
      if ((uv && this.vbus < uv + 1) || (ov && this.vbus > ov - 1)) return 'crit';
      return '';
    },
  },
  methods: {
    fmtNum,
    stateLabel,
    stateBadgeClass,
    axisCalibrated,
    goCalibrate(n) { store.axis = n; store.tab = 'calib'; },
    t(labelEn, axis) {
      // 按固件版本自适应遥测路径 (v0.5 与 v0.6 路径不同)
      const p = (store.iface?.telemetry_paths || []).find(
        (x) => x.label_en === labelEn && (x.axis === undefined || x.axis === axis));
      return p ? store.tele[p.path] : undefined;
    },
    axisState(n) { return this.t('Axis State', n); },
    ledClass(n) {
      const s = this.axisState(n);
      const err = this.t('Axis Error', n);
      if (err) return 'red blink';
      if (s === 8) return 'green pulse';
      if (s === 3 || s === 4 || s === 6 || s === 7) return 'yellow blink';
      if (s === 1) return 'blue';
      return '';
    },
    tempClass(v) {
      if (v == null) return '';
      if (v >= 80) return 'crit';
      if (v >= 60) return 'warn';
      return '';
    },
    async setState(n, s) {
      try { await api.post(`/api/axes/${n}/state`, { state: s }); } catch (e) { /* toast in axios */ }
    },
    axisErrors(n) {
      return store.errorsActive.filter((e) => e.source.startsWith(`axis${n}`));
    },
    clearErrors() { deviceAction('clear_errors', '错误已清除 (errors cleared)'); refreshErrors(); },
    eraseReboot() {
      if (window.confirm('确定要擦除全部配置并重启 ODrive 吗？\n此操作不可撤销！\nErase all configuration and reboot?')) {
        deviceAction('erase_reboot', '配置已擦除，设备重启中 (erased & rebooting)');
      }
    },
  },
  mounted() { refreshErrors(); },
  template: `
  <div v-if="store.conn === 'disconnected'" class="muted" style="padding:40px; text-align:center;">
    <div style="font-size:15px; margin-bottom:8px;">未连接设备 Not Connected</div>
    <div>请在顶部工具栏扫描并连接 ODrive 设备（或以 --mock 启动使用模拟器）。<br>
    Scan and connect an ODrive from the top bar (or start with --mock for the simulator).</div>
  </div>
  <div v-else>
    <div class="cards">
      <!-- 电源卡 Power -->
      <div class="card">
        <h3><span class="led" :class="vbus != null ? 'blue' : ''"></span>
            母线电源 <span class="en">DC Bus</span></h3>
        <div class="bignum" :class="vbusClass">{{ fmtNum(vbus, 2) }}<small>V</small></div>
        <div class="gaugebar"><div class="fill" :class="vbusClass" :style="{width: vbusPct + '%'}"></div></div>
        <div class="kv" style="margin-top:8px">
          <span class="k">母线电流 Bus Current</span>
          <span class="v">{{ fmtNum(ibus, 2) }} A</span>
        </div>
        <div class="kv">
          <span class="k">电压范围 Range ({{ store.device?.hw_variant }}V 版本)</span>
          <span class="v">{{ vRange[0] }} – {{ vRange[1] }} V</span>
        </div>
        <div class="kv">
          <span class="k">过压 / 欠压阈值 OV / UV Trip</span>
          <span class="v">{{ fmtNum(store.values['config.dc_bus_overvoltage_trip_level'], 1) }} / {{ fmtNum(store.values['config.dc_bus_undervoltage_trip_level'], 1) }} V</span>
        </div>
      </div>

      <!-- 轴卡 Axis cards: A0 蓝 / A1 琥珀，未校准高亮 -->
      <div class="card axis-card" v-for="n in axes" :key="n"
           :class="['a' + n, { focused: store.axis === n, uncal: axisCalibrated(n) === false }]">
        <h3>
          <span class="led" :class="ledClass(n)"></span>
          <span class="axis-name">轴 {{ n }} <span class="en">Axis {{ n }}</span></span>
          <span v-if="axisCalibrated(n) === false" class="badge uncal"
                title="该轴尚未完成校准，无法进入闭环控制 Axis not calibrated yet">⚠ 未校准 UNCALIBRATED</span>
          <span class="badge" :class="stateBadgeClass(axisState(n))" style="margin-left:auto">
            {{ stateLabel(axisState(n)) }}
          </span>
        </h3>
        <div class="kv"><span class="k">位置 Position</span>
          <span class="v">{{ fmtNum(t('Position', n)) }} turns</span></div>
        <div class="kv"><span class="k">速度 Velocity</span>
          <span class="v">{{ fmtNum(t('Velocity', n)) }} turns/s</span></div>
        <div class="kv"><span class="k">q轴电流 Iq</span>
          <span class="v">{{ fmtNum(t('Iq Measured', n), 2) }} A</span></div>
        <div class="kv"><span class="k">MOSFET 温度 FET Temp</span>
          <span class="v" :class="'bignum-'+tempClass(t('FET Temp', n))"
                :style="tempClass(t('FET Temp', n))==='crit' ? 'color:var(--critical)'
                       : tempClass(t('FET Temp', n))==='warn' ? 'color:var(--warning)' : ''">
            {{ fmtNum(t('FET Temp', n), 1) }} °C
            <span v-if="tempClass(t('FET Temp', n))==='crit'">⚠ 过热!</span>
            <span v-else-if="tempClass(t('FET Temp', n))==='warn'">⚠</span>
          </span></div>
        <div class="kv"><span class="k">电机温度 Motor Temp</span>
          <span class="v" :style="tempClass(t('Motor Temp', n))==='crit' ? 'color:var(--critical)'
                       : tempClass(t('Motor Temp', n))==='warn' ? 'color:var(--warning)' : ''">
            {{ fmtNum(t('Motor Temp', n), 1) }} °C</span></div>
        <div class="row" style="margin-top:8px">
          <button class="btn small" @click="setState(n, 8)"
                  :disabled="axisCalibrated(n) === false"
                  :title="axisCalibrated(n) === false ? '未校准，请先完成校准 calibrate first' : ''">进入闭环 Closed Loop</button>
          <button class="btn small" @click="setState(n, 1)">空闲 Idle</button>
          <button v-if="axisCalibrated(n) === false" class="btn small"
                  style="border-color:var(--warning); color:var(--warning)"
                  @click="goCalibrate(n)">→ 去校准 Calibrate</button>
        </div>
        <!-- 该轴的活跃错误 Axis-local active errors -->
        <div v-if="axisErrors(n).length" style="margin-top:8px">
          <span class="errchip" v-for="e in axisErrors(n)" :key="e.source">
            <b class="mono">{{ e.source }}</b> —
            <template v-for="(d, i) in e.decoded" :key="d.bit">{{ i ? '; ' : '' }}{{ d.zh }} ({{ d.en }})</template>
          </span>
        </div>
      </div>

      <!-- 错误诊断 Errors -->
      <div class="card" style="grid-column: 1 / -1;">
        <h3><span class="led" :class="store.errorsActive.length ? 'red blink' : 'green'"></span>
            错误诊断 <span class="en">Error Diagnostics</span>
            <button class="btn small" style="margin-left:auto" @click="clearErrors">清除错误 Clear Errors</button>
            <button class="btn small danger" @click="eraseReboot">擦除配置并重启 Erase &amp; Reboot</button>
        </h3>
        <div v-if="!store.errorsActive.length" class="muted">无活跃错误 No active errors</div>
        <div v-for="e in store.errorsActive" :key="e.source">
          <span class="errchip">
            <b class="mono">{{ e.source }}</b> = 0x{{ e.code.toString(16).toUpperCase() }} —
            <template v-for="(d, i) in e.decoded" :key="d.bit">{{ i ? '; ' : '' }}{{ d.zh }} ({{ d.en }})</template>
          </span>
        </div>

        <!-- 最近错误记录 Recent error history -->
        <div style="margin-top:12px" v-if="store.errorHistory.length">
          <div class="muted" style="font-weight:600; margin-bottom:4px">
            最近错误记录 Recent Errors
            <button class="btn small" style="margin-left:8px" @click="store.tab='history'">
              查看全部 View All →</button>
          </div>
          <table class="tbl">
            <tbody>
              <tr v-for="(e, i) in store.errorHistory.slice(0, 5)" :key="i">
                <td class="muted" style="width:150px; white-space:nowrap">{{ e.time }}</td>
                <td class="mono" style="width:170px; font-size:11px">{{ e.source }} = 0x{{ (e.code || 0).toString(16).toUpperCase() }}</td>
                <td style="color:var(--serious)">
                  <template v-for="(d, j) in (e.decoded || [])" :key="j">{{ j ? '; ' : '' }}{{ d.zh }} ({{ d.en }})</template>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="muted" v-else style="margin-top:6px; font-size:11.5px;">
          暂无历史错误记录。 No error history yet.
        </div>
      </div>
    </div>
  </div>`,
};
