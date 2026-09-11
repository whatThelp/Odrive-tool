"""遥测中心 Telemetry hub.

- WebSocket 订阅/推送任意属性的实时值
- 后台监视：轴状态变化、新错误 -> 事件推送 + 历史错误日志（带时间戳）
- CSV 长时间记录器（数小时至数天，直接落盘）
"""
from __future__ import annotations

import asyncio
import csv
import json
import time
from pathlib import Path
from typing import Any

from fastapi import WebSocket

from . import errors_zh
from .device.base import DeviceIOError
from .device.manager import DeviceManager


class ErrorLog:
    """历史错误日志，内存保留最近 500 条并追加到 jsonl 文件。"""

    def __init__(self, data_dir: Path) -> None:
        self.file = data_dir / "error_log.jsonl"
        self.entries: list[dict] = []
        if self.file.exists():
            try:
                lines = self.file.read_text(encoding="utf-8").strip().splitlines()
                self.entries = [json.loads(x) for x in lines[-500:]]
            except Exception:
                self.entries = []

    def add(self, entry: dict) -> None:
        entry["time"] = time.strftime("%Y-%m-%d %H:%M:%S")
        entry["t"] = time.time()
        self.entries.append(entry)
        self.entries = self.entries[-500:]
        try:
            with self.file.open("a", encoding="utf-8") as f:
                f.write(json.dumps(entry, ensure_ascii=False) + "\n")
        except Exception:
            pass

    def clear(self) -> None:
        self.entries = []
        self.file.unlink(missing_ok=True)


class CsvRecorder:
    """长时间数据记录，按行写入 CSV，可运行数小时至数天。"""

    def __init__(self, data_dir: Path) -> None:
        self.dir = data_dir / "recordings"
        self.dir.mkdir(parents=True, exist_ok=True)
        self.active: dict | None = None

    def start(self, paths: list[str], rate_hz: float) -> dict:
        if self.active:
            raise RuntimeError("已有记录正在进行 (recording already running)")
        name = time.strftime("record_%Y%m%d_%H%M%S.csv")
        f = (self.dir / name).open("w", newline="", encoding="utf-8-sig")
        writer = csv.writer(f)
        writer.writerow(["timestamp", "t_rel_s"] + paths)
        self.active = {"file": f, "writer": writer, "paths": paths,
                       "rate": max(0.2, min(50.0, rate_hz)),
                       "t0": time.time(), "rows": 0, "name": name,
                       "next_t": time.time()}
        return {"name": name, "paths": paths, "rate": self.active["rate"]}

    def tick(self, values: dict[str, Any]) -> None:
        rec = self.active
        if not rec or time.time() < rec["next_t"]:
            return
        rec["next_t"] += 1.0 / rec["rate"]
        now = time.time()
        rec["writer"].writerow(
            [time.strftime("%Y-%m-%d %H:%M:%S"), round(now - rec["t0"], 3)]
            + [values.get(p, "") for p in rec["paths"]])
        rec["rows"] += 1
        if rec["rows"] % 200 == 0:
            rec["file"].flush()

    def stop(self) -> dict | None:
        if not self.active:
            return None
        rec = self.active
        rec["file"].flush()
        rec["file"].close()
        self.active = None
        return {"name": rec["name"], "rows": rec["rows"],
                "duration_s": round(time.time() - rec["t0"], 1)}

    def status(self) -> dict | None:
        if not self.active:
            return None
        return {"name": self.active["name"], "rows": self.active["rows"],
                "paths": self.active["paths"], "rate": self.active["rate"],
                "duration_s": round(time.time() - self.active["t0"], 1)}


