#!/usr/bin/env node
// Runs the API server (with reload) and the Vite dev server together, on any OS.
// Open http://127.0.0.1:5173 — Vite forwards /api to the server on port 5310.

import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isWin = process.platform === 'win32';
const color = process.stdout.isTTY && !process.env.NO_COLOR;

// Prefer the npm that launched us (npm_execpath) so no shell is needed on Windows.
const npmCli = process.env.npm_execpath;
const npm = (args) =>
  npmCli && npmCli.endsWith('.js')
    ? { cmd: process.execPath, args: [npmCli, ...args], shell: false }
    : { cmd: isWin ? 'npm.cmd' : 'npm', args, shell: isWin };

const tasks = [
  { name: 'server', code: 35, ...npm(['run', 'dev', '-w', '@impressions/server']), env: { PRETTY_LOGS: '1' } },
  { name: 'web', code: 36, ...npm(['run', 'dev', '-w', '@impressions/web']), env: {} },
];

const children = [];
let exiting = false;

function prefixLines(name, code, stream, out) {
  const tag = color ? `\x1b[${code}m[${name}]\x1b[0m ` : `[${name}] `;
  let buf = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    buf += chunk;
    const lines = buf.split(/\r?\n/);
    buf = lines.pop() ?? '';
    for (const line of lines) out.write(tag + line + '\n');
  });
  stream.on('end', () => buf && out.write(tag + buf + '\n'));
}

function shutdown(code = 0) {
  if (exiting) return;
  exiting = true;
  for (const c of children) {
    if (c.exitCode !== null) continue;
    if (isWin) spawnSync('taskkill', ['/pid', String(c.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    else c.kill('SIGINT');
  }
  setTimeout(() => process.exit(code), 1500).unref();
}

for (const t of tasks) {
  const child = spawn(t.cmd, t.args, {
    cwd: root,
    shell: t.shell,
    env: { ...process.env, FORCE_COLOR: color ? '1' : '0', ...t.env },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  prefixLines(t.name, t.code, child.stdout, process.stdout);
  prefixLines(t.name, t.code, child.stderr, process.stderr);
  child.on('exit', (code) => {
    if (!exiting) {
      console.error(`[${t.name}] exited with code ${code}; stopping`);
      shutdown(code ?? 1);
    }
  });
  children.push(child);
}

console.log('Starting development servers. Open http://127.0.0.1:5173 (Ctrl+C to stop).');
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) process.on(sig, () => shutdown(0));
