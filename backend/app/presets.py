"""配置预设（快照）管理 Preset / snapshot management.

- 支持完整设备配置或指定参数类别的快照保存 / 应用 / 对比
- JSON 导入导出，文件携带固件版本标记防止跨版本误用
- 应用时仅写入与当前值不同的参数（变更追踪）
"""
from __future__ import annotations

import json
import re
import time
import uuid
from pathlib import Path
from typing import Any

from .device.base import BaseDevice
from .firmware import expand_interface


class PresetStore:
    def __init__(self, data_dir: Path) -> None:
        self.dir = data_dir / "presets"
        self.dir.mkdir(parents=True, exist_ok=True)

    # ----------------------------------------------------------------- files
    def _path(self, preset_id: str) -> Path:
        if not re.fullmatch(r"[0-9a-f]{8}", preset_id):
            raise ValueError("invalid preset id")
        return self.dir / f"{preset_id}.json"

    def list(self) -> list[dict]:
        out = []
        for f in sorted(self.dir.glob("*.json")):
            try:
                data = json.loads(f.read_text(encoding="utf-8"))
                out.append({k: data[k] for k in
                            ("id", "name", "created", "fw_version", "hw_variant",
                             "categories") if k in data}
                           | {"param_count": len(data.get("values", {}))})
            except Exception:
                continue
        return sorted(out, key=lambda x: x.get("created", ""), reverse=True)

    def get(self, preset_id: str) -> dict:
        p = self._path(preset_id)
        if not p.exists():
            raise FileNotFoundError(f"预设不存在 (preset not found): {preset_id}")
        return json.loads(p.read_text(encoding="utf-8"))

    def delete(self, preset_id: str) -> None:
        self._path(preset_id).unlink(missing_ok=True)

    # -------------------------------------------------------------- snapshot
    def snapshot(self, device: BaseDevice, name: str,
                 categories: list[str] | None = None) -> dict:
        """读取设备当前配置生成快照。categories 为空表示全部类别。"""
        iface = expand_interface(device.info.fw_version, device.info.axis_count)
        values: dict[str, Any] = {}
        cats: list[str] = []
        for group in iface["groups"]:
            if categories and group["id"] not in categories:
                continue
            cats.append(group["id"])
            for p in group["params"]:
                try:
                    values[p["path"]] = device.read(p["path"])
                except KeyError:
                    continue
        preset = {
            "id": uuid.uuid4().hex[:8],
            "name": name,
            "created": time.strftime("%Y-%m-%d %H:%M:%S"),
            "fw_version": device.info.fw_version,
            "hw_variant": device.info.hw_variant,
            "categories": cats,
            "values": values,
        }
        self._path(preset["id"]).write_text(
            json.dumps(preset, ensure_ascii=False, indent=2), encoding="utf-8")
        return preset

    # ----------------------------------------------------------------- apply
    @staticmethod
    def fw_compatible(preset_fw: str, device_fw: str) -> bool:
        """主次版本一致视为兼容 (0.5.x vs 0.5.y -> 兼容)。"""
        try:
            a = preset_fw.split(".")[:2]
            b = device_fw.split(".")[:2]
            return a == b
        except Exception:
            return False

    def diff(self, preset_id: str, device: BaseDevice) -> dict:
        """预设值与设备当前值对比。"""
        preset = self.get(preset_id)
        rows = []
        for path, want in preset["values"].items():
            try:
                current = device.read(path)
            except KeyError:
                rows.append({"path": path, "preset": want, "current": None,
                             "status": "missing"})
                continue
            same = (abs(current - want) < 1e-9
                    if isinstance(want, float) and isinstance(current, (int, float))
                    else current == want)
            rows.append({"path": path, "preset": want, "current": current,
                         "status": "same" if same else "diff"})
        return {
            "preset": {k: preset[k] for k in ("id", "name", "fw_version")},
            "fw_compatible": self.fw_compatible(preset["fw_version"],
                                                device.info.fw_version),
            "rows": rows,
        }

    def import_json(self, raw: str) -> dict:
        data = json.loads(raw)
        if "values" not in data or "fw_version" not in data:
            raise ValueError("预设文件缺少 values / fw_version 字段 (invalid preset file)")
        data["id"] = uuid.uuid4().hex[:8]
        data.setdefault("name", "导入预设 Imported")
        data.setdefault("created", time.strftime("%Y-%m-%d %H:%M:%S"))
        data.setdefault("categories", [])
        data.setdefault("hw_variant", 56)
        self._path(data["id"]).write_text(
            json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        return data
