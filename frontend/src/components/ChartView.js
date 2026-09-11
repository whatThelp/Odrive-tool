// 实时图表：多变量曲线 (uPlot) / 暂停 / CSV 导出 / 服务端长时间记录
import uPlot from '../../vendor/uPlot.esm.js';
import { store, setChartPaths, toast, refreshStatus } from '../store.js';
import { wsClient } from '../ws.js';
import { api } from '../api.js';
import { SERIES_COLORS } from '../labels.js';

const WINDOWS = [
  { label: '30 秒 30s', sec: 30 },
  { label: '2 分钟 2min', sec: 120 },
  { label: '10 分钟 10min', sec: 600 },
  { label: '1 小时 1h', sec: 3600 },
  { label: '6 小时 6h', sec: 21600 },
];

export default {
  name: 'ChartView',
  data() {
    return {
      selected: [],          // 已选路径
      customPath: '',
      windowSec: 30,
      paused: false,
      recFiles: [],
      recRate: 10,
      WINDOWS,
    };
  },
  computed: {
    store() { return store; },
    available() {
      // 数值型遥测路径（轴状态/错误码也可绘制）
      return (store.iface?.telemetry_paths || []).map((p) => ({
        path: p.path,
        label: `${p.label_zh} ${p.label_en}${p.axis !== undefined ? ' A' + p.axis : ''}`,
        unit: p.unit,
      }));
    },
  },
  methods: {
    colorOf(path) {
      const i = this.selected.indexOf(path);
      return i >= 0 ? SERIES_COLORS[i % SERIES_COLORS.length] : 'var(--baseline)';
    },
    toggle(path) {
      const i = this.selected.indexOf(path);
      if (i >= 0) this.selected.splice(i, 1);
      else if (this.selected.length >= 8) {
        toast('最多同时监控 8 个变量 (max 8 series)', 'warn');
        return;
      } else this.selected.push(path);
      this.rebuild();
    },
    addCustom() {
      const p = this.customPath.trim().replace(/^odrv0\./, '');
      if (p && !this.selected.includes(p)) {
        if (this.selected.length >= 8) { toast('最多 8 个变量 (max 8)', 'warn'); return; }
        this.selected.push(p);
        this.customPath = '';
        this.rebuild();
      }
    },
    labelOf(path) {
      const f = this.available.find((a) => a.path === path);
      return f ? f.label : path;
    },
    // ------------------------------------------------------------ buffering
    initBuffer() {
      this.buf = { t: [], cols: new Map() };
      this.selected.forEach((p) => this.buf.cols.set(p, []));
    },
    onTelemetry(t, values) {
      if (this.paused || !this.selected.length) return;
      this.buf.t.push(t);
      for (const p of this.selected) {
        const col = this.buf.cols.get(p);
        const v = values[p];
        col.push(typeof v === 'number' ? v : v == null ? null : Number(v));
      }
      // 按时间窗与最大点数裁剪
      const cutoff = t - this.windowSec;
      let drop = 0;
      while (drop < this.buf.t.length - 2
             && (this.buf.t[drop] < cutoff || this.buf.t.length - drop > 150000)) drop++;
      if (drop > 0) {
        this.buf.t.splice(0, drop);
        for (const col of this.buf.cols.values()) col.splice(0, drop);
      }
    },
    // --------------------------------------------------------------- uPlot
    rebuild() {
      this.initBuffer();
      setChartPaths([...this.selected]);
      if (this.plot) { this.plot.destroy(); this.plot = null; }
      if (!this.selected.length) return;
      const el = this.$refs.plot;
      const opts = {
        width: el.clientWidth || 800,
        height: 420,
        ms: false,
        series: [
          { label: '时间 Time' },
          ...this.selected.map((p, i) => ({
            label: this.labelOf(p),
            stroke: SERIES_COLORS[i % SERIES_COLORS.length],
            width: 2,
            points: { show: false },
          })),
        ],
        axes: [
          { stroke: '#898781', grid: { stroke: '#2c2c2a', width: 1 },
            ticks: { stroke: '#383835' } },
          { stroke: '#898781', grid: { stroke: '#2c2c2a', width: 1 },
            ticks: { stroke: '#383835' }, size: 62 },
        ],
        cursor: { drag: { x: false, y: false } },
        legend: { live: true },
      };
      this.plot = new uPlot(opts, [[], []], el);
    },
    refreshPlot() {
      if (!this.plot || this.paused) return;
      const data = [this.buf.t, ...this.selected.map((p) => this.buf.cols.get(p))];
      this.plot.setData(data);
    },
    // ---------------------------------------------------------- CSV export
    exportCsv() {
      if (!this.buf.t.length) { toast('没有可导出的数据 (no data)', 'warn'); return; }
      const header = ['time', ...this.selected].join(',');
      const lines = [header];
      for (let i = 0; i < this.buf.t.length; i++) {
        lines.push([
          new Date(this.buf.t[i] * 1000).toISOString(),
          ...this.selected.map((p) => this.buf.cols.get(p)[i] ?? ''),
        ].join(','));
      }
      const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `odrive_chart_${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    },
    // ------------------------------------------------- 服务端长时间记录
    async startRecord() {
      if (!this.selected.length) { toast('请先选择要记录的变量 (select series first)', 'warn'); return; }
      try {
        await api.post('/api/record/start', { paths: this.selected, rate_hz: this.recRate });
        toast('长时间记录已开始 (server-side recording started)');
        await refreshStatus();
      } catch (e) { toast(`记录启动失败: ${e.message}`, 'error'); }
    },
    async stopRecord() {
      try {
        const r = await api.post('/api/record/stop');
        if (r.stopped) {
          toast(`记录已停止 Recording stopped: ${r.stopped.name}\n共 ${r.stopped.rows} 行 / ${r.stopped.duration_s}s`);
        }
        await refreshStatus();
        await this.loadRecList();
      } catch (e) { toast(`停止失败: ${e.message}`, 'error'); }
    },
    async loadRecList() {
      try { this.recFiles = (await api.get('/api/record/list')).files; } catch { /* */ }
    },
  },
  mounted() {
    this._teleHook = (t, v) => this.onTelemetry(t, v);
    wsClient.onTelemetry.push(this._teleHook);
    this.initBuffer();
    this._timer = setInterval(() => this.refreshPlot(), 100);
    this._resize = () => {
      if (this.plot && this.$refs.plot) {
        this.plot.setSize({ width: this.$refs.plot.clientWidth, height: 420 });
      }
    };
    window.addEventListener('resize', this._resize);
    this.loadRecList();
    // 默认选中前两条曲线
    if (this.available.length) {
      this.selected = this.available.slice(0, 2).map((a) => a.path);
      this.$nextTick(() => this.rebuild());
    }
  },
  unmounted() {
    clearInterval(this._timer);
    window.removeEventListener('resize', this._resize);
    const i = wsClient.onTelemetry.indexOf(this._teleHook);
    if (i >= 0) wsClient.onTelemetry.splice(i, 1);
    if (this.plot) this.plot.destroy();
    setChartPaths([]);
  },
  template: `
  <div>
    <div class="chart-toolbar">
      <span class="muted">监控变量 Series:</span>
      <span v-for="a in available" :key="a.path" class="series-pick"
            :class="{on: selected.includes(a.path)}" @click="toggle(a.path)">
        <span class="sw" :style="{background: selected.includes(a.path) ? colorOf(a.path) : ''}"></span>
        {{ a.label }}
      </span>
    </div>
    <div class="chart-toolbar">
      <input type="text" v-model="customPath" placeholder="自定义路径 custom path, e.g. axis0.controller.vel_setpoint"
             style="width:300px" class="mono" @keyup.enter="addCustom">
      <button class="btn small" @click="addCustom">添加 Add</button>
      <span class="grow"></span>
      <span class="muted">时间窗 Window:</span>
      <select v-model.number="windowSec">
        <option v-for="w in WINDOWS" :key="w.sec" :value="w.sec">{{ w.label }}</option>
      </select>
      <button class="btn small" @click="paused = !paused">{{ paused ? '▶ 继续 Resume' : '⏸ 暂停 Pause' }}</button>
      <button class="btn small" @click="initBuffer()">清空 Clear</button>
      <button class="btn small" @click="exportCsv">导出 CSV Export</button>
    </div>

    <div class="chart-wrap">
      <div v-if="!selected.length" class="muted" style="padding:60px; text-align:center">
        请在上方选择要监控的变量（最多 8 个）。 Select up to 8 series above.
      </div>
      <div ref="plot"></div>
    </div>

    <div class="card" style="margin-top:10px">
      <h3>长时间数据记录 <span class="en">Long-duration Recording (server-side CSV)</span></h3>
      <div class="row">
        <span class="muted">采样率 Rate:</span>
        <select v-model.number="recRate">
          <option :value="1">1 Hz</option><option :value="5">5 Hz</option>
          <option :value="10">10 Hz</option><option :value="20">20 Hz</option>
        </select>
        <button v-if="!store.recording" class="btn small primary" @click="startRecord"
                :disabled="store.conn!=='connected'">● 开始记录 Start</button>
        <button v-else class="btn small danger" @click="stopRecord">■ 停止记录 Stop ({{ store.recording.name }})</button>
        <span class="muted" style="font-size:11.5px">记录直接写入服务端 CSV，可连续运行数小时至数天。</span>
      </div>
      <table class="tbl" v-if="recFiles.length" style="margin-top:8px">
        <thead><tr><th>文件 File</th><th>大小 Size</th><th>时间 Time</th><th></th></tr></thead>
        <tbody>
          <tr v-for="f in recFiles.slice(0, 8)" :key="f.name">
            <td class="mono" style="font-size:11px">{{ f.name }}</td>
            <td class="num">{{ (f.size/1024).toFixed(1) }} KB</td>
            <td class="muted">{{ f.mtime }}</td>
            <td><a class="btn small" :href="'/api/record/download/' + f.name" download>下载 Download</a></td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>`,
};
