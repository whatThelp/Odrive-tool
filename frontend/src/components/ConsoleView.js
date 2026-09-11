// 命令控制台：odrivetool 风格 read/write/call (odrv0. 前缀可选)
import { store, pushHistory } from '../store.js';
import { api } from '../api.js';

export default {
  name: 'ConsoleView',
  data() {
    return {
      lines: [{ kind: 'ok', text: 'ODrive 命令控制台。输入 help 查看用法。 Type "help" for usage.' }],
      input: '',
      cmdHistory: [],
      histIdx: -1,
    };
  },
  computed: { store() { return store; } },
  methods: {
    async run() {
      const cmd = this.input.trim();
      if (!cmd) return;
      this.lines.push({ kind: 'cmd', text: `> ${cmd}` });
      this.cmdHistory.push(cmd);
      this.histIdx = -1;
      this.input = '';
      try {
        const r = await api.post('/api/console', { command: cmd });
        this.lines.push({ kind: r.ok ? 'ok' : 'err', text: r.output });
        if (r.kind === 'write') {
          pushHistory('command', `控制台写入 ${r.path} = ${r.value}`);
        } else if (r.kind === 'call') {
          pushHistory('command', `控制台调用 ${cmd}`);
        }
      } catch (e) {
        this.lines.push({ kind: 'err', text: `请求失败 (request failed): ${e.message}` });
      }
      if (this.lines.length > 500) this.lines.splice(0, 100);
      this.$nextTick(() => {
        const el = this.$refs.out;
        if (el) el.scrollTop = el.scrollHeight;
      });
    },
    histUp() {
      if (!this.cmdHistory.length) return;
      if (this.histIdx === -1) this.histIdx = this.cmdHistory.length - 1;
      else if (this.histIdx > 0) this.histIdx--;
      this.input = this.cmdHistory[this.histIdx];
    },
    histDown() {
      if (this.histIdx === -1) return;
      this.histIdx++;
      if (this.histIdx >= this.cmdHistory.length) { this.histIdx = -1; this.input = ''; }
      else this.input = this.cmdHistory[this.histIdx];
    },
  },
  template: `
  <div class="console">
    <div class="out" ref="out">
      <div v-for="(l, i) in lines" :key="i" :class="l.kind">{{ l.text }}</div>
    </div>
    <div class="in">
      <span class="prompt">odrv0 ></span>
      <input type="text" v-model="input" spellcheck="false"
             placeholder='例如: vbus_voltage / axis0.controller.input_vel = 2 / axis0.requested_state = AXIS_STATE_CLOSED_LOOP_CONTROL / dump_errors(odrv0)'
             @keyup.enter="run" @keydown.up.prevent="histUp" @keydown.down.prevent="histDown">
      <button class="btn" @click="run" :disabled="store.conn!=='connected'">执行 Run</button>
    </div>
  </div>`,
};
