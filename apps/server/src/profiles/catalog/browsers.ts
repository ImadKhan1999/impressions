import type { BrowserFamily, CatalogBrowser, Platform } from '@impressions/shared';

/**
 * Browser release catalog.
 *
 * Versions are listed newest first. Keep these current: bump the `*_LATEST`
 * constants when new stable versions ship. Custom versions can always be
 * entered in the profile editor.
 */
const CHROME_LATEST = 142;
const FIREFOX_LATEST = 145;
const OPERA_LATEST = 124;

const range = (latest: number, count: number) => Array.from({ length: count }, (_, i) => String(latest - i));

export const CHROME_VERSIONS = range(CHROME_LATEST, 12);
export const EDGE_VERSIONS = range(CHROME_LATEST, 12);
export const FIREFOX_VERSIONS = [...range(FIREFOX_LATEST, 10), '140', '128', '115'].filter(
  (v, i, a) => a.indexOf(v) === i,
);
export const OPERA_VERSIONS = range(OPERA_LATEST, 8);

/** Samsung Internet major -> Chromium major it is built on. */
export const SAMSUNG_CHROMIUM: Record<string, string> = {
  '29': '136',
  '28': '130',
  '27': '125',
  '26': '122',
  '25': '121',
  '24': '117',
  '23': '115',
};
export const SAMSUNG_VERSIONS = Object.keys(SAMSUNG_CHROMIUM).sort((a, b) => Number(b) - Number(a));

/** Opera desktop/Android majors track Chromium with a fixed offset. */
export const operaToChromium = (opera: string): string => String(Number.parseInt(opera, 10) + 16);

/**
 * Safari versions are tied to the OS release. iOS/iPadOS and macOS 26 adopted
 * year-based numbering (Safari 26).
 */
export const SAFARI_VERSIONS = ['26.1', '26.0', '18.6', '18.5', '18.1', '17.6', '17.5', '16.6', '15.6'];

export const BROWSER_CATALOG: CatalogBrowser[] = [
  { id: 'chrome', name: 'Google Chrome', versions: CHROME_VERSIONS, platforms: ['android', 'ios', 'windows', 'macos', 'linux'] },
  { id: 'edge', name: 'Microsoft Edge', versions: EDGE_VERSIONS, platforms: ['android', 'ios', 'windows', 'macos', 'linux'] },
  { id: 'firefox', name: 'Mozilla Firefox', versions: FIREFOX_VERSIONS, platforms: ['android', 'ios', 'windows', 'macos', 'linux'] },
  { id: 'safari', name: 'Apple Safari', versions: SAFARI_VERSIONS, platforms: ['ios', 'macos'] },
  { id: 'samsung', name: 'Samsung Internet', versions: SAMSUNG_VERSIONS, platforms: ['android'] },
  { id: 'opera', name: 'Opera', versions: OPERA_VERSIONS, platforms: ['android', 'windows', 'macos', 'linux'] },
];

export const BROWSER_NAMES: Record<BrowserFamily, string> = {
  chrome: 'Chrome',
  edge: 'Edge',
  firefox: 'Firefox',
  safari: 'Safari',
  samsung: 'Samsung Internet',
  opera: 'Opera',
};

export const PLATFORM_NAMES: Record<Platform, string> = {
  android: 'Android',
  ios: 'iOS',
  windows: 'Windows',
  macos: 'macOS',
  linux: 'Linux',
};

export function browserVersions(browser: BrowserFamily): string[] {
  return BROWSER_CATALOG.find((b) => b.id === browser)?.versions ?? [];
}

/**
 * Safari's version follows the OS: iOS 18.1 ships Safari 18.1, macOS 15 ships
 * Safari 18, macOS 14 ships Safari 17, and so on.
 */
export function safariVersionFor(platform: Platform, osVersion: string): string {
  const [majorStr, minorStr = '0'] = osVersion.split('.');
  const major = Number.parseInt(majorStr ?? '0', 10);
  if (platform === 'ios') return `${major}.${minorStr}`;
  // macOS
  if (major >= 26) return `${major}.${minorStr}`;
  const map: Record<number, string> = { 15: '18.6', 14: '17.6', 13: '16.6', 12: '15.6', 11: '14.1' };
  return map[major] ?? '18.6';
}
