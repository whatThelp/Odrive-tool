// 配置预设（快照）管理：保存 / 应用 / 对比 / 导入导出 (JSON, 携带固件版本标记)
import { store, toast, pushHistory, reloadValues, log } from '../store.js';
import { api } from '../api.js';
import { fmtNum } from '../labels.js';

export default {
  name: 'PresetManager',
  emits: ['close'],
  data() {
    return {
      presets: [],
      view: 'list',            // list / save / diff
      saveName: '',
      saveCats: [],            // 空 = 全部类别
      diff: null,
      busy: false,
    };
  },
  computed: {
    store() { return store; },
    groups() { return store.iface?.groups || []; },
  },
  methods: {
    fmtNum,
    async refresh() {
      const r = await api.get('/api/presets');
      this.presets = r.presets;
    },
    async save() {
      if (!this.saveName.trim()) { toast('请输入预设名称 (name required)', 'warn'); return; }
      this.busy = true;
      try {
        const r = await api.post('/api/presets', {
          name: this.saveName.trim(),
          categories: this.saveCats.length ? this.saveCats : null,
        });
        toast(`预设已保存 Preset saved: ${r.preset.name} (fw ${r.preset.fw_version})`);
        pushHistory('preset', `保存预设 ${r.preset.name}`);
        this.saveName = '';
        this.view = 'list';
        await this.refresh();
      } catch (e) {
        toast(`保存失败 Save failed: ${e.message}`, 'error');
      } finally { this.busy = false; }
    },
    async apply(p, force = false) {
      if (!window.confirm(`应用预设「${p.name}」到设备？仅写入有差异的参数。\nApply preset (only diffs are written)?`)) return;
      this.busy = true;
      try {
        const r = await api.post(`/api/presets/${p.id}/apply`, { force });
        toast(`预设已应用：写入 ${r.applied.length} 项，跳过 ${r.skipped_count} 项相同参数`
          + (r.warnings.length ? `\n⚠ ${r.warnings.join('\n⚠ ')}` : ''),
        r.warnings.length ? 'warn' : 'info', 6000);
        pushHistory('preset', `应用预设 ${p.name} (${r.applied.length} 项)`);
        log(`预设 ${p.name} 已应用 (preset applied)`);
        await reloadValues();
      } catch (e) {
        if (!force && String(e.message).includes('不兼容')) {
          if (window.confirm(`${e.message}\n\n仍要强制应用吗？Force apply anyway?`)) {
            await this.apply(p, true);
          }
        } else {
          toast(`应用失败 Apply failed: ${e.message}`, 'error');
        }
      } finally { this.busy = false; }
    },
    async showDiff(p) {
      this.busy = true;
      try {
        this.diff = await api.get(`/api/presets/${p.id}/diff`);
        this.view = 'diff';
      } catch (e) {
        toast(`对比失败 Diff failed: ${e.message}`, 'error');
      } finally { this.busy = false; }
    },
    async remove(p) {
      if (!window.confirm(`删除预设「${p.name}」？Delete preset?`)) return;
      await api.del(`/api/presets/${p.id}`);
      await this.refresh();
    },
    exportPreset(p) {
      window.open(`/api/presets/${p.id}/export`, '_blank');
    },
    importFile(e) {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const r = await api.post('/api/presets/import', { json: reader.result });
          toast(`预设已导入 Imported: ${r.preset.name} (fw ${r.preset.fw_version})`);
          await this.refresh();
        } catch (err) {
          toast(`导入失败 Import failed: ${err.message}`, 'error');
        }
      };
      reader.readAsText(file);
      e.target.value = '';
    },
    fwMismatch(p) {
      if (!store.device) return false;
      const a = (p.fw_version || '').split('.').slice(0, 2).join('.');
      const b = store.device.fw_version.split('.').slice(0, 2).join('.');
      return a !== b;
    },
  },
  mounted() { this.refresh(); },
  template: `
  <div class="modal-mask" @click.self="$emit('close')">
    <div class="modal" style="min-width:min(560px, 94vw)">
      <div class="m-head">
        配置预设管理 <span class="muted" style="font-weight:400; margin-left:6px">Preset Manager</span>
        <button class="x" @click="$emit('close')">✕</button>
      </div>

      <div class="m-body">
        <div class="row" style="margin-bottom:12px">
          <button class="btn small" :class="{primary: view==='list'}" @click="view='list'; diff=null">预设列表 List</button>
          <button class="btn small" :class="{primary: view==='save'}" @click="view='save'">保存快照 Save Snapshot</button>
          <label class="btn small" style="cursor:pointer">
            导入 Import JSON<input type="file" accept=".json" style="display:none" @change="importFile">
          </label>
        </div>

        <!-- 列表 -->
        <template v-if="view==='list'">
          <div v-if="!presets.length" class="muted">暂无预设。切换到「保存快照」创建。 No presets yet.</div>
          <table class="tbl" v-else>
            <thead><tr>
              <th>名称 Name</th><th>固件 FW</th><th>类别 Categories</th><th>参数数</th><th>创建时间</th><th></th>
            </tr></thead>
            <tbody>
              <tr v-for="p in presets" :key="p.id">
                <td>{{ p.name }}</td>
                <td>
                  <span :style="fwMismatch(p) ? 'color:var(--warning)' : ''">{{ p.fw_version }}
                    <span v-if="fwMismatch(p)" title="与当前设备固件版本不一致 firmware mismatch">⚠</span></span>
                </td>
                <td class="muted" style="max-width:130px; overflow:hidden; text-overflow:ellipsis">{{ (p.categories || []).join(', ') || '全部 all' }}</td>
                <td class="num">{{ p.param_count }}</td>
                <td class="muted">{{ p.created }}</td>
                <td style="white-space:nowrap">
                  <button class="btn small" :disabled="busy || store.conn!=='connected'" @click="apply(p)">应用</button>
                  <button class="btn small" :disabled="busy || store.conn!=='connected'" @click="showDiff(p)">对比</button>
                  <button class="btn small" @click="exportPreset(p)">导出</button>
                  <button class="btn small danger" @click="remove(p)">删除</button>
                </td>
              </tr>
            </tbody>
          </table>
        </template>

        <!-- 保存 -->
        <template v-if="view==='save'">
          <div class="row" style="margin-bottom:10px">
            <span class="muted">名称 Name:</span>
            <input type="text" v-model="saveName" class="grow" placeholder="例如: 5065电机-位置模式调好参数">
          </div>
          <div class="muted" style="margin-bottom:6px">参数类别 Categories（不勾选 = 保存全部 all）:</div>
          <div class="row" style="margin-bottom:12px">
            <label v-for="g in groups" :key="g.id" class="series-pick" :class="{on: saveCats.includes(g.id)}">
              <input type="checkbox" :value="g.id" v-model="saveCats" style="display:none">
              {{ g.label_zh }} {{ g.label_en }}
            </label>
          </div>
          <div class="muted" style="font-size:11.5px; margin-bottom:10px">
            快照读取设备当前值保存为 JSON，并携带固件版本标记 (fw v{{ store.device?.fw_version }})，防止跨版本误用。
          </div>
          <button class="btn primary" :disabled="busy || store.conn!=='connected'" @click="save">保存快照 Save Snapshot</button>
        </template>

        <!-- 对比 -->
        <template v-if="view==='diff' && diff">
          <div class="row" style="margin-bottom:8px">
            <b>{{ diff.preset.name }}</b>
            <span class="muted">fw {{ diff.preset.fw_version }}</span>
            <span v-if="!diff.fw_compatible" class="badge yellow">固件版本不匹配 FW mismatch</span>
            <span class="muted" style="margin-left:auto">
              {{ diff.rows.filter(r => r.status==='diff').length }} 项差异 diffs</span>
          </div>
          <table class="tbl">
            <thead><tr><th>参数 Path</th><th>预设值 Preset</th><th>当前值 Current</th></tr></thead>
            <tbody>
              <tr v-for="r in diff.rows.filter(r => r.status !== 'same')" :key="r.path" class="diff">
                <td class="mono" style="font-size:11px">{{ r.path }}</td>
                <td class="num">{{ fmtNum(r.preset) }}</td>
                <td class="num">{{ r.status === 'missing' ? '— 不存在' : fmtNum(r.current) }}</td>
              </tr>
              <tr v-if="!diff.rows.some(r => r.status !== 'same')">
                <td colspan="3" class="muted">全部一致，无差异。 All values identical.</td>
              </tr>
            </tbody>
          </table>
        </template>
      </div>
    </div>
  </div>`,
};
