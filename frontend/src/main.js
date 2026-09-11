// 应用入口 App entry
import { createApp } from './vue.js';
import { store, boot, estop, undoLast, connect, disconnect } from './store.js';
import TopBar from './components/TopBar.js';
import StatusBar from './components/StatusBar.js';
import ParamPanel from './components/ParamPanel.js';
import Dashboard from './components/Dashboard.js';
import ChartView from './components/ChartView.js';
import TestPanel from './components/TestPanel.js';
import CalibWizard from './components/CalibWizard.js';
import ConsoleView from './components/ConsoleView.js';
import HistoryPanel from './components/HistoryPanel.js';

const TABS = [
  { id: 'dashboard', zh: '仪表盘', en: 'Dashboard', comp: 'Dashboard' },
  { id: 'chart', zh: '实时图表', en: 'Charts', comp: 'ChartView' },
  { id: 'test', zh: '手动测试', en: 'Testing', comp: 'TestPanel' },
  { id: 'calib', zh: '校准向导', en: 'Calibration', comp: 'CalibWizard' },
  { id: 'console', zh: '控制台', en: 'Console', comp: 'ConsoleView' },
  { id: 'history', zh: '操作历史', en: 'History', comp: 'HistoryPanel' },
];

const App = {
  name: 'App',
  components: {
    TopBar, StatusBar, ParamPanel, Dashboard, ChartView,
    TestPanel, CalibWizard, ConsoleView, HistoryPanel,
  },
  data() {
    const saved = parseInt(localStorage.getItem('odrive-gui.leftW'), 10);
    return {
      TABS,
      leftW: Number.isFinite(saved) ? saved : 360,
      resizing: false,
    };
  },
  computed: {
    store() { return store; },
    activeComp() { return TABS.find((t) => t.id === store.tab)?.comp || 'Dashboard'; },
  },
  methods: {
    doEstop() { estop(); },
    // ---- 左侧面板宽度拖拽 Left panel resizing ----
    clampW(w) {
      const max = Math.max(320, Math.min(640, window.innerWidth * 0.55));
      return Math.round(Math.max(240, Math.min(max, w)));
    },
    startResize(e) {
      e.preventDefault();
      this.resizing = true;
      document.body.classList.add('resizing');
      const move = (ev) => {
        this.leftW = this.clampW(ev.clientX);
        window.dispatchEvent(new Event('resize')); // 让图表跟随重排
      };
      const up = () => {
        this.resizing = false;
        document.body.classList.remove('resizing');
        localStorage.setItem('odrive-gui.leftW', String(this.leftW));
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
        window.dispatchEvent(new Event('resize'));
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    },
    resetResize() {
      this.leftW = 360;
      localStorage.setItem('odrive-gui.leftW', '360');
      window.dispatchEvent(new Event('resize'));
    },
    onKey(e) {
      const inInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
      // Esc: 紧急停止（任何时候）
      if (e.key === 'Escape' && store.conn === 'connected') {
        e.preventDefault();
        estop();
        return;
      }
      if (e.altKey && (e.key === '1' || e.key === '2')) {
        e.preventDefault();
        store.axis = e.key === '1' ? 0 : 1;
        return;
      }
      if (e.altKey && (e.key === 'c' || e.key === 'C')) {
        e.preventDefault();
        if (store.conn === 'connected' || store.conn === 'lost') disconnect();
        else if (store.devices.length) connect(store.devices[0].serial_number);
        return;
      }
      if (e.ctrlKey && (e.key === 'z' || e.key === 'Z') && !inInput) {
        e.preventDefault();
        undoLast();
      }
    },
  },
  mounted() {
    window.addEventListener('keydown', this.onKey);
    boot();
  },
  template: `
  <div class="layout" :style="{ '--left-w': leftW + 'px' }">
    <TopBar />
    <ParamPanel />
    <div class="resizer" :class="{ dragging: resizing }"
         title="拖拽调节面板宽度，双击复位 Drag to resize, double-click to reset"
         @mousedown="startResize" @dblclick="resetResize"></div>
    <div class="main">
      <nav class="tabs">
        <button v-for="t in TABS" :key="t.id" :class="{active: store.tab === t.id}"
                @click="store.tab = t.id">{{ t.zh }} {{ t.en }}</button>
      </nav>
      <div class="tabbody">
        <keep-alive include="ChartView,ConsoleView,HistoryPanel,CalibWizard,TestPanel">
          <component :is="activeComp" />
        </keep-alive>
      </div>
    </div>
    <StatusBar />

    <!-- 固定悬浮急停：圆形，右下角，尺寸随画面自适应，任何页面都可见可按 -->
    <button class="estop estop-fixed" @click="doEstop"
            :disabled="store.conn !== 'connected' && store.conn !== 'lost'"
            title="紧急停止：所有轴立即进入 IDLE (快捷键 Esc)">
      <span class="zh">急停</span>E-STOP</button>

    <div v-if="store.toastMsg" class="toast" :class="store.toastMsg.kind"
         @click="store.toastMsg = null">{{ store.toastMsg.msg }}</div>
  </div>`,
};

createApp(App).mount('#app');
