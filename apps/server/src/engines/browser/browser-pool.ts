import fs from 'node:fs';
import { chromium, firefox, webkit, type Browser, type BrowserContext, type BrowserContextOptions, type BrowserType } from 'playwright';
import type { BrowserEngineName } from '@impressions/shared';
import { Semaphore } from '../../lib/async.js';
import { errorMessage } from '../../lib/errors.js';
import type { PlaywrightProxy } from '../../proxies/agents.js';

const TYPES: Record<BrowserEngineName, BrowserType> = { chromium, firefox, webkit };

interface Entry {
  key: string;
  engine: BrowserEngineName;
  browser: Promise<Browser>;
  contexts: number;
  idleTimer: NodeJS.Timeout | null;
}

export interface PoolLogger {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
}

export interface BrowserPoolOptions {
  headless: boolean;
  maxSessions: number;
  idleMs: number;
  logger?: PoolLogger;
}

/**
 * Bounded pool of live browser sessions.
 *
 * Device profiles are plain data; this pool is the only place browser
 * resources exist. It keeps at most one browser process per (engine, proxy)
 * key, launched lazily and closed when idle, and at most `maxSessions`
 * contexts open at once across every run. Each task gets a fresh, isolated
 * context that is closed as soon as the task ends.
 */
export class BrowserPool {
  private readonly entries = new Map<string, Entry>();
  private readonly sessions: Semaphore;
  private closed = false;

  constructor(private opts: BrowserPoolOptions) {
    this.sessions = new Semaphore(opts.maxSessions);
  }

  configure(o: Partial<Pick<BrowserPoolOptions, 'headless' | 'maxSessions' | 'idleMs'>>): void {
    this.opts = { ...this.opts, ...o };
    if (o.maxSessions) this.sessions.resize(o.maxSessions);
  }

  get status() {
    return {
      open: this.sessions.used,
      max: this.sessions.max,
      browsers: [...this.entries.values()].map((e) => ({ key: e.key, contexts: e.contexts })),
    };
  }

  static installed(): { engine: BrowserEngineName; installed: boolean; executablePath: string | null }[] {
    return (Object.keys(TYPES) as BrowserEngineName[]).map((engine) => {
      let p: string | null = null;
      try {
        p = TYPES[engine].executablePath();
      } catch {
        p = null;
      }
      return { engine, installed: !!p && fs.existsSync(p), executablePath: p };
    });
  }

  private getEntry(engine: BrowserEngineName, proxy: { id: number; value: PlaywrightProxy } | null): Entry {
    const key = `${engine}|${proxy ? `proxy-${proxy.id}` : 'direct'}`;
    const existing = this.entries.get(key);
    if (existing) {
      if (existing.idleTimer) clearTimeout(existing.idleTimer);
      existing.idleTimer = null;
      return existing;
    }
    const entry: Entry = {
      key,
      engine,
      contexts: 0,
      idleTimer: null,
      browser: TYPES[engine]
        .launch({
          headless: this.opts.headless,
          ...(proxy ? { proxy: proxy.value } : {}),
          // Keep Chromium stable on low-memory machines and in containers.
          ...(engine === 'chromium' ? { args: ['--disable-dev-shm-usage'] } : {}),
        })
        .then((b) => {
          b.on('disconnected', () => {
            if (this.entries.get(key) === entry) this.entries.delete(key);
            this.opts.logger?.warn({ key }, 'browser disconnected');
          });
          this.opts.logger?.info({ key }, 'browser launched');
          return b;
        }),
    };
    // A failed launch must not poison the cache.
    entry.browser.catch(() => {
      if (this.entries.get(key) === entry) this.entries.delete(key);
    });
    this.entries.set(key, entry);
    return entry;
  }

  /**
   * Runs `fn` with a fresh context. Waits for a free session slot first, so
   * callers can enqueue any amount of work without opening extra browsers.
   */
  async withContext<T>(
    engine: BrowserEngineName,
    proxy: { id: number; value: PlaywrightProxy } | null,
    options: BrowserContextOptions,
    signal: AbortSignal,
    fn: (ctx: BrowserContext) => Promise<T>,
  ): Promise<T> {
    if (this.closed) throw new Error('Browser pool is shut down');
    const release = await this.sessions.acquire(signal);
    let entry: Entry | null = null;
    let ctx: BrowserContext | null = null;
    const onAbort = () => void ctx?.close().catch(() => undefined);
    try {
      entry = this.getEntry(engine, proxy);
      entry.contexts++;
      const browser = await entry.browser;
      ctx = await browser.newContext(options);
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) onAbort();
      return await fn(ctx);
    } finally {
      signal.removeEventListener('abort', onAbort);
      if (ctx) await ctx.close().catch(() => undefined);
      if (entry) {
        entry.contexts--;
        this.scheduleIdleClose(entry);
      }
      release();
    }
  }

  private scheduleIdleClose(entry: Entry): void {
    if (entry.contexts > 0 || entry.idleTimer) return;
    entry.idleTimer = setTimeout(() => {
      if (entry.contexts > 0) return;
      if (this.entries.get(entry.key) === entry) this.entries.delete(entry.key);
      void entry.browser.then((b) => b.close()).catch(() => undefined);
      this.opts.logger?.info({ key: entry.key }, 'browser closed (idle)');
    }, this.opts.idleMs);
    entry.idleTimer.unref();
  }

  /** Close every browser that uses a given proxy (after the proxy is edited). */
  async closeForProxy(proxyId: number): Promise<void> {
    const keys = [...this.entries.keys()].filter((k) => k.endsWith(`|proxy-${proxyId}`));
    await Promise.all(keys.map((k) => this.closeEntry(k)));
  }

  private async closeEntry(key: string): Promise<void> {
    const e = this.entries.get(key);
    if (!e) return;
    this.entries.delete(key);
    if (e.idleTimer) clearTimeout(e.idleTimer);
    try {
      await (await e.browser).close();
    } catch (err) {
      this.opts.logger?.warn({ key, err: errorMessage(err) }, 'browser close failed');
    }
  }

  async shutdown(): Promise<void> {
    this.closed = true;
    await Promise.all([...this.entries.keys()].map((k) => this.closeEntry(k)));
  }
}
