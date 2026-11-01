import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_PORT } from '@impressions/shared';

export interface AppConfig {
  host: string;
  port: number;
  dataDir: string;
  dbPath: string;
  artifactsDir: string;
  webDistDir: string | null;
  logLevel: string;
  prettyLogs: boolean;
  openBrowser: boolean;
  version: string;
}

/** Locate the repository root by walking up to the package.json that declares workspaces. */
function findRepoRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 8; i++) {
    const pkg = path.join(dir, 'package.json');
    if (fs.existsSync(pkg)) {
      try {
        const json = JSON.parse(fs.readFileSync(pkg, 'utf8')) as { workspaces?: unknown };
        if (json.workspaces) return dir;
      } catch {
        /* keep walking */
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

function parseBool(v: string | undefined, fallback: boolean): boolean {
  if (v === undefined || v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const root = findRepoRoot(here);
  const env = process.env;

  const dataDir = path.resolve(overrides.dataDir ?? env.DATA_DIR ?? path.join(root, 'data'));
  const webDist = path.join(root, 'apps', 'web', 'dist');
  let version = '0.0.0';
  try {
    version = (JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { version: string }).version;
  } catch {
    /* ignore */
  }

  const port = Number(env.PORT ?? DEFAULT_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT "${env.PORT}"`);
  }

  return {
    host: env.HOST ?? '127.0.0.1',
    port,
    dataDir,
    dbPath: path.join(dataDir, 'checker.db'),
    artifactsDir: path.join(dataDir, 'artifacts'),
    webDistDir: fs.existsSync(path.join(webDist, 'index.html')) ? webDist : null,
    logLevel: env.LOG_LEVEL ?? 'info',
    prettyLogs: parseBool(env.PRETTY_LOGS, process.stdout.isTTY ?? false),
    openBrowser: parseBool(env.OPEN_BROWSER, false),
    version,
    ...overrides,
  };
}

export function ensureDataDirs(config: AppConfig): void {
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.mkdirSync(config.artifactsDir, { recursive: true });
}
