// 开发模式启动器：同时拉起后端 (venv Python) 与 Vite 开发服务器
//   npm run dev       -> 真实硬件模式
//   npm run mock_dev  -> 模拟设备模式（无需硬件）
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const mock = process.argv.includes('--mock');

function venvPython() {
  const candidates = [
    path.join(root, '.venv', 'Scripts', 'python.exe'), // Windows
    path.join(root, '.venv', 'bin', 'python'),         // Linux / macOS
  ];
  for (const p of candidates) if (existsSync(p)) return p;
  console.warn('[dev] 未找到 .venv，请先运行 install.bat / install.sh。回退到系统 python。');
  return process.platform === 'win32' ? 'python' : 'python3';
}

const backendArgs = [path.join(root, 'backend', 'run.py'), '--port', '8000'];
if (mock) backendArgs.push('--mock');

console.log(`[dev] 启动后端 backend (${mock ? '模拟模式 MOCK' : '真实硬件 REAL'}) ...`);
const backend = spawn(venvPython(), backendArgs, { stdio: 'inherit' });

console.log('[dev] 启动前端 Vite dev server @ http://localhost:3000 ...');
const vite = spawn(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['vite', '--port', '3000'],
  { stdio: 'inherit', cwd: path.join(root, 'frontend'), shell: true },
);

function shutdown() {
  backend.kill();
  vite.kill();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
backend.on('exit', (code) => { if (code !== null && code !== 0) shutdown(); });
