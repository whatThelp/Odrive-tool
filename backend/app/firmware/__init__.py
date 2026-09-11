"""固件参数定义加载器 Firmware interface loader.

根据设备固件版本 (v0.5.x / v0.6.x) 动态加载对应的参数定义 JSON，
保证不同固件下参数名称、类型和范围正确适配。
定义文件为纯数据，可直接编辑扩充参数条目。
"""
from __future__ import annotations

import copy
import json
from pathlib import Path

_DIR = Path(__file__).parent
_CACHE: dict[str, dict] = {}


def load_interface(fw_version: str) -> dict:
    """按固件版本选择接口定义。0.6.x -> v0_6.json，其余默认 v0_5.json。"""
    name = "v0_6" if fw_version.startswith("0.6") else "v0_5"
    if name not in _CACHE:
        _CACHE[name] = json.loads((_DIR / f"{name}.json").read_text(encoding="utf-8"))
    return _CACHE[name]


def expand_interface(fw_version: str, axis_count: int = 2) -> dict:
    """把带 {n} 占位符的轴级参数展开为每个轴的具体路径。"""
    iface = copy.deepcopy(load_interface(fw_version))
    for group in iface["groups"]:
        # 展开顺序：设备级参数在前，随后按轴分块（A0 全部参数 -> A1 全部参数）
        device_params, axis_blocks = [], [[] for _ in range(axis_count)]
        for p in group["params"]:
            if "{n}" in p["path"]:
                for n in range(axis_count):
                    q = dict(p)
                    q["path"] = p["path"].replace("{n}", str(n))
                    q["axis"] = n
                    axis_blocks[n].append(q)
            else:
                device_params.append(p)
        group["params"] = device_params + [p for block in axis_blocks for p in block]
    for key in ("telemetry_paths", "status_paths"):
        out = []
        for p in iface.get(key, []):
            if "{n}" in p["path"]:
                for n in range(axis_count):
                    q = dict(p)
                    q["path"] = p["path"].replace("{n}", str(n))
                    q["axis"] = n
                    out.append(q)
            else:
                out.append(p)
        iface[key] = out
    iface["fw_version"] = fw_version
    return iface


def writable_paths(fw_version: str, axis_count: int = 2) -> list[str]:
    """全部可写参数路径（用于快照）。"""
    iface = expand_interface(fw_version, axis_count)
    return [p["path"] for g in iface["groups"] for p in g["params"]]
