# ODrive 上位机 ODrive Host Controller GUI

[![Release](https://img.shields.io/github/v/release/whatThelp/Odrive-tool)](https://github.com/whatThelp/Odrive-tool/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Python](https://img.shields.io/badge/Python-3.7%2B-blue.svg)](https://www.python.org/)
[![Firmware](https://img.shields.io/badge/ODrive%20FW-v0.5.x%20%7C%20v0.6.x-orange.svg)](https://docs.odriverobotics.com/)

面向 **ODrive 3.6** 无刷电机驱动器的上位机控制软件，支持网页访问与独立应用发布。
实现 **参数调参 / 功能测试 / 状态监控** 三大核心模块，界面为「中文主显 + 英文备注」的
工业风格深色主题。

兼容固件 **v0.5.x 与 v0.6.x**，自动适配 **24V (12–24V)** 与 **56V (12–56V)** 电源版本。
**无硬件也能完整体验**——内置设备模拟器，含物理仿真与故障注入。

**直接下载可执行程序** → [Releases 最新版](https://github.com/whatThelp/Odrive-tool/releases/latest)（Windows x64，解压即用）

**或克隆源码**：

```bash
git clone https://github.com/whatThelp/Odrive-tool.git
```

---

## 功能总览 Features

| 模块 | 功能 |
|---|---|
| **调参 Parameter Tuning** | 参数逻辑分组（电机/编码器/电流限制/速度环/位置环/电源保护/制动电阻/通信）· 变更追踪（仅写入实际修改项）· 配置预设快照（保存/应用/对比/JSON 导入导出，携带固件版本标记）· 硬性安全钳位（电流 ≤120A、电压阈值按硬件版本）· 擦除配置并重启 |
| **测试 Testing** | 位置/速度/扭矩滑块+数值实时下发 · 一键校准向导（含安全警告与进度）· WebSocket 实时图表（最多 8 变量、CSV 导出、服务端长时间记录）· odrivetool 风格命令控制台（read/write/call，`odrv0.` 前缀可选）· Axis 0/1 双轴切换 · 模拟设备模式（支持故障注入：通信中断/轴错误/欠压/过温） |
| **监控 Monitoring** | 母线电压/电流仪表盘 · 轴状态 (IDLE/CLOSED_LOOP…) · MOSFET/电机温度（高温醒目告警）· 虚拟 LED 状态指示 · 错误代码中文解读 + 带时间戳历史错误日志 · 醒目紧急停止按钮 (E-STOP) |
| **通信 Connectivity** | USB（官方 fibre 协议，功能完整）· UART（ASCII 协议，默认 115200 可配置）· CAN（CANSimple，默认 250K 可配置，仅设定值/急停等有限功能）· 设备自动扫描发现（序列号/固件版本/轴数）· 固件版本自适应加载参数定义 |
| **体验 UX** | 全部界面中文主显+英文备注 · 每个参数悬停帮助（作用/推荐范围/官方文档链接）· 操作历史面板 + 撤销 Undo · 键盘快捷键（Esc 急停 / Alt+C 连接 / Alt+1·2 切轴 / Ctrl+Z 撤销）|

---

## 部署说明 Deployment

### 方式一：独立应用程序（终端用户，双击即用）

**无需安装 Python 或 Node.js。** 从 [Releases 页面](https://github.com/whatThelp/Odrive-tool/releases/latest)
下载，两种产物按需取用：

| 下载 | 启动速度 | 说明 |
|---|---|---|
| **`odrive-gui-windows-x64.zip`** | **约 2 秒** | **推荐**。解压后双击启动脚本即用 |
| `odrive-gui-portable.exe` | 约 10–20 秒 | 单文件便携版，方便随身携带，但每次运行都要解包约 27 MB |

**使用步骤**（以推荐的 zip 为例）：

1. 下载并**完整解压**（不要只取出 bat 文件）
2. 双击其中一个启动脚本：
   - `启动-模拟演示.bat` — 无需任何硬件，内置模拟器体验全部功能
   - `启动-真实硬件.bat` — USB 连接 ODrive 后使用
3. 约 2 秒后浏览器自动打开控制界面

命令行参数：`odrive-gui.exe [--mock] [--port 8080] [--no-browser]`

> **启动须知**
> - 首次运行会被 Windows Defender 扫描，可能额外等待 30 秒左右，之后恢复正常速度。
> - 控制台窗口会显示「正在启动…」，服务就绪后才会自动打开浏览器，**请勿重复双击**。
> - 8000 端口被占用时程序自动顺延到下一个可用端口，并在窗口中提示实际地址。
> - **关闭控制台窗口即退出程序**；启动脚本每次会先清理残留实例。

**自行构建**（仓库不包含二进制产物）：

```bash
python scripts/build_release.py           # 快速版 (onedir)，产物在 dist/odrive-gui/
python scripts/build_release.py --onefile # 单文件便携版
python scripts/build_release.py --both    # 两者都构建
```

基于 PyInstaller，前端为免构建 ESM，无需 Node 即可打包；venv 中装有
odrive/pyserial 时自动打入真实硬件支持。构建完成后，仓库根目录的
`启动ODrive上位机.bat` / `启动ODrive上位机-模拟演示.bat` 会自动找到 `dist/` 下的程序。

目前仅提供 Windows x64 预编译产物；Linux / macOS 请按上述命令自行构建。

### 方式二：开发模式（开发者）

```bash
# 1. 克隆仓库
git clone https://github.com/whatThelp/Odrive-tool.git
cd Odrive-tool

# 2. 运行安装脚本（自动创建虚拟环境并安装依赖）
# Linux/macOS:
./install.sh
# Windows:
install.bat

# 3. 开发模式运行
cd frontend
npm run dev          # 真实硬件模式
npm run mock_dev     # 模拟设备模式（无需硬件）

# 4. 访问 http://localhost:3000
```

**没有 Node.js 也可以直接运行**（前端为免构建 ESM，由后端直接托管）：

```bash
# Windows
.venv\Scripts\python backend\run.py --mock --open
# Linux/macOS
.venv/bin/python backend/run.py --mock --open
# 访问 http://127.0.0.1:8000
```

### 环境要求

- **独立应用**：无需额外环境。
- **开发模式**：Python 3.7+（推荐 3.10+）；Node.js 18+ 仅在使用 Vite 开发服务器时需要。
- **真实硬件**：`pip install -r backend/requirements-hardware.txt`
  （`odrive` / `pyserial` / `python-can`，按需安装）。

---

## 使用说明 User Guide

### 1. 界面布局

```
┌──────────────────────────────────────────────────────────────┐
│ 顶部工具栏：连接状态灯 · 设备选择 · 接口 · 扫描/连接 · 轴切换   │
│             保存配置 · 清错 · 撤销 · 快捷键                    │
├───────────────────┬──────────────────────────────────────────┤
│ 左侧参数面板       │ 标签页：仪表盘 / 实时图表 / 手动测试 /     │
│ （可拖拽调宽，     │         校准向导 / 控制台 / 操作历史       │
│   双击分隔条复位） │                                          │
│ 按功能分组         │ 主工作区                                  │
│ 每组内先 A0 后 A1  │                                          │
├───────────────────┴──────────────────────────────────────────┤
│ 底部状态栏：连接指示 · 设备信息 · 实时日志 · 活跃错误数    ●急停│
└──────────────────────────────────────────────────────────────┘
```

右下角的 **红色圆形急停按钮** 悬浮在所有内容之上，任何页面、任何窗口尺寸下都可见可点，
尺寸随窗口自适应。快捷键 `Esc` 同样触发。

### 2. 第一次使用（无硬件，5 分钟体验）

1. 双击 `启动ODrive上位机-模拟演示.bat`，约 2 秒后浏览器自动打开。
2. 顶栏设备下拉框已列出两台模拟设备，点 **连接 Connect**：
   - `SIM-000001` — 固件 v0.5.11，24V 版本
   - `SIM-000002` — 固件 v0.6.8，56V 版本
3. 连接后顶栏指示灯变 **绿色**，左侧参数树按固件版本自动加载。
4. 切到 **校准向导 Calibration** → 点「开始一键校准」，观察四步进度与电机实时状态。
5. 校准完成后自动切换为 **斜坡速度控制** 模式；切到 **手动测试 Testing**，
   点「进入闭环」，拖动滑块即可看到转速跟随。
6. 在「模拟器故障注入」里点 *通信中断 / 轴错误 / 欠压 / 过温*，
   验证上位机的告警与容错表现。

### 3. 连接真实 ODrive

| 接口 | 说明 | 前置条件 |
|---|---|---|
| **USB**（推荐） | 官方 fibre 协议，功能完整 | `pip install odrive`；Windows 需装好 ODrive 的 USB 驱动 |
| **UART** | ASCII 协议，默认 115200（可改） | `pip install pyserial`；固件需启用 UART_A 且协议为 ASCII |
| **CAN** | CANSimple，默认 250K（可改） | `pip install python-can`；**仅支持设定值下发/急停，参数配置请用 USB** |

操作：顶栏选择接口 → **扫描 Scan** → 选中设备 → **连接 Connect**。
连接后会显示序列号、固件版本、电源版本（24V/56V），参数定义随固件版本自动切换。

### 4. 调试一台新电机（完整流程）

> ⚠️ 开始前请确认：电机已牢固固定、轴上无危险负载、周围无人接触旋转部件。

1. **填写电机参数**（左侧「电机参数 Motor」）
   - 极对数 = 磁极数 ÷ 2（常见航模电机为 7）
   - 扭矩常数 ≈ 8.27 ÷ KV 值
2. **设保守限值**（「电流与速度限制」）
   - 首次调试建议：电流限制 10 A、速度限制 5 turns/s
   - 界面对电流做硬性钳位（≤120 A），超出会自动限制并提示
3. **确认编码器**（「编码器配置」）
   - CPR = 编码器线数 × 4；霍尔编码器则为 6 × 极对数
4. 点左下 **写入 Apply**（只写实际改动的参数）
5. **校准向导** → 一键校准（电机参数辨识 → 编码器偏移 → 闭环测试）
6. **手动测试** → 进入闭环，从小设定值开始试转
7. **整定 PID**（手动测试页「环路增益整定」）：调 `pos_gain` / `vel_gain` /
   `vel_integrator_gain`，配合实时图表观察阶跃响应
8. 满意后点顶栏 **保存配置 Save** 写入 Flash（否则断电丢失）

### 5. 各标签页功能

**仪表盘 Dashboard** — 母线电压/电流大字显示、每轴状态卡（位置/速度/电流/温度）、
虚拟 LED、活跃错误中文解读、最近错误记录。未校准的轴会 **高亮为琥珀色** 并显示
「⚠ 未校准」徽标，可直接点「→ 去校准」跳转。

**实时图表 Charts** — 勾选要监控的变量（最多 8 条曲线），也可手输任意属性路径。
支持时间窗切换（30 秒 ~ 6 小时）、暂停、CSV 导出。底部「长时间数据记录」由服务端
直接写 CSV，可连续运行数小时至数天。

**手动测试 Testing** — 位置/速度/扭矩三种模式实时下发：
- 速度模式可启用 **速度斜坡**，设置斜率（turns/s²）让设定值平滑过渡
- 扭矩模式可设 **最大速度限制**，防止空载飞车
- **环路增益整定**：在线修改 PID，改动记入历史可 `Ctrl+Z` 撤销
- **电机实时状态卡**：控制模式、输入模式、位置、转速、设定转速、电机电流、
  母线电压电流、温度、错误码，一屏全显
- 模拟模式下额外提供故障注入面板

**校准向导 Calibration** — 四步引导（安全检查 → 电机参数辨识 → 编码器偏移校准 →
闭环测试），全程显示进度与电机实时状态，含旋转安全警告。完成后自动设为斜坡速度控制。

**控制台 Console** — odrivetool 风格命令：

```
vbus_voltage                                    读取（odrv0. 前缀可省）
axis0.controller.input_vel = 2.5                写入
axis0.requested_state = AXIS_STATE_CLOSED_LOOP_CONTROL   支持枚举名
save_configuration()                            调用函数
dump_errors(odrv0)                              汇总所有错误并中文解码
help                                            查看用法
```

↑/↓ 可翻查历史命令。

**操作历史 History** — 所有参数修改、命令、动作按时间列出，可逐条撤销；
另一个标签是带时间戳的历史错误日志。

### 6. 配置预设（快照）

左下 **预设 Presets**：
- **保存快照** — 可只保存指定类别（如仅电机参数），也可保存整机配置
- **对比** — 列出预设值与设备当前值的差异
- **应用** — 只写入有差异的参数，跳过相同项
- **导入/导出 JSON** — 预设文件携带固件版本标记，跨大版本应用需显式确认

### 7. 键盘快捷键

| 快捷键 | 功能 |
|---|---|
| `Esc` | **紧急停止**（所有轴立即 IDLE） |
| `Alt` + `C` | 连接 / 断开 |
| `Alt` + `1` / `2` | 切换到轴 0 / 轴 1 |
| `Ctrl` + `Z` | 撤销最近一次参数修改 |

### 8. 常见问题 Troubleshooting

| 现象 | 原因与处理 |
|---|---|
| 双击后浏览器显示"无法访问此网站" | 服务还没起好。程序会等就绪后自动开浏览器，**请勿重复双击**；首次运行被 Defender 扫描可能多等 30 秒 |
| 程序启动很慢 | 用 zip 版（解压即用，约 2 秒）；单文件便携版每次要解包 10–20 秒 |
| 端口被占用 | 程序自动顺延到下一个可用端口，看控制台窗口提示的实际地址 |
| 扫描不到设备 | 确认已装 `odrive` 库与 USB 驱动；检查线缆与供电；UART 模式确认波特率与 ASCII 协议 |
| 无法进入闭环 | 该轴未校准（仪表盘会高亮提示），先跑一次校准向导 |
| 参数改了但断电丢失 | 参数写入只改 RAM，需点顶栏 **保存配置 Save** 写入 Flash |
| 电机振荡/啸叫 | `vel_gain` 过大，按 30% 步进调小；可配合实时图表观察 |
| 界面文字被遮挡 | 窗口过窄时顶栏会自动换行；左侧面板可拖拽分隔条调宽，双击复位 |

---

## 项目结构 Layout

```
odrive-gui/
├── backend/
│   ├── run.py                  # 启动入口 (--mock 模拟模式)
│   ├── run_packaged.py         # 独立可执行文件入口
│   ├── requirements.txt        # 核心依赖 (fastapi/uvicorn)
│   ├── requirements-hardware.txt
│   └── app/
│       ├── main.py             # FastAPI 路由 + WebSocket
│       ├── safety.py           # 硬性安全钳位（电流/电压）
│       ├── presets.py          # 配置预设快照管理
│       ├── console.py          # odrivetool 风格命令解析
│       ├── telemetry.py        # 遥测中心/错误监视/CSV 记录
│       ├── errors_zh.py        # 错误代码中文解读
│       ├── firmware/           # v0_5.json / v0_6.json 参数定义（纯数据，可扩充）
│       └── device/
│           ├── base.py         # 设备抽象接口
│           ├── mock.py         # 模拟器（物理仿真 + 故障注入）
│           ├── real.py         # USB(fibre) / UART(ASCII) / CAN(CANSimple)
│           └── manager.py      # 扫描/连接/断线检测
├── frontend/                   # Vue 3 (vendored ESM, 免构建)
│   ├── index.html
│   ├── vendor/                 # vue / uPlot（本地化，无 CDN 依赖）
│   ├── src/                    # store / ws / 组件
│   ├── package.json            # npm run dev / mock_dev (Vite 开发服务器)
│   └── scripts/dev.js          # 一键拉起后端+前端
├── scripts/build_release.py    # PyInstaller 打包
├── install.bat / install.sh
└── data/                       # 运行时数据（预设/错误日志/记录 CSV，自动创建）
```

## 架构说明 Architecture

- **后端** Python + FastAPI：REST 处理参数读写/预设/校准/控制台；单一 WebSocket
  (`/ws`) 下发遥测与事件（错误、状态变化、连接丢失）。所有参数写入强制经过
  `safety.py` 硬钳位（相电流峰值 120A/电机；电压阈值按 24V/56V 版本 8–26/8–56V）。
- **前端** Vue 3 + uPlot：vendored ESM 免构建，可由后端直接静态托管（独立应用同款
  路径），也可经 Vite 开发服务器（端口 3000，代理 `/api` 与 `/ws`）。
- **固件适配**：连接后读取固件版本，动态加载 `firmware/v0_5.json` 或 `v0_6.json`
  参数定义（名称/类型/范围/中文帮助/文档链接均为数据驱动，可直接编辑扩充）。
- **模拟器**：`--mock` 启动时内置两台模拟设备（SIM-000001: v0.5.11/24V，
  SIM-000002: v0.6.8/56V），含完整校准序列、三种控制模式的动力学仿真、温度模型，
  以及通信中断/轴错误/欠压/过温故障注入。

## 安全机制 Safety

1. **电流硬上限**：任何途径（参数面板/控制台/预设）写入电流限制均被钳位到 ≤120A。
2. **电压保护**：过压/欠压阈值可编程，范围按硬件版本自适应；欠压阈值建议设为电池
   安全放电下限以防过放。
3. **温度保护**：MOSFET/电机温度 ≥60°C 黄色警告，≥80°C 红色告警。
4. **制动电阻**：提供配置入口并提示正确连接（AUX 端子）；启用需保存并重启。
5. **紧急停止**：顶栏红色 E-STOP 按钮 / Esc 快捷键，一键全轴 IDLE。
6. **预设版本防护**：预设文件携带固件版本标记，跨版本应用需显式强制确认。
7. **看门狗**：可启用轴看门狗，通信中断自动停机。

## 扩展 Extensibility

- **参数定义**：编辑 `backend/app/firmware/*.json` 即可增删参数条目/分组/帮助文本。
- **脚本/API**：后端 REST + WebSocket 即公开 API，可直接编写 Python/JS 自动化脚本
  （见 `/docs` 自动生成的 OpenAPI 文档，FastAPI 内置 `http://127.0.0.1:8000/docs`）。

---

## 许可证 License

本项目采用 **MIT License** 开源，详见 [LICENSE](LICENSE)。

简单说：可自由使用、修改、分发、商用，只需保留版权声明与许可声明；
软件按「原样」提供，不附带任何担保。

## 免责声明 Disclaimer

本软件用于控制无刷电机驱动器，操作不当可能导致设备损坏或人身伤害。
使用前请确认电机固定牢靠、负载安全、人员远离旋转部件。
作者不对使用本软件造成的任何损失负责。

## 相关链接 Links

- [ODrive 官方文档](https://docs.odriverobotics.com/)
- [ODrive 官方仓库](https://github.com/odriverobotics/ODrive)
