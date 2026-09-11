// 左侧参数配置面板：分组浏览 / 搜索 / 变更追踪 / 帮助提示 / 预设入口
import { store, setDraft, applyDrafts, reloadValues, deviceAction, toast } from '../store.js';
import { fmtNum } from '../labels.js';
import PresetManager from './PresetManager.js';

export default {
  name: 'ParamPanel',
  components: { PresetManager },
  data() {
    return { query: '', help: null, showPresets: false };
  },
  computed: {
    store() { return store; },
    dirtyCount() { return Object.keys(store.drafts).length; },
    groups() {
      if (!store.iface) return [];
      const q = this.query.trim().toLowerCase();
      return store.iface.groups.map((g) => {
        const params = g.params.filter((p) => {
          if (!q) return true;
          return p.path.toLowerCase().includes(q)
            || p.label_zh.includes(this.query.trim())
            || p.label_en.toLowerCase().includes(q);
        });
        const dirty = params.filter((p) => p.path in store.drafts).length;
        // 按轴分块渲染：轴号变化处插入 "轴 N Axis N" 小标题
        const items = [];
        let lastAxis;
        for (const p of params) {
          if (p.axis !== undefined && p.axis !== lastAxis) {
            items.push({ divider: true, axis: p.axis, key: `${g.id}-ax${p.axis}` });
          }
          lastAxis = p.axis;
          items.push({ divider: false, p, key: p.path });
        }
        return { ...g, params, items, dirty };
      }).filter((g) => g.params.length);
    },
  },
  methods: {
    fmtNum,
    shown(p) {
      return p.path in store.drafts ? store.drafts[p.path] : store.values[p.path];
    },
    isDirty(p) { return p.path in store.drafts; },
    onNum(p, e) {
      const v = e.target.value;
      if (v === '' || Number.isNaN(Number(v))) return;
      setDraft(p.path, p.type === 'int' ? parseInt(v, 10) : parseFloat(v));
    },
    onBool(p, e) { setDraft(p.path, e.target.checked); },
    onEnum(p, e) { setDraft(p.path, parseInt(e.target.value, 10)); },
    enumOptions(p) { return store.iface?.enums?.[p.enum] || []; },
    apply() { applyDrafts(); },
    discard() {
      store.drafts = {};
      toast('已放弃未写入的修改 (pending changes discarded)');
    },
    reload() { reloadValues(); },
    openHelp(p, e) {
      const rect = e.target.getBoundingClientRect();
      this.help = {
        p,
        x: Math.min(rect.right + 8, window.innerWidth - 300),
        y: Math.min(rect.top - 10, window.innerHeight - 220),
      };
    },
    docUrl(p) {
      return (store.iface?.doc_base || 'https://docs.odriverobotics.com/') + (p.doc || '');
    },
    eraseReboot() {
      if (window.confirm('确定要擦除全部配置并重启 ODrive 吗？\n此操作不可撤销！\nErase all configuration and reboot?')) {
        deviceAction('erase_reboot', '配置已擦除，设备重启中 (erased & rebooting)');
      }
    },
  },
  template: `
  <aside class="leftpanel" @click.self="help=null">
    <div class="pp-head">
      <div class="title">参数配置 <span class="muted" style="font-weight:400">Parameters</span>
        <span v-if="store.iface" class="muted" style="font-weight:400; font-size:11px">
          · 固件 fw {{ store.iface.fw_series }}</span>
      </div>
      <input type="text" v-model="query" placeholder="搜索参数… Search parameters"
             :disabled="!store.iface">
    </div>

    <div class="pp-body" @scroll="help=null">
      <div v-if="!store.iface" class="muted" style="padding:20px; text-align:center;">
        连接设备后将按固件版本加载参数定义。<br>
        Parameter definitions load after connecting, matched to the firmware version.
      </div>
      <details class="pp-group" v-for="g in groups" :key="g.id" :open="!!query || g.dirty > 0">
        <summary>
          {{ g.label_zh }} <span class="muted" style="font-weight:400">{{ g.label_en }}</span>
          <span class="cnt"><span v-if="g.dirty" class="dirty-cnt">{{ g.dirty }} 项修改 · </span>{{ g.params.length }}</span>
        </summary>
        <template v-for="it in g.items" :key="it.key">
          <div v-if="it.divider" class="axis-divider" :class="'a' + it.axis">
            轴 {{ it.axis }} · Axis {{ it.axis }}
          </div>
          <div v-else class="param-row" :class="{ dirty: isDirty(it.p) }">
            <div class="lbl" :title="it.p.path">
              <div class="zh">
                <span v-if="it.p.axis !== undefined" class="axis-tag" :class="'a' + it.p.axis">A{{ it.p.axis }}</span>
                {{ it.p.label_zh }}
                <span v-if="it.p.danger" class="danger-mark" title="安全敏感参数，修改前请确认 Safety-critical">⚠</span>
                <span v-if="isDirty(it.p)" class="dirty-dot" title="已修改，待写入 modified"></span>
              </div>
              <div class="en">{{ it.p.label_en }}<span v-if="it.p.unit"> · {{ it.p.unit }}</span></div>
            </div>
            <button class="help-btn" @click.stop="openHelp(it.p, $event)" title="参数说明 Help">?</button>

            <input v-if="it.p.type === 'float' || it.p.type === 'int'" type="number"
                   :step="it.p.type === 'int' ? 1 : 'any'" :min="it.p.min" :max="it.p.max"
                   :value="shown(it.p)" @change="onNum(it.p, $event)">
            <input v-else-if="it.p.type === 'bool'" type="checkbox"
                   :checked="!!shown(it.p)" @change="onBool(it.p, $event)">
            <select v-else-if="it.p.type === 'enum'" :value="shown(it.p)" @change="onEnum(it.p, $event)">
              <option v-for="o in enumOptions(it.p)" :key="o.value" :value="o.value">
                {{ o.label_zh }} {{ o.label_en }}
              </option>
            </select>
          </div>
        </template>
      </details>
    </div>

    <div class="pp-foot" v-if="store.iface">
      <span class="dirty-info" v-if="dirtyCount">{{ dirtyCount }} 项待写入 pending</span>
      <span class="dirty-info muted" v-else style="color:var(--ink-3)">无修改 no changes</span>
      <button class="btn primary small" :disabled="!dirtyCount" @click="apply"
              title="仅写入实际修改过的参数 Write only changed params">写入 Apply</button>
      <button class="btn small" :disabled="!dirtyCount" @click="discard">放弃 Discard</button>
      <button class="btn small" @click="reload" title="从设备重新读取全部参数 Reload from device">刷新 Reload</button>
      <button class="btn small" @click="showPresets = true" title="配置预设/快照管理 Presets">预设 Presets</button>
    </div>

    <!-- 帮助浮层 Help popover -->
    <div v-if="help" class="help-pop" :style="{ left: help.x + 'px', top: help.y + 'px' }">
      <div class="t">{{ help.p.label_zh }} {{ help.p.label_en }}
        <button class="x" style="float:right; background:none; border:none; color:var(--ink-3); cursor:pointer" @click="help=null">✕</button>
      </div>
      <div class="body">{{ help.p.help_zh }}</div>
      <div class="meta mono">{{ help.p.path }}</div>
      <div class="meta" v-if="help.p.min !== undefined">
        范围 Range: {{ help.p.min }} ~ {{ help.p.max }} {{ help.p.unit }}</div>
      <div class="meta"><a :href="docUrl(help.p)" target="_blank">ODrive 官方文档 Official docs ↗</a></div>
    </div>

    <PresetManager v-if="showPresets" @close="showPresets = false" />
  </aside>`,
};
