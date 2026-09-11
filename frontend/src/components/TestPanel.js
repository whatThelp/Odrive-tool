// 手动测试：位置/速度/扭矩实时下发 + 速度斜坡 + 状态切换 + 模拟器故障注入
import { store, toast, log, pushHistory, axisCalibrated, writeSingle } from '../store.js';
import { api } from '../api.js';
import { CONTROL_MODES, stateLabel, stateBadgeClass, fmtNum } from '../labels.js';
import AxisStatus from './AxisStatus.js';

export default {
  name: 'TestPanel',
  components: { AxisStatus },
  data() {
    return {
      mode: 3,             // 3=位置 2=速度 1=扭矩
      pos: 0, vel: 0, torque: 0,
      posRange: 20, velRange: 10, torqueRange: 0.5,
      rampOn: false,       // 速度斜坡使能 (INPUT_MODE_VEL_RAMP)
      rampRate: 10,        // 速度斜率 vel_ramp_rate (turns/s²)
      velLimit: 10,        // 最大速度限制 vel_limit (turns/s)，扭矩模式下同样生效
      pid: { pos_gain: 20, vel_gain: 0.16, vel_integrator_gain: 0.32 },
      CONTROL_MODES,
      faultAxis: 0,
    };
  },
  computed: {
    store() { return store; },
    n() { return store.axis; },
    axisState() {
      const p = (store.iface?.telemetry_paths || []).find(
        (x) => x.label_en === 'Axis State' && x.axis === this.n);
      return p ? store.tele[p.path] : undefined;
    },
    curValue: {
      get() { return this.mode === 3 ? this.pos : this.mode === 2 ? this.vel : this.torque; },
      set(v) {
        if (this.mode === 3) this.pos = v;
        else if (this.mode === 2) this.vel = v;
        else this.torque = v;
      },
    },
    range() {
      return this.mode === 3 ? this.posRange : this.mode === 2 ? this.velRange : this.torqueRange;
    },
    unit() { return this.mode === 3 ? 'turns' : this.mode === 2 ? 'turns/s' : 'N·m'; },
  },
  methods: {
    fmtNum, stateLabel, stateBadgeClass, axisCalibrated,
    async setMode(m) {
      this.mode = m;
      await this.push(true);
    },
    // ---- 速度斜坡 Velocity ramp ----
    inputMode() { return this.mode === 2 && this.rampOn ? 2 : 1; },
    async toggleRamp(e) {
      this.rampOn = e.target.checked;
      try {
        await api.post(`/api/axes/${this.n}/input`, { input_mode: this.inputMode() });
        log(`轴 Axis ${this.n} 速度斜坡 ${this.rampOn ? '启用 (VEL_RAMP)' : '关闭 (PASSTHROUGH)'}`);
      } catch (err) { toast(`输入模式切换失败: ${err.message}`, 'error'); }
    },
    async setRampRate(e) {
      const v = parseFloat(e.target.value);
      if (Number.isNaN(v) || v <= 0) return;
      this.rampRate = v;
      try {
        const a = await writeSingle(`axis${this.n}.controller.config.vel_ramp_rate`, v);
        this.rampRate = a.value;
        pushHistory('param', `axis${this.n}.controller.config.vel_ramp_rate = ${a.value} (原 ${fmtNum(a.old)})`,
          { path: a.path, old: a.old });
        log(`速度斜率 vel_ramp_rate = ${a.value} turns/s²`);
      } catch (err) { toast(`斜率写入失败: ${err.message}`, 'error'); }
    },
    loadRamp() {
      const cfg = (leaf) => store.values[`axis${this.n}.controller.config.${leaf}`];
      const r = cfg('vel_ramp_rate');
      if (typeof r === 'number') this.rampRate = r;
      this.rampOn = cfg('input_mode') === 2;
      if (typeof cfg('vel_limit') === 'number') this.velLimit = cfg('vel_limit');
      for (const k of Object.keys(this.pid)) {
        if (typeof cfg(k) === 'number') this.pid[k] = cfg(k);
      }
    },
    // 通用: 写控制器配置参数（经安全钳位，记入历史可撤销）
    async writeCfg(leaf, v, label) {
      const path = `axis${this.n}.controller.config.${leaf}`;
      const a = await writeSingle(path, v);
      pushHistory('param', `${path} = ${a.value} (原 ${fmtNum(a.old)})`,
        { path, old: a.old });
      log(`${label} = ${a.value}`);
      return a.value;
    },
    async setVelLimit(e) {
      const v = parseFloat(e.target.value);
      if (Number.isNaN(v) || v <= 0) return;
      try {
        this.velLimit = await this.writeCfg('vel_limit', v, `速度限制 vel_limit`);
      } catch (err) { toast(`速度限制写入失败: ${err.message}`, 'error'); }
    },
    async setPid(key, label, e) {
      const v = parseFloat(e.target.value);
      if (Number.isNaN(v) || v < 0) return;
      try {
        this.pid[key] = await this.writeCfg(key, v, label);
      } catch (err) { toast(`${label} 写入失败: ${err.message}`, 'error'); }
    },
    syncMode() {
      // 挂载/切轴时与设备当前控制模式对齐，避免界面与设备状态不一致
      const cm = store.tele[`axis${this.n}.controller.config.control_mode`]
        ?? store.values[`axis${this.n}.controller.config.control_mode`];
      if (cm === 1 || cm === 2 || cm === 3) this.mode = cm;
    },
    onSlide(e) {
      this.curValue = parseFloat(e.target.value);
      this.pushThrottled();
    },
    onNum(e) {
      const v = parseFloat(e.target.value);
      if (!Number.isNaN(v)) { this.curValue = v; this.push(); }
    },
    pushThrottled() {
      const now = Date.now();
      if (now - (this._lastPush || 0) < 80) {
        clearTimeout(this._pushTimer);
        this._pushTimer = setTimeout(() => this.push(), 90);
        return;
      }
      this.push();
    },
    async push(withMode = false) {
      this._lastPush = Date.now();
      const body = withMode
        ? { control_mode: this.mode, input_mode: this.inputMode() } : {};
      if (this.mode === 3) body.pos = this.pos;
      else if (this.mode === 2) body.vel = this.vel;
      else body.torque = this.torque;
      try { await api.post(`/api/axes/${this.n}/input`, body); } catch (e) {
        toast(`设定值下发失败: ${e.message}`, 'error');
      }
    },
    async setState(s, name) {
      try {
        // 进入闭环前，同步当前控制模式
        if (s === 8) await api.post(`/api/axes/${this.n}/input`, { control_mode: this.mode });
        await api.post(`/api/axes/${this.n}/state`, { state: s });
        log(`轴 Axis ${this.n} → ${name}`);
        pushHistory('action', `轴 ${this.n} 请求状态 ${name}`);
      } catch (e) { toast(`状态切换失败: ${e.message}`, 'error'); }
    },
    zero() { this.curValue = 0; this.push(); },
    async inject(kind, label) {
      try {
        const r = await api.post('/api/mock/fault', { kind, axis: this.faultAxis, duration: 6 });
        toast(`故障注入 Fault injected: ${r.message}`, 'warn', 6000);
      } catch (e) { toast(`注入失败: ${e.message}`, 'error'); }
    },
  },
  watch: {
    n() { this.loadRamp(); this.syncMode(); },
    'store.values': { handler() { this.loadRamp(); }, deep: false },
  },
  mounted() { this.loadRamp(); this.syncMode(); },
  activated() { this.loadRamp(); this.syncMode(); }, // keep-alive 返回时与设备对齐
  template: `
  <div>
    <div class="cards" style="grid-template-columns: repeat(auto-fit, minmax(min(380px, 100%), 1fr));">
      <div class="card axis-card" :class="'a' + n">
        <h3>手动控制 <span class="en">Manual Control</span> —
          <span class="axis-name">轴 Axis {{ n }}</span>
          <span v-if="axisCalibrated(n) === false" class="badge uncal">⚠ 未校准 UNCALIBRATED</span>
          <span class="badge" :class="stateBadgeClass(axisState)" style="margin-left:auto">{{ stateLabel(axisState) }}</span>
        </h3>
        <div v-if="axisCalibrated(n) === false" class="warnbox">
          ⚠ 该轴尚未校准，无法进入闭环。请先到「校准向导 Calibration」完成一键校准。
        </div>

        <div class="row" style="margin-bottom:12px">
          <span class="muted">控制模式 Control Mode:</span>
          <label v-for="m in CONTROL_MODES" :key="m.value" class="series-pick" :class="{on: mode === m.value}"
                 @click="setMode(m.value)">
            {{ m.zh }} {{ m.en }}
          </label>
        </div>

        <!-- 扭矩模式：最大速度限制，防止空载飞车 -->
        <div class="row ramp-box" v-if="mode === 1" style="margin-bottom:12px">
          <span>最大速度限制 <span class="muted">Max Velocity Limit</span>:</span>
          <input type="number" step="any" min="0.1" :value="velLimit" @change="setVelLimit"
                 style="width:90px">
          <span class="muted">turns/s</span>
          <span class="muted" style="font-size:11px">
            扭矩模式下电机转速被限制在该值内（写入 vel_limit），防止空载飞车。
          </span>
        </div>

        <!-- 速度斜坡（速度斜率）控制，仅速度模式显示 -->
        <div class="row ramp-box" v-if="mode === 2" style="margin-bottom:12px">
          <label class="row" style="gap:5px; cursor:pointer">
            <input type="checkbox" :checked="rampOn" @change="toggleRamp">
            <span>速度斜坡 <span class="muted">Vel Ramp</span></span>
          </label>
          <span class="muted">斜率 Ramp Rate:</span>
          <input type="number" step="any" min="0.1" :value="rampRate" @change="setRampRate"
                 :disabled="!rampOn" style="width:90px">
          <span class="muted">turns/s²</span>
          <span class="muted" style="font-size:11px">
            启用后设定值按此加速度平滑过渡，避免速度跳变冲击。
          </span>
        </div>

        <div class="row" style="margin-bottom:6px">
          <span class="muted grow">设定值 Setpoint ({{ unit }}):</span>
          <input type="number" step="any" :value="curValue" @change="onNum" style="width:110px">
          <button class="btn small" @click="zero">归零 Zero</button>
        </div>
        <input type="range" :min="-range" :max="range" step="0.01" :value="curValue"
               @input="onSlide" style="width:100%">
        <div class="row" style="justify-content:space-between; font-size:11px;" class-x="muted">
          <span class="muted">-{{ range }}</span>
          <span class="muted">量程 Range:
            <input type="number" step="any" min="0.01"
                   :value="range"
                   @change="e => { const v = parseFloat(e.target.value)||1; if (mode===3) posRange=v; else if (mode===2) velRange=v; else torqueRange=v; }"
                   style="width:70px"></span>
          <span class="muted">+{{ range }}</span>
        </div>

        <div class="row" style="margin-top:14px">
          <button class="btn primary" @click="setState(8, '闭环 CLOSED_LOOP')"
                  :disabled="store.conn!=='connected' || axisCalibrated(n) === false"
                  :title="axisCalibrated(n) === false ? '未校准，请先完成校准 calibrate first' : ''">▶ 进入闭环 Closed Loop</button>
          <button class="btn" @click="setState(1, '空闲 IDLE')"
                  :disabled="store.conn!=='connected'">■ 空闲 Idle</button>
        </div>
        <div class="warnbox" style="margin-top:12px; margin-bottom:0">
          ⚠ 进入闭环后电机立即受控，请确认负载安全、设定值已归零。<br>
          Motor is live in closed-loop. Ensure the load is safe and setpoint is zeroed.
        </div>
      </div>

      <!-- 电机实时状态：电流/闭环状态/控制模式/转速/设定转速等全量显示 -->
      <AxisStatus :axis="n" />

      <!-- 环路增益 PID 在线整定 -->
      <div class="card axis-card" :class="'a' + n">
        <h3>环路增益整定 <span class="en">PID Gains</span> —
          <span class="axis-name">轴 Axis {{ n }}</span></h3>
        <div class="pid-row">
          <div class="lbl">位置环增益 <span class="muted">Pos Gain (P)</span>
            <div class="en muted">(turn/s)/turn · 过大易超调振荡</div></div>
          <input type="number" step="any" min="0" :value="pid.pos_gain"
                 @change="setPid('pos_gain', '位置环增益 pos_gain', $event)">
        </div>
        <div class="pid-row">
          <div class="lbl">速度环增益 <span class="muted">Vel Gain (P)</span>
            <div class="en muted">N·m/(turn/s) · 过大高频啸叫，过小响应迟缓</div></div>
          <input type="number" step="any" min="0" :value="pid.vel_gain"
                 @change="setPid('vel_gain', '速度环增益 vel_gain', $event)">
        </div>
        <div class="pid-row">
          <div class="lbl">速度环积分增益 <span class="muted">Vel Integrator (I)</span>
            <div class="en muted">N·m/turn · 消除稳态误差，经验值 ≈ 0.5×带宽×vel_gain</div></div>
          <input type="number" step="any" min="0" :value="pid.vel_integrator_gain"
                 @change="setPid('vel_integrator_gain', '速度环积分增益 vel_integrator_gain', $event)">
        </div>
        <div class="muted" style="font-size:11.5px; margin-top:8px">
          修改立即写入设备（RAM），配合实时图表观察阶跃响应；可用 撤销 Undo (Ctrl+Z) 回退。
          持久保存请点顶栏「保存配置 Save」。
        </div>
      </div>

      <div class="card" v-if="store.device?.is_mock">
        <h3>模拟器故障注入 <span class="en">Simulator Fault Injection</span></h3>
        <div class="muted" style="margin-bottom:10px; font-size:12px">
          用于测试上位机容错性：通信中断、错误触发、欠压、过温。<br>
          Test host-side fault tolerance: comm loss, errors, undervoltage, overtemp.
        </div>
        <div class="row" style="margin-bottom:10px">
          <span class="muted">目标轴 Axis:</span>
          <select v-model.number="faultAxis"><option :value="0">Axis 0</option><option :value="1">Axis 1</option></select>
        </div>
        <div class="row">
          <button class="btn small" @click="inject('comm_loss')">通信中断 Comm Loss (6s)</button>
          <button class="btn small" @click="inject('axis_error')">触发轴错误 Axis Error</button>
          <button class="btn small" @click="inject('undervoltage')">母线欠压 Undervoltage</button>
          <button class="btn small" @click="inject('overtemp')">过温 Overtemp</button>
          <button class="btn small primary" @click="inject('clear')">恢复 Clear Faults</button>
        </div>
      </div>

      <div class="card" v-else>
        <h3>提示 <span class="en">Note</span></h3>
        <div class="muted">当前为真实硬件连接。故障注入功能仅在模拟设备模式下可用。<br>
        Fault injection is only available with the mock device.</div>
      </div>
    </div>
  </div>`,
};
