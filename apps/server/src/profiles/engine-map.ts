import type { BrowserEngineName, BrowserFamily, EngineStrategy, Platform } from '@impressions/shared';

/**
 * The rendering engine that really powers a browser on a platform.
 * Every iOS browser is required to use WebKit.
 */
export function nativeEngineFor(platform: Platform, browser: BrowserFamily): BrowserEngineName {
  if (platform === 'ios' || browser === 'safari') return 'webkit';
  if (browser === 'firefox') return 'firefox';
  return 'chromium';
}

/** The Playwright engine that will actually execute a profile, given the app's strategy. */
export function executionEngine(profileEngine: BrowserEngineName, strategy: EngineStrategy): BrowserEngineName {
  return strategy === 'chromium-only' ? 'chromium' : profileEngine;
}