class TelemetryHub:
    def __init__(self, manager: DeviceManager, data_dir: Path) -> None:
        self.manager = manager
        self.clients: dict[WebSocket, dict] = {}   # ws -> {"paths": set, "rate": hz}
        self.error_log = ErrorLog(data_dir)
        self.recorder = CsvRecorder(data_dir)
        self._last_states: dict[str, Any] = {}
        self._last_errors: dict[str, int] = {}
        self._queue: asyncio.Queue[dict] = asyncio.Queue()
        self._io_fail_count = 0
        manager.on_event = self.push_event

    # ------------------------------------------------------------- ws client
    async def attach(self, ws: WebSocket) -> None:
        await ws.accept()
        self.clients[ws] = {"paths": set(), "rate": 10.0, "acc": 0.0}

    def detach(self, ws: WebSocket) -> None:
        self.clients.pop(ws, None)

    def handle_message(self, ws: WebSocket, msg: dict) -> None:
        sub = self.clients.get(ws)
        if sub is None:
            return
        if msg.get("type") == "subscribe":
            sub["paths"] = set(msg.get("paths", []))
            sub["rate"] = max(1.0, min(50.0, float(msg.get("rate_hz", 10))))
        elif msg.get("type") == "unsubscribe":
            sub["paths"] -= set(msg.get("paths", []))

    def push_event(self, event: dict) -> None:
        """线程安全事件入队（也可从非 async 上下文调用）。"""
        try:
            self._queue.put_nowait(event)
        except Exception:
            pass

    # ------------------------------------------------------------ main loops
    async def broadcast(self, payload: dict) -> None:
        dead = []
        text = json.dumps(payload, ensure_ascii=False)
        for ws in list(self.clients):
            try:
                await ws.send_text(text)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.detach(ws)

    async def run(self) -> None:
        """20Hz 主循环: 仿真步进 + 采样广播 + 状态/错误监视 + CSV 记录。"""
        tick = 0.05
        last = time.monotonic()
        while True:
            await asyncio.sleep(tick)
            now = time.monotonic()
            dt, last = now - last, now

            # 事件队列 -> 广播
            while not self._queue.empty():
                await self.broadcast({"type": "event", "event": self._queue.get_nowait()})

            dev = self.manager.device
            if dev is None:
                continue
            dev.step(dt)

            # 收集所有订阅路径 + 记录器路径
            paths: set[str] = set()
            for sub in self.clients.values():
                paths |= sub["paths"]
            if self.recorder.active:
                paths |= set(self.recorder.active["paths"])
            paths |= self._watch_paths(dev)

            try:
                values = dev.read_many(list(paths)) if paths else {}
                if self.manager.status == "lost":
                    self.manager.mark_recovered()
                self._io_fail_count = 0
            except DeviceIOError:
                self._io_fail_count += 1
                if self._io_fail_count >= 4:
                    self.manager.mark_lost()
                continue

            self.recorder.tick(values)
            self._watch_changes(dev, values)

            # 按各自的订阅集推送（统一 20Hz 内按 rate 抽稀）
            t = time.time()
            for ws, sub in list(self.clients.items()):
                if not sub["paths"]:
                    continue
                sub["acc"] += tick
                if sub["acc"] < 1.0 / sub["rate"]:
                    continue
                sub["acc"] = 0.0
                payload = {"type": "telemetry", "t": t,
                           "values": {p: values.get(p) for p in sub["paths"]}}
                try:
                    await ws.send_text(json.dumps(payload, ensure_ascii=False))
                except Exception:
                    self.detach(ws)

    # ---------------------------------------------------------------- watch
    def _watch_paths(self, dev) -> set[str]:
        paths = {"error"}
        for n in range(dev.info.axis_count):
            paths |= {f"axis{n}.current_state", f"axis{n}.error",
                      f"axis{n}.motor.error", f"axis{n}.encoder.error",
                      f"axis{n}.controller.error"}
        return paths

    def _watch_changes(self, dev, values: dict) -> None:
        # 轴状态变化事件
        for n in range(dev.info.axis_count):
            key = f"axis{n}.current_state"
            new = values.get(key)
            if new is not None and new != self._last_states.get(key):
                if key in self._last_states:
                    self.push_event({"type": "state_change", "axis": n,
                                     "state": errors_zh.axis_state_label(new)})
                self._last_states[key] = new
        # 新错误 -> 事件 + 历史日志
        kinds = [("odrive", "error")] + [
            (k, f"axis{n}.{'' if k == 'axis' else k + '.'}error")
            for n in range(dev.info.axis_count)
            for k in ("axis", "motor", "encoder", "controller")]
        for kind, path in kinds:
            code = values.get(path)
            if code is None:
                continue
            code = int(code)
            old = self._last_errors.get(path, 0)
            if code != old:
                self._last_errors[path] = code
                new_bits = code & ~old
                if new_bits:
                    decoded = errors_zh.decode(kind, new_bits)
                    entry = {"type": "error", "source": path, "code": code,
                             "new_bits": new_bits, "decoded": decoded,
                             "serial": dev.info.serial_number}
                    self.error_log.add(dict(entry))
                    self.push_event(entry)
