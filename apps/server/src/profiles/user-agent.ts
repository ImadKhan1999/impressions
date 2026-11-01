import type { BrowserFamily, FormFactor, Platform } from '@impressions/shared';
import { SAMSUNG_CHROMIUM, operaToChromium, safariVersionFor } from './catalog/browsers.js';

export interface UaInput {
  platform: Platform;
  formFactor: FormFactor;
  /** Android model code (e.g. SM-S921B) used by Samsung Internet. */
  modelCode?: string | null;
  osVersion: string;
  browser: BrowserFamily;
  browserVersion: string;
}

export interface UaOutput {
  userAgent: string;
  /** Low-entropy client hints a Chromium browser sends by default. */
  clientHints: Record<string, string> | null;
}

const major = (v: string) => v.split('.')[0] ?? v;

/** Chromium major version a profile's browser is built on, or null for non-Chromium browsers. */
export function chromiumMajorFor(browser: BrowserFamily, browserVersion: string): string | null {
  switch (browser) {
    case 'chrome':
    case 'edge':
      return major(browserVersion);
    case 'opera':
      return operaToChromium(major(browserVersion));
    case 'samsung':
      return SAMSUNG_CHROMIUM[major(browserVersion)] ?? '130';
    default:
      return null;
  }
}

/** "18.1" -> "18_1"; iOS 26+ Safari freezes the UA OS token at 18_6. */
function iosToken(osVersion: string): string {
  const [maj = '18', min = '0'] = osVersion.split('.');
  if (Number(maj) >= 26) return '18_6';
  return min === '0' ? maj : `${maj}_${min}`;
}

/** Modern browsers freeze the macOS token at 10_15_7 (Firefox uses 10.15). */
const MAC_TOKEN = 'Macintosh; Intel Mac OS X 10_15_7';

/** Android "reduced UA" used by Chromium browsers: Android 10; K. */
const ANDROID_REDUCED = 'Linux; Android 10; K';

function desktopOsToken(platform: Platform): string {
  switch (platform) {
    case 'windows':
      return 'Windows NT 10.0; Win64; x64'; // Windows 10 and 11 report identical tokens
    case 'macos':
      return MAC_TOKEN;
    default:
      return 'X11; Linux x86_64';
  }
}

function chromiumHints(
  brand: string,
  brandMajor: string,
  chromiumMajor: string,
  platform: Platform,
  formFactor: FormFactor,
): Record<string, string> {
  const platformName = { android: 'Android', ios: 'iOS', windows: 'Windows', macos: 'macOS', linux: 'Linux' }[platform];
  const brands = [`"Chromium";v="${chromiumMajor}"`, `"${brand}";v="${brandMajor}"`, `"Not_A Brand";v="99"`];
  const hints: Record<string, string> = {
    'sec-ch-ua': brands.join(', '),
    'sec-ch-ua-mobile': formFactor === 'mobile' ? '?1' : '?0',
    'sec-ch-ua-platform': `"${platformName}"`,
  };
  return hints;
}

