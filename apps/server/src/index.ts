import { spawn } from 'node:child_process';
import pino from 'pino';
import { buildApp } from './app.js';
import { ensureDataDirs, loadConfig } from './config.js';
import { createContext } from './context.js';

function openInBrowser(url: string): void {
  const cmd = process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '""', url] : [url];
  try {
    spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  } catch {
    /* opening a browser is best-effort */
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  ensureDataDirs(config);
  const logger = pino({
    level: config.logLevel,
    ...(config.prettyLogs ? { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } } : {}),
  });

  const ctx = createContext(config, logger);
  const recovered = ctx.runs.recover();
  if (recovered) logger.warn({ recovered }, 'paused runs that were interrupted by the last shutdown');
  const seeded = ctx.profiles.seedBuiltins();
  if (seeded.created) logger.info({ created: seeded.created }, 'seeded built-in device profiles');
  const purged = ctx.runs.applyRetention();
  if (purged) logger.info({ purged }, 'deleted runs past the retention window');
  setInterval(() => ctx.runs.applyRetention(), 6 * 3600_000).unref();

  const app = await buildApp(ctx, { logger });
  if (!config.webDistDir) logger.warn('UI build not found; run "npm run build" (or use "npm run dev" for development)');

  let stopping = false;
  const stop = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, 'shutting down: pausing active runs');
    const force = setTimeout(() => process.exit(1), 20_000);
    force.unref();
    try {
      await app.close();
      await ctx.close();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGINT', () => void stop('SIGINT'));
  process.on('SIGTERM', () => void stop('SIGTERM'));
  // Windows: Ctrl+Break and console close.
  process.on('SIGBREAK', () => void stop('SIGBREAK'));
  process.on('SIGHUP', () => void stop('SIGHUP'));
  process.on('unhandledRejection', (err) => logger.error({ err }, 'unhandled rejection'));

  try {
    await app.listen({ host: config.host, port: config.port });
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'EADDRINUSE') {
      logger.error(`Port ${config.port} is already in use. Close the other instance or set PORT to a free port.`);
    } else logger.error({ err }, 'failed to start');
    await ctx.close();
    process.exit(1);
  }
  const url = `http://${config.host === '0.0.0.0' ? '127.0.0.1' : config.host}:${config.port}`;
  logger.info(`Redirect & Compatibility Checker is running at ${url}`);
  if (config.openBrowser) openInBrowser(url);
}

void main();
