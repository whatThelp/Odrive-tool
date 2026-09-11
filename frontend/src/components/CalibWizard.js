// 一键校准向导：电机参数辨识 → 编码器偏移校准 → 闭环测试
import { store, toast, log, pushHistory } from '../store.js';
import { api } from '../api.js';
import { stateLabel } from '../labels.js';
import AxisStatus from './AxisStatus.js';

const STEPS = [
  {
    id: 'check',
    zh: '安全检查', en: 'Safety Check',
    desc: '确认电机可自由旋转、无负载或负载安全，母线电压正常。',
  },
  {
    id: 'motor',
    zh: '电机参数辨识', en: 'Motor Calibration',
    desc: '测量相电阻与相电感，电机会发出短促蜂鸣。约 5 秒。',
  },
  {
    id: 'encoder',
    zh: '编码器偏移校准', en: 'Encoder Offset Calibration',
    desc: '电机将正反旋转约一圈，测定编码器与电角度的偏移。约 10 秒。',
  },
  {
    id: 'closed_loop',
    zh: '闭环控制测试', en: 'Closed-loop Test',
    desc: '短暂进入闭环控制验证校准结果，然后回到空闲。',
  },
];

export default {
  name: 'CalibWizard',
  components: { AxisStatus },
  data() {
    return {
      steps: STEPS.map((s) => ({ ...s, status: 'pending', progress: 0 })),
      running: false,
      currentIdx: -1,
      confirmed: false,
    };
  },
  computed: {
    store() { return store; },
    n() { return store.axis; },
  },
  methods: {
    stateLabel,
    reset() {
      this.steps.forEach((s) => { s.status = 'pending'; s.progress = 0; });
      this.currentIdx = -1;
      this.running = false;
    },
    async poll() {
      return api.get(`/api/calibration/${this.n}/progress`);
    },
    sleep(ms) { return new Promise((r) => setTimeout(r, ms)); },
    async waitIdle(step, timeoutS = 40) {
      // 等待校准完成（回到 IDLE），期间更新进度
      const t0 = Date.now();
      while (Date.now() - t0 < timeoutS * 1000) {
        await this.sleep(500);
        let p;
        try { p = await this.poll(); } catch { continue; }
        if (p.sim && p.sim.progress != null) step.progress = p.sim.progress * 100;
        else step.progress = Math.min(95, step.progress + 4); // 真实硬件无进度，估算
        if (p.error) throw new Error(`轴错误 axis error = 0x${p.error.toString(16)}，请查看错误诊断`);
        if (p.state.value === 1) return p; // 回到 IDLE
      }
      throw new Error('校准超时 (calibration timeout)');
    },
    async runStep(i) {
      const step = this.steps[i];
      this.currentIdx = i;
      step.status = 'active';
      step.progress = 0;
      try {
        if (step.id === 'check') {
          const vbus = store.tele.vbus_voltage;
          if (vbus == null || vbus < 10) {
            throw new Error(`母线电压异常 (${vbus ?? '—'} V)，请检查供电`);
          }
          step.progress = 100;
        } else if (step.id === 'motor') {
          await api.post(`/api/calibration/${this.n}/start`, { mode: 'motor' });
          await this.sleep(600);
          const p = await this.waitIdle(step);
          if (!p.motor_calibrated) throw new Error('电机校准未通过 (motor calibration failed)');
        } else if (step.id === 'encoder') {
          await api.post(`/api/calibration/${this.n}/start`, { mode: 'encoder' });
          await this.sleep(600);
          const p = await this.waitIdle(step);
          if (!p.encoder_ready) throw new Error('编码器校准未通过 (encoder calibration failed)');
        } else if (step.id === 'closed_loop') {
          await api.post(`/api/axes/${this.n}/input`, { pos: 0, control_mode: 3 });
          await api.post(`/api/axes/${this.n}/state`, { state: 8 });
          await this.sleep(1500);
          const p = await this.poll();
          if (p.state.value !== 8) throw new Error('未能进入闭环 (failed to enter closed loop)');
          step.progress = 60;
          await this.sleep(1200);
          await api.post(`/api/axes/${this.n}/state`, { state: 1 });
        }
        step.progress = 100;
        step.status = 'done';
        return true;
      } catch (e) {
        step.status = 'failed';
        toast(`步骤「${step.zh}」失败: ${e.message}`, 'error', 8000);
        log(`校准失败 Calibration failed: ${e.message}`);
        return false;
      }
    },
    async runAll() {
      if (!this.confirmed) {
        if (!window.confirm(
          '⚠ 安全警告 Safety Warning ⚠\n\n校准过程中电机将通电并旋转！\n请确认：\n'
          + ' 1. 电机已牢固固定\n 2. 电机轴上无负载或负载可安全旋转\n 3. 周围无人员/物品接触旋转部件\n\n'
          + 'The motor WILL SPIN during calibration. Continue?')) return;
        this.confirmed = true;
      }
      this.reset();
      this.running = true;
      pushHistory('action', `轴 ${this.n} 开始一键校准 (full calibration)`);
      for (let i = 0; i < this.steps.length; i++) {
        const ok = await this.runStep(i);
        if (!ok) { this.running = false; return; }
      }
      // 校准完成：默认设为斜坡速度控制 (velocity + vel_ramp)，设定值归零
      try {
        await api.post(`/api/axes/${this.n}/input`,
          { control_mode: 2, input_mode: 2, vel: 0 });
        store.values[`axis${this.n}.controller.config.control_mode`] = 2;
        store.values[`axis${this.n}.controller.config.input_mode`] = 2;
      } catch { /* 不影响校准结果 */ }
      this.running = false;
      toast(`轴 Axis ${this.n} 校准全部完成！\n已默认设置为斜坡速度控制模式 (velocity + ramp)，可直接进入闭环。`,
        'info', 7000);
      log(`轴 Axis ${this.n} 校准完成，默认模式=斜坡速度控制 (calibration complete, vel-ramp mode set)`);
    },
  },
  watch: {
    n() { this.reset(); this.confirmed = false; },
  },
  template: `
  <div style="max-width:680px">
    <div class="section-title">一键校准向导 <span class="muted" style="font-weight:400">Calibration Wizard</span>
      — 轴 Axis {{ n }}</div>

    <div class="warnbox">
      ⚠ <b>安全警告 Safety Warning</b>：校准过程中电机将通电旋转！请确保电机固定牢靠、
      轴上无危险负载、周围人员远离。出现异常请立即按下 <b>急停 E-STOP</b>（快捷键 Esc）。
    </div>

    <div v-for="(s, i) in steps" :key="s.id" class="wizard-step" :class="s.status">
      <div class="num">{{ s.status === 'done' ? '✓' : s.status === 'failed' ? '✗' : i + 1 }}</div>
      <div class="info">
        <div class="t">{{ s.zh }} <span class="muted" style="font-weight:400">{{ s.en }}</span></div>
        <div class="d">{{ s.desc }}</div>
        <div class="progressbar" v-if="s.status === 'active'">
          <div class="fill" :style="{ width: s.progress + '%' }"></div>
        </div>
      </div>
      <span v-if="s.status === 'active'" class="badge yellow">进行中 Running…</span>
      <span v-else-if="s.status === 'done'" class="badge green">完成 Done</span>
      <span v-else-if="s.status === 'failed'" class="badge red">失败 Failed</span>
    </div>

    <div class="row" style="margin-top:12px">
      <button class="btn primary" @click="runAll"
              :disabled="running || store.conn !== 'connected'">
        {{ running ? '校准进行中… Running…' : '▶ 开始一键校准 Start Full Calibration' }}
      </button>
      <button class="btn" @click="reset" :disabled="running">重置 Reset</button>
      <span class="muted" style="font-size:12px">
        完成后可在参数面板将 pre_calibrated 置位并「保存配置」，下次上电免校准。
      </span>
    </div>

    <!-- 校准过程中的电机实时状态 -->
    <div style="margin-top:12px">
      <AxisStatus :axis="n" />
    </div>
  </div>`,
};
