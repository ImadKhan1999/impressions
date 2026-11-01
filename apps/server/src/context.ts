import type { AppConfig } from './config.js';
import { closeDatabase, openDatabase, type DB } from './db/connection.js';
import { ProfileRepository } from './db/repositories/profiles.js';
import { ProxyRepository } from './db/repositories/proxies.js';
import { RunRepository } from './db/repositories/runs.js';
import { SettingsRepository } from './db/repositories/settings.js';
import { UrlRepository } from './db/repositories/urls.js';
import { BrowserEngine } from './engines/browser/browser-engine.js';
import { BrowserPool } from './engines/browser/browser-pool.js';
import { HttpRedirectEngine } from './engines/http/redirect-engine.js';
import { EventBus } from './events/bus.js';
import { ProfileService } from './profiles/service.js';
import { SecretBox } from './proxies/crypto.js';
import { ProxyService } from './proxies/service.js';
import { DomainLimiter } from './scheduler/domain-limiter.js';
import { RunManager } from './scheduler/run-manager.js';
import { UrlService } from './urls/service.js';

export interface Logger {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

/** Dependency container wiring repositories, services and engines together. */
export interface AppContext {
  config: AppConfig;
  db: DB;
  bus: EventBus;
  repos: {
    profiles: ProfileRepository;
    proxies: ProxyRepository;
    urls: UrlRepository;
    runs: RunRepository;
    settings: SettingsRepository;
  };
  profiles: ProfileService;
  proxies: ProxyService;
  urls: UrlService;
  runs: RunManager;
  pool: BrowserPool;
  close: () => Promise<void>;
}

export function createContext(config: AppConfig, logger: Logger): AppContext {
  const db = openDatabase(config.dbPath);
  const bus = new EventBus();
  const repos = {
    profiles: new ProfileRepository(db),
    proxies: new ProxyRepository(db),
    urls: new UrlRepository(db),
    runs: new RunRepository(db),
    settings: new SettingsRepository(db),
  };
  const app = repos.settings.get();
  const pool = new BrowserPool({
    headless: app.headless,
    maxSessions: app.maxBrowserSessions,
    idleMs: app.browserIdleSeconds * 1000,
    logger,
  });
  const profiles = new ProfileService(repos.profiles, bus);
  const urls = new UrlService(repos.urls, bus);
  // The run manager is created after the proxy service, which needs to ask it about usage.
  let runs: RunManager | null = null;
  const proxies = new ProxyService(repos.proxies, new SecretBox(config.dataDir), bus, (id) => runs?.isProxyInUse(id) ?? false);
  runs = new RunManager({
    runs: repos.runs,
    profiles: repos.profiles,
    profileService: profiles,
    urls: repos.urls,
    proxies,
    settings: repos.settings,
    bus,
    limiter: new DomainLimiter(),
    http: new HttpRedirectEngine(),
    browser: new BrowserEngine({ pool, artifactsDir: config.artifactsDir, strategy: () => repos.settings.get().engineStrategy }),
    logger,
    artifactsDir: config.artifactsDir,
  });

  let closed = false;
  return {
    config,
    db,
    bus,
    repos,
    profiles,
    proxies,
    urls,
    runs,
    pool,
    close: async () => {
      if (closed) return;
      closed = true;
      await runs!.shutdown();
      await pool.shutdown();
      closeDatabase(db);
    },
  };
}
