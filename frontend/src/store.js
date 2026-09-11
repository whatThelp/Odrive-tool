// 全局状态与动作 Global reactive store + actions
import { reactive } from './vue.js';
import { api } from './api.js';
import { wsClient } from './ws.js';
import { fmtNum } from './labels.js';

export const store = reactive({
  // 连接 connection
  conn: 'disconnected',
  wsUp: false,
  mockMode: false,
  transports: {},
  devices: [],
  device: null,
  voltageRange: null,
  scanning: false,
  connecting: false,
  // 界面 ui
  tab: 'dashboard',
  axis: 0,
  toastMsg: null,
  lastLog: '就绪 Ready',
  // 参数 params
  iface: null,
  values: {},
  drafts: {},
  // 遥测 telemetry
  tele: {},
  chartPaths: [],
  // 错误 errors
  errorsActive: [],
  errorHistory: [],
  // 操作历史 history (undo)
  history: [],
  // 长时间记录 recording
  recording: null,
});

let toastTimer = null;
export function toast(msg, kind = 'info', ms = 4200) {
  store.toastMsg = { msg, kind };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { store.toastMsg = null; }, ms);
}

export function log(msg) {
  store.lastLog = `[${new Date().toLocaleTimeString()}] ${msg}`;
}

export function pushHistory(kind, desc, undo = null) {
  store.history.push({
    time: new Date().toLocaleTimeString(), kind, desc, undo, undone: false,
  });
  if (store.history.length > 300) store.history.splice(0, 50);
}

// ---------------------------------------------------------------- telemetry
export function dashboardPaths() {
  if (!store.iface) return [];
  // status_paths: 校准状态等仪表盘专用状态量（不出现在图表选择器中）
  return [...store.iface.telemetry_paths, ...(store.iface.status_paths || [])]
    .map((p) => p.path);
}

// 轴校准状态: true=已校准 false=未校准 null=未知
export function axisCalibrated(n) {
  const m = store.tele[`axis${n}.motor.is_calibrated`];
  const e = store.tele[`axis${n}.encoder.is_ready`];
  if (m == null && e == null) return null;
  return !!m && !!e;
}

export function updateSubscription() {
  const paths = new Set([...dashboardPaths(), ...store.chartPaths]);
  wsClient.subscribe([...paths], 20);
}

export function setChartPaths(paths) {
  store.chartPaths = paths;
  updateSubscription();
}

// --------------------------------------------------------------- connection
export async function refreshStatus() {
  try {
    const s = await api.get('/api/status');
    store.conn = s.status;
    store.mockMode = s.mock_mode;
    store.transports = s.transports;
    store.device = s.device;
    store.recording = s.recording;
    store.voltageRange = s.voltage_range;
    if (s.status === 'connected' && s.device && !store.iface) {
      await loadInterface();
    }
    if (s.status === 'disconnected') {
      store.iface = null;
      store.values = {};
      store.drafts = {};
      store.tele = {};
    }
  } catch { /* backend not up yet */ }
}

export async function scan() {
  store.scanning = true;
  try {
    const r = await api.post('/api/scan');
    store.devices = r.devices;
    log(`扫描完成，发现 ${r.devices.length} 台设备 (scan done)`);
  } catch (e) {
    toast(`扫描失败 Scan failed: ${e.message}`, 'error');
  } finally {
    store.scanning = false;
  }
}

export async function connect(serial, transport = 'usb', options = {}) {
  store.connecting = true;
  try {
    const r = await api.post('/api/connect', { serial, transport, options });
    store.device = r.device;
    store.conn = 'connected';
    await loadInterface();
    log(`已连接 Connected: ${r.device.serial_number} (fw ${r.device.fw_version})`);
    toast(`已连接 ${r.device.serial_number}\n固件 Firmware: v${r.device.fw_version} · ${r.device.hw_variant}V 版本`);
    pushHistory('conn', `连接设备 ${r.device.serial_number}`);
    await refreshStatus();
  } catch (e) {
    toast(`连接失败 Connect failed: ${e.message}`, 'error');
  } finally {
    store.connecting = false;
  }
}

export async function disconnect() {
  try {
    await api.post('/api/disconnect');
    pushHistory('conn', '断开连接 Disconnected');
  } catch { /* ignore */ }
  await refreshStatus();
  log('已断开连接 Disconnected');
}

// ------------------------------------------------------------------- params
export async function loadInterface() {
  store.iface = await api.get('/api/interface');
  const r = await api.get('/api/params/all');
  store.values = r.values;
  store.drafts = {};
  updateSubscription();
}

export async function reloadValues() {
  if (!store.iface) return;
  const r = await api.get('/api/params/all');
  store.values = r.values;
  store.drafts = {};
  log('参数已重新读取 (parameters reloaded)');
}

