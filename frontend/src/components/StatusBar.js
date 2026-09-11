// 底部状态栏：连接指示灯 / 实时日志 / 错误提示 / 记录状态
import { store } from '../store.js';

export default {
  name: 'StatusBar',
  computed: {
    store() { return store; },
    ledClass() {
      if (store.conn === 'connected') return 'green';
      if (store.conn === 'lost') return 'red blink';
      if (store.conn === 'connecting') return 'yellow';
      return '';
    },
    connText() {
      return { connected: '已连接 Connected', lost: '通信中断 LOST',
               connecting: '连接中 Connecting', disconnected: '未连接 Disconnected',
      }[store.conn] || store.conn;
    },
    errCount() { return store.errorsActive.length; },
  },
  template: `
  <footer class="statusbar">
    <span class="led" :class="ledClass"></span>
    <span :style="store.conn==='lost' ? 'color:var(--critical)' : ''">{{ connText }}</span>
    <span v-if="store.device" class="muted">{{ store.device.serial_number }} · fw v{{ store.device.fw_version }} · {{ store.device.hw_variant }}V</span>
    <span v-if="!store.wsUp" style="color:var(--warning)">遥测通道断开 WS down</span>
    <span v-if="store.recording" style="color:var(--series-3)">● 记录中 REC {{ store.recording.name }}</span>
    <span class="msg">{{ store.lastLog }}</span>
    <span v-if="errCount" style="color:var(--critical)">⚠ {{ errCount }} 个活跃错误 active errors</span>
    <span class="muted" v-if="store.mockMode">模拟模式 MOCK</span>
  </footer>`,
};