export function buildUserAgent(i: UaInput): UaOutput {
  const v = i.browserVersion;
  const isAndroid = i.platform === 'android';
  const isIos = i.platform === 'ios';
  const isTablet = i.formFactor === 'tablet';
  const mobileSuffix = i.formFactor === 'mobile' ? 'Mobile ' : '';

  /* ------------------------------- iOS / iPadOS ------------------------------ */
  if (isIos) {
    const tok = iosToken(i.osVersion);
    const device = isTablet ? `iPad; CPU OS ${tok} like Mac OS X` : `iPhone; CPU iPhone OS ${tok} like Mac OS X`;
    const webkit = 'AppleWebKit/605.1.15 (KHTML, like Gecko)';
    switch (i.browser) {
      case 'safari': {
        const sv = safariVersionFor('ios', i.osVersion);
        // iPadOS Safari requests desktop websites by default and sends a macOS UA.
        if (isTablet) return { userAgent: `Mozilla/5.0 (${MAC_TOKEN}) ${webkit} Version/${sv} Safari/605.1.15`, clientHints: null };
        return { userAgent: `Mozilla/5.0 (${device}) ${webkit} Version/${sv} Mobile/15E148 Safari/604.1`, clientHints: null };
      }
      case 'chrome':
        return { userAgent: `Mozilla/5.0 (${device}) ${webkit} CriOS/${major(v)}.0.0.0 Mobile/15E148 Safari/604.1`, clientHints: null };
      case 'firefox':
        return { userAgent: `Mozilla/5.0 (${device}) ${webkit} FxiOS/${major(v)}.0 Mobile/15E148 Safari/605.1.15`, clientHints: null };
      case 'edge':
        return {
          userAgent: `Mozilla/5.0 (${device}) ${webkit} Version/${safariVersionFor('ios', i.osVersion)} EdgiOS/${major(v)}.0.0.0 Mobile/15E148 Safari/605.1.15`,
          clientHints: null,
        };
      default:
        throw new Error(`${i.browser} is not available on iOS`);
    }
  }

  /* --------------------------------- Firefox --------------------------------- */
  if (i.browser === 'firefox') {
    const fv = `${major(v)}.0`;
    if (isAndroid) {
      return { userAgent: `Mozilla/5.0 (Android ${major(i.osVersion)}; ${isTablet ? 'Tablet' : 'Mobile'}; rv:${fv}) Gecko/${fv} Firefox/${fv}`, clientHints: null };
    }
    let os: string;
    if (i.platform === 'windows') os = 'Windows NT 10.0; Win64; x64';
    else if (i.platform === 'macos') os = 'Macintosh; Intel Mac OS X 10.15';
    else os = /ubuntu/i.test(i.osVersion) ? 'X11; Ubuntu; Linux x86_64' : 'X11; Linux x86_64';
    return { userAgent: `Mozilla/5.0 (${os}; rv:${fv}) Gecko/20100101 Firefox/${fv}`, clientHints: null };
  }

  /* --------------------------------- Safari ---------------------------------- */
  if (i.browser === 'safari') {
    if (i.platform !== 'macos') throw new Error('Safari is only available on macOS and iOS');
    const sv = safariVersionFor('macos', i.osVersion);
    return { userAgent: `Mozilla/5.0 (${MAC_TOKEN}) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/${sv} Safari/605.1.15`, clientHints: null };
  }

  /* ---------------------------- Chromium family ------------------------------ */
  const cm = chromiumMajorFor(i.browser, v);
  if (!cm) throw new Error(`Unsupported browser ${i.browser}`);
  const webkit = 'AppleWebKit/537.36 (KHTML, like Gecko)';
  const os = isAndroid ? ANDROID_REDUCED : desktopOsToken(i.platform);
  const chrome = `Chrome/${cm}.0.0.0`;
  const safari = `${isAndroid ? mobileSuffix : ''}Safari/537.36`;

  switch (i.browser) {
    case 'chrome':
      return {
        userAgent: `Mozilla/5.0 (${os}) ${webkit} ${chrome} ${safari}`,
        clientHints: chromiumHints('Google Chrome', cm, cm, i.platform, i.formFactor),
      };
    case 'edge':
      return {
        userAgent: `Mozilla/5.0 (${os}) ${webkit} ${chrome} ${safari} ${isAndroid ? 'EdgA' : 'Edg'}/${major(v)}.0.0.0`,
        clientHints: chromiumHints('Microsoft Edge', major(v), cm, i.platform, i.formFactor),
      };
    case 'opera':
      return {
        userAgent: `Mozilla/5.0 (${os}) ${webkit} ${chrome} ${safari} OPR/${major(v)}.0.0.0`,
        clientHints: chromiumHints('Opera', major(v), cm, i.platform, i.formFactor),
      };
    case 'samsung': {
      if (!isAndroid) throw new Error('Samsung Internet is only available on Android');
      // Samsung Internet still sends the full Android version and model code.
      const model = i.modelCode ? `SAMSUNG ${i.modelCode}` : 'K';
      const sOs = `Linux; Android ${major(i.osVersion)}; ${model}`;
      return {
        userAgent: `Mozilla/5.0 (${sOs}) ${webkit} SamsungBrowser/${major(v)}.0 ${chrome} ${safari}`,
        clientHints: chromiumHints('Samsung Internet', major(v), cm, i.platform, i.formFactor),
      };
    }
    default:
      throw new Error(`Unsupported browser ${i.browser}`);
  }
}
