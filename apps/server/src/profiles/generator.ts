import type { BrowserFamily, ProfileSource } from '@impressions/shared';
import type { NewProfile } from '../db/repositories/profiles.js';
import { BROWSER_NAMES, PLATFORM_NAMES, browserVersions, safariVersionFor } from './catalog/browsers.js';
import { DEVICE_CATALOG, type CatalogDeviceWithCode } from './catalog/devices.js';
import { nativeEngineFor } from './engine-map.js';
import { buildUserAgent } from './user-agent.js';

export interface ComboOptions {
  locale?: string;
  timezone?: string;
  tags?: string[];
  source?: ProfileSource;
}

export const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, '-')
    .replace(/^-+|-+$/g, '');

const TOUCH_DESKTOPS = /surface|steam-deck/;

/** Browsers a device can realistically run (catalog list, filtered by platform rules). */
export function browsersForDevice(d: CatalogDeviceWithCode): BrowserFamily[] {
  return d.browsers.filter((b) => {
    if (b === 'safari') return d.platform === 'ios' || d.platform === 'macos';
    if (b === 'samsung') return d.platform === 'android';
    if (b === 'opera') return d.platform !== 'ios';
    return true;
  });
}

/** Build one concrete profile from catalog parts. */
export function profileFromParts(
  device: CatalogDeviceWithCode,
  osVersion: string,
  browser: BrowserFamily,
  browserVersion: string,
  opts: ComboOptions = {},
): NewProfile {
  const locale = opts.locale ?? 'en-US';
  const timezone = opts.timezone ?? 'UTC';
  const version = browser === 'safari' ? safariVersionFor(device.platform, osVersion) : browserVersion;
  const ua = buildUserAgent({
    platform: device.platform,
    formFactor: device.formFactor,
    modelCode: device.modelCode ?? null,
    osVersion,
    browser,
    browserVersion: version,
  });
  const osName = device.platform === 'ios' && device.formFactor === 'tablet' ? 'iPadOS' : PLATFORM_NAMES[device.platform];
  const osLabel = device.platform === 'linux' ? osVersion : `${osName} ${osVersion}`;
  const deviceLabel = device.vendor === 'Generic' ? `${PLATFORM_NAMES[device.platform]} ${device.model}` : device.model;
  const variant = locale !== 'en-US' || timezone !== 'UTC' ? `_${locale}_${timezone}` : '';
  const isHandheld = device.formFactor !== 'desktop';

  return {
    slug: slugify(`${device.id}_${osVersion}_${browser}-${version}${variant}`),
    name: `${deviceLabel} · ${BROWSER_NAMES[browser]} ${version} · ${osLabel}`,
    platform: device.platform,
    formFactor: device.formFactor,
    vendor: device.vendor,
    model: device.model,
    osVersion,
    browser,
    browserVersion: version,
    engine: nativeEngineFor(device.platform, browser),
    userAgent: ua.userAgent,
    clientHints: ua.clientHints,
    viewportWidth: device.viewportWidth,
    viewportHeight: device.viewportHeight,
    screenWidth: device.screenWidth,
    screenHeight: device.screenHeight,
    deviceScaleFactor: device.deviceScaleFactor,
    isMobile: isHandheld,
    hasTouch: isHandheld || TOUCH_DESKTOPS.test(device.id),
    locale,
    timezone,
    tags: [...new Set([device.formFactor, device.platform, ...(opts.tags ?? [])])],
    source: opts.source ?? 'generated',
    enabled: true,
  };
}

export interface GenerateOptions extends ComboOptions {
  deviceIds: string[];
  /** Restrict OS versions (only those the device supports are used). Defaults to all of the device's versions. */
  osVersions?: string[];
  browsers: BrowserFamily[];
  browserVersionsPerBrowser: number;
}

/** Expand devices x OS versions x browsers x versions into concrete profiles. */
export function generateProfiles(o: GenerateOptions): { profiles: NewProfile[]; unknownDevices: string[] } {
  const unknownDevices: string[] = [];
  const out = new Map<string, NewProfile>();
  for (const id of o.deviceIds) {
    const device = DEVICE_CATALOG.find((d) => d.id === id);
    if (!device) {
      unknownDevices.push(id);
      continue;
    }
    const osList = o.osVersions?.length
      ? device.osVersions.filter((v) => o.osVersions!.includes(v))
      : device.osVersions;
    const allowed = new Set(browsersForDevice(device));
    for (const os of osList) {
      for (const browser of o.browsers) {
        if (!allowed.has(browser)) continue;
        const versions = browser === 'safari' ? ['auto'] : browserVersions(browser).slice(0, o.browserVersionsPerBrowser);
        for (const v of versions) {
          const p = profileFromParts(device, os, browser, v, o);
          out.set(p.slug, p);
        }
      }
    }
  }
  return { profiles: [...out.values()], unknownDevices };
}

/**
 * The built-in library seeded on first start: every catalog device, its two
 * newest OS versions, every browser it supports, newest two versions
 * (one for Opera; Safari follows the OS).
 */
export function builtinProfiles(): NewProfile[] {
  const out: NewProfile[] = [];
  for (const device of DEVICE_CATALOG) {
    for (const os of device.osVersions.slice(0, 2)) {
      for (const browser of browsersForDevice(device)) {
        const count = browser === 'opera' ? 1 : 2;
        const versions = browser === 'safari' ? ['auto'] : browserVersions(browser).slice(0, count);
        for (const v of versions) out.push(profileFromParts(device, os, browser, v, { source: 'builtin' }));
      }
    }
  }
  // De-duplicate by slug (two OS versions can map to the same Safari version etc.).
  return [...new Map(out.map((p) => [p.slug, p])).values()];
}
