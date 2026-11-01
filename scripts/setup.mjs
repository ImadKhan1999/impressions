#!/usr/bin/env node
// Cross-platform first-run setup: checks Node.js, prepares the data folder and
// downloads the Playwright browser engines used by browser-mode test runs.
//
//   npm run setup                    install Chromium, Firefox and WebKit
//   npm run setup -- --chromium-only install Chromium only (smaller download)
//   npm run setup -- --skip-browsers only prepare the data folder

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const color = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code, s) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
const ok = (s) => console.log(`${paint(32, '✔')} ${s}`);
const info = (s) => console.log(`${paint(36, '›')} ${s}`);
const fail = (s) => {
  console.error(`${paint(31, '✖')} ${s}`);
  process.exit(1);
};

// 1. Node.js version
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 20 || (major === 20 && minor < 19)) {
  fail(`Node.js ${process.versions.node} is too old. Install Node.js 22 LTS (or at least 20.19) from https://nodejs.org/`);
}
ok(`Node.js ${process.versions.node} on ${process.platform} ${process.arch}`);

// 2. Dependencies installed?
const require = createRequire(path.join(root, 'apps', 'server', 'package.json'));
let playwrightCli;
try {
  playwrightCli = path.join(path.dirname(require.resolve('playwright/package.json')), 'cli.js');
  require.resolve('better-sqlite3');
} catch {
  fail('Dependencies are missing. Run "npm install" in the project folder first.');
}
ok('Dependencies installed');

// 3. Native SQLite module loads (catches architecture mismatches after copying node_modules between machines)
try {
  const Database = require('better-sqlite3');
  new Database(':memory:').close();
  ok('SQLite driver loads');
} catch (err) {
  fail(`The SQLite driver failed to load: ${err.message}\n  Try "npm rebuild better-sqlite3", or delete node_modules and run "npm install" again.`);
}

// 4. Data folder
const dataDir = path.resolve(process.env.DATA_DIR ?? path.join(root, 'data'));
fs.mkdirSync(path.join(dataDir, 'artifacts'), { recursive: true });
ok(`Data folder: ${dataDir}`);

// 5. Browser engines
if (args.has('--skip-browsers')) {
  info('Skipping browser download (--skip-browsers)');
} else {
  const engines = args.has('--chromium-only') ? ['chromium'] : ['chromium', 'firefox', 'webkit'];
  info(`Downloading browser engines: ${engines.join(', ')} (this can take a few minutes the first time)`);
  const r = spawnSync(process.execPath, [playwrightCli, 'install', ...engines], { stdio: 'inherit', cwd: root, windowsHide: true });
  if (r.status !== 0) {
    const linuxHint = process.platform === 'linux' ? '\n  On Linux you may also need system libraries: "npx playwright install-deps".' : '';
    fail(`Browser download failed (exit code ${r.status ?? r.signal}). Check your network or proxy settings and run "npm run setup" again.${linuxHint}`);
  }
  ok('Browser engines installed');
  if (engines.length === 1) info('Only Chromium is installed: set Settings > Engine strategy to "Chromium only" for browser runs.');
}

const built = fs.existsSync(path.join(root, 'apps', 'web', 'dist', 'index.html')) && fs.existsSync(path.join(root, 'apps', 'server', 'dist', 'index.js'));
console.log('');
ok('Setup complete.');
info(built ? 'Start the app with "npm start".' : 'Build once with "npm run build", then start with "npm start". For development use "npm run dev".');
