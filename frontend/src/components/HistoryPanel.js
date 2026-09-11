// 操作历史与撤销 + 历史错误日志（带时间戳）
import { store, undoLast, writeSingle, toast } from '../store.js';
import { api } from '../api.js';
import { fmtNum } from '../labels.js';

export default {
  name: 'HistoryPanel',
  data() { return { view: 'ops' }; },
  computed: {
    store() { return store; },
    ops() { return [...store.history].reverse(); },
  },
  methods: {
    fmtNum,
    undoAny() { undoLast(); },
    async undoOne(h) {
      try {
        await writeSingle(h.undo.path, h.undo.old);
        h.undone = true;
        toast(`已撤销 Undone: ${h.undo.path} → ${fmtNum(h.undo.old)}`);
      } catch (e) { toast(`撤销失败: ${e.message}`, 'error'); }
    },
    kindLabel(k) {
      return { param: '参数 Param', command: '命令 Cmd', action: '操作 Action',
               conn: '连接 Conn', preset: '预设 Preset' }[k] || k;
    },
    async clearErrLog() {
      if (!window.confirm('清空历史错误日志？Clear error history log?')) return;
      await api.post('/api/errors/log/clear');
      store.errorHistory = [];
    },
  },
  template: `
  <div>
    <div class="row" style="margin-bottom:10px">
      <button class="btn small" :class="{primary: view==='ops'}" @click="view='ops'">操作历史 Operations</button>
      <button class="btn small" :class="{primary: view==='errors'}" @click="view='errors'">历史错误日志 Error Log</button>
      <span class="grow"></span>
      <button v-if="view==='ops'" class="btn small" @click="undoAny" title="Ctrl+Z">↶ 撤销最近 Undo Last</button>
      <button v-else class="btn small danger" @click="clearErrLog">清空日志 Clear Log</button>
    </div>

    <template v-if="view==='ops'">
      <div v-if="!ops.length" class="muted">暂无操作记录。 No operations yet.</div>
      <table class="tbl" v-else>
        <thead><tr><th style="width:80px">时间 Time</th><th style="width:90px">类型 Type</th><th>描述 Description</th><th style="width:80px"></th></tr></thead>
        <tbody>
          <tr v-for="(h, i) in ops" :key="i">
            <td class="muted">{{ h.time }}</td>
            <td><span class="badge">{{ kindLabel(h.kind) }}</span></td>
            <td :style="h.undone ? 'text-decoration:line-through; color:var(--ink-3)' : ''" class="mono" style="font-size:11.5px">{{ h.desc }}</td>
            <td>
              <button v-if="h.undo && !h.undone" class="btn small" @click="undoOne(h)">撤销 Undo</button>
              <span v-else-if="h.undone" class="muted" style="font-size:11px">已撤销</span>
            </td>
          </tr>
        </tbody>
      </table>
    </template>

    <template v-else>
      <div v-if="!store.errorHistory.length" class="muted">暂无历史错误。 No error history.</div>
      <table class="tbl" v-else>
        <thead><tr><th style="width:150px">时间 Time</th><th style="width:110px">设备 Device</th><th>来源 Source</th><th>错误 Error</th></tr></thead>
        <tbody>
          <tr v-for="(e, i) in store.errorHistory" :key="i">
            <td class="muted">{{ e.time }}</td>
            <td class="muted mono" style="font-size:11px">{{ e.serial }}</td>
            <td class="mono" style="font-size:11px">{{ e.source }} = 0x{{ (e.code || 0).toString(16).toUpperCase() }}</td>
            <td style="color:var(--serious)">
              <template v-for="(d, j) in (e.decoded || [])" :key="j">{{ j ? '; ' : '' }}{{ d.zh }} ({{ d.en }})</template>
            </td>
          </tr>
        </tbody>
      </table>
    </template>
  </div>`,
};
