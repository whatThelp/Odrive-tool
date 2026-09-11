// 顶部工具栏：连接管理 / 轴切换 / 紧急停止 / 快速操作
import { store, scan, connect, disconnect, deviceAction, undoLast, axisCalibrated } from '../store.js';

export default {
  name: 'TopBar',
  data() {
    return {
      serial: '',
      transport: 'usb',
      uartPort: 'COM3',
      uartBaud: 115200,
      canChannel: 'COM4',
      canBitrate: 250000,
      showHelp: false,
    };
  },
  computed: {
    store() { return store; },
    connected() { return store.conn === 'connected' || store.conn === 'lost'; },
  },
  methods: {
    axisCalibrated,
    async doScan() {
      await scan();
      this.serial = store.device?.serial_number
        || this.serial || store.devices[0]?.serial_number || '';
    },
    doConnect() {
      const options = this.transport === 'uart'
        ? { port: this.uartPort, baudrate: this.uartBaud }
        : this.transport === 'can'
          ? { channel: this.canChannel, bitrate: this.canBitrate } : {};
      connect(this.serial || null, this.transport, options);
    },
    doDisconnect() { disconnect(); },
    undo() { undoLast(); },
    save() { deviceAction('save', '配置已保存 (configuration saved)'); },
    clearErr() { deviceAction('clear_errors', '错误已清除 (errors cleared)'); },
  },
  watch: {
    'store.device': {
      handler(d) { if (d) this.serial = d.serial_number; },
      immediate: true,
    },
  },
  mounted() { this.doScan(); },
  template: `
  <header class="topbar">
    <span class="brand">ODrive 上位机<small>Host Controller</small></span>

    <!-- 连接指示：驱动板连接后显示绿色 -->
    <span class="conn-pill" :class="{ on: store.conn === 'connected', lost: store.conn === 'lost' }">
      <span class="led" :class="store.conn === 'connected' ? 'green' : store.conn === 'lost' ? 'red blink' : store.conn === 'connecting' ? 'yellow' : ''"></span>
      {{ store.conn === 'connected' ? '已连接 Connected' : store.conn === 'lost' ? '通信中断 LOST' : store.conn === 'connecting' ? '连接中…' : '未连接 Disconnected' }}
    </span>

    <select v-model="serial" :disabled="connected" style="min-width:170px"
            title="选择设备 Select device">
      <option v-if="!store.devices.length" value="">— 未发现设备 No device —</option>
      <option v-for="d in store.devices" :key="d.serial_number" :value="d.serial_number">
        {{ d.serial_number }} · v{{ d.fw_version }} · {{ d.hw_variant }}V{{ d.is_mock ? ' · 模拟' : '' }}
      </option>
    </select>
    <select v-model="transport" :disabled="connected" title="通信接口 Transport">
      <option value="usb">USB</option>
      <option value="uart" :disabled="!store.transports.uart">UART</option>
      <option value="can" :disabled="!store.transports.can">CAN</option>
    </select>
    <template v-if="transport==='uart' && !connected">
      <input type="text" v-model="uartPort" style="width:70px" title="串口 Port">
      <input type="number" v-model.number="uartBaud" style="width:86px" title="波特率 Baudrate">
    </template>
    <template v-if="transport==='can' && !connected">
      <input type="text" v-model="canChannel" style="width:70px" title="通道 Channel">
      <input type="number" v-model.number="canBitrate" style="width:86px" title="波特率 Bitrate">
    </template>

    <button class="btn" @click="doScan" :disabled="store.scanning || connected">
      {{ store.scanning ? '扫描中…' : '扫描 Scan' }}
    </button>
    <button v-if="!connected" class="btn primary" @click="doConnect"
            :disabled="store.connecting">
      {{ store.connecting ? '连接中…' : '连接 Connect' }}
    </button>
    <button v-else class="btn" @click="doDisconnect">断开 Disconnect</button>

    <div class="spacer"></div>

    <div class="axis-switch" v-if="connected" title="轴切换 Axis switch (Alt+1 / Alt+2)">
      <button v-for="n in (store.device?.axis_count ?? 2)" :key="n"
              :class="['a' + (n-1), {active: store.axis === n-1}]"
              @click="store.axis = n-1">
        <span class="axis-dot"></span>轴 Axis {{ n-1 }}
        <span v-if="axisCalibrated(n-1) === false" class="uncal-dot"
              title="未校准 uncalibrated"></span>
      </button>
    </div>

    <button class="btn" @click="save" :disabled="!connected"
            title="保存配置到设备 Flash (odrv.save_configuration)">保存配置 Save</button>
    <button class="btn" @click="clearErr" :disabled="!connected"
            title="清除所有错误 Clear errors">清错 Clear</button>
    <button class="btn" @click="undo" title="撤销最近参数修改 Undo (Ctrl+Z)">撤销 Undo</button>
    <button class="btn" @click="showHelp = !showHelp" title="键盘快捷键 Shortcuts">⌨</button>

    <div v-if="showHelp" class="help-pop" style="top:52px; right:12px;" @click="showHelp=false">
      <div class="t">键盘快捷键 Keyboard Shortcuts</div>
      <div class="body">
        <div class="kv"><span class="k">紧急停止 E-Stop</span><span><kbd>Esc</kbd></span></div>
        <div class="kv"><span class="k">连接/断开 Connect</span><span><kbd>Alt</kbd>+<kbd>C</kbd></span></div>
        <div class="kv"><span class="k">切换到轴 0 / 1 Axis</span><span><kbd>Alt</kbd>+<kbd>1</kbd> / <kbd>2</kbd></span></div>
        <div class="kv"><span class="k">撤销 Undo</span><span><kbd>Ctrl</kbd>+<kbd>Z</kbd></span></div>
      </div>
    </div>
  </header>`,
};
