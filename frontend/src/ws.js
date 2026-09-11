// WebSocket 遥测客户端：单连接，自动重连
export class WsClient {
  constructor() {
    this.ws = null;
    this.paths = new Set();
    this.rate = 20;
    this.onTelemetry = [];   // (t, values) => {}
    this.onEvent = [];       // (event) => {}
    this.onStatus = [];      // (connected:boolean) => {}
    this._retry = 0;
    this._closed = false;
  }

  connect() {
    this._closed = false;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      this._retry = 0;
      this.onStatus.forEach((f) => f(true));
      this._sendSub();
    };
    ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (msg.type === 'telemetry') {
        this.onTelemetry.forEach((f) => f(msg.t, msg.values));
      } else if (msg.type === 'event') {
        this.onEvent.forEach((f) => f(msg.event));
      }
    };
    ws.onclose = () => {
      this.onStatus.forEach((f) => f(false));
      if (!this._closed) {
        const delay = Math.min(5000, 500 * 2 ** this._retry++);
        setTimeout(() => this.connect(), delay);
      }
    };
    ws.onerror = () => ws.close();
  }

  close() { this._closed = true; this.ws?.close(); }

  _sendSub() {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'subscribe', paths: [...this.paths], rate_hz: this.rate,
      }));
    }
  }

  subscribe(paths, rate) {
    this.paths = new Set(paths);
    if (rate) this.rate = rate;
    this._sendSub();
  }
}

export const wsClient = new WsClient();