export function setDraft(path, value) {
  const cur = store.values[path];
  const same = typeof cur === 'number'
    ? Math.abs(cur - value) < 1e-12 : cur === value;
  if (same) delete store.drafts[path];
  else store.drafts[path] = value;
}

export function dirtyChanges() {
  return Object.entries(store.drafts).map(([path, value]) => ({ path, value }));
}

export async function applyDrafts() {
  const changes = dirtyChanges();
  if (!changes.length) return;
  try {
    const r = await api.post('/api/params/write', { changes });
    for (const a of r.applied) {
      store.values[a.path] = a.value;
      delete store.drafts[a.path];
      pushHistory('param', `${a.path} = ${fmtNum(a.value)} (原 ${fmtNum(a.old)})`,
        { path: a.path, old: a.old });
    }
    let msg = `已写入 ${r.applied.length} 项参数 (${r.applied.length} params written)`;
    if (r.warnings.length) msg += `\n⚠ ${r.warnings.join('\n⚠ ')}`;
    if (r.failed.length) {
      msg += `\n✗ 失败 ${r.failed.length} 项: ${r.failed.map((f) => f.path).join(', ')}`;
    }
    toast(msg, r.warnings.length || r.failed.length ? 'warn' : 'info');
    log(`参数写入: ${r.applied.length} 项成功`);
  } catch (e) {
    toast(`写入失败 Write failed: ${e.message}`, 'error');
  }
}

export async function writeSingle(path, value) {
  const r = await api.post('/api/params/write', { changes: [{ path, value }] });
  if (r.applied.length) {
    store.values[path] = r.applied[0].value;
    return r.applied[0];
  }
  throw new Error(r.failed[0]?.reason || 'write failed');
}

export async function undoLast() {
  for (let i = store.history.length - 1; i >= 0; i--) {
    const h = store.history[i];
    if (h.undo && !h.undone) {
      try {
        await writeSingle(h.undo.path, h.undo.old);
        h.undone = true;
        toast(`已撤销 Undone: ${h.undo.path} → ${fmtNum(h.undo.old)}`);
        log(`撤销 Undo: ${h.undo.path}`);
      } catch (e) {
        toast(`撤销失败 Undo failed: ${e.message}`, 'error');
      }
      return;
    }
  }
  toast('没有可撤销的操作 (nothing to undo)', 'warn');
}

// ------------------------------------------------------------------ actions
export async function estop() {
  try {
    await api.post('/api/actions/estop');
    pushHistory('action', '紧急停止 E-STOP');
    log('紧急停止已执行 E-STOP executed');
  } catch (e) {
    toast(`紧急停止失败 E-Stop failed: ${e.message}`, 'error');
  }
}

export async function deviceAction(name, desc) {
  try {
    await api.post(`/api/actions/${name}`);
    if (desc) { toast(desc); log(desc); pushHistory('action', desc); }
  } catch (e) {
    toast(`操作失败 Action failed: ${e.message}`, 'error');
  }
}

export async function refreshErrors() {
  try {
    const r = await api.get('/api/errors');
    store.errorsActive = r.active;
    store.errorHistory = r.history;
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------- ws wiring
wsClient.onTelemetry.push((t, values) => {
  Object.assign(store.tele, values);
});

wsClient.onStatus.push((up) => { store.wsUp = up; });

wsClient.onEvent.push((ev) => {
  if (ev.type === 'connection') {
    store.conn = ev.status;
    if (ev.status === 'lost') {
      toast('设备通信中断！正在尝试恢复… (communication lost)', 'error', 8000);
      log('通信中断 Communication lost');
    } else if (ev.status === 'connected' && ev.message) {
      toast(ev.message);
      log(ev.message);
    }
  } else if (ev.type === 'error') {
    const errs = (ev.decoded || []).map((d) => `${d.zh} (${d.en})`).join('; ');
    toast(`新错误 New error @ ${ev.source}:\n${errs}`, 'error', 8000);
    log(`错误 Error: ${ev.source} ${errs}`);
    refreshErrors();
  } else if (ev.type === 'state_change') {
    log(`轴 Axis ${ev.axis} 状态 → ${ev.state.zh} ${ev.state.en}`);
  } else if (ev.type === 'estop') {
    toast(ev.message, 'warn');
    log(ev.message);
  } else if (ev.type === 'info') {
    log(ev.message);
  }
});

// ---------------------------------------------------------------- bootstrap
export function boot() {
  wsClient.connect();
  refreshStatus();
  setInterval(refreshStatus, 5000);
  setInterval(() => { if (store.conn === 'connected') refreshErrors(); }, 3000);
}
