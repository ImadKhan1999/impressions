import type { BrowserFamily, CatalogDevice, FormFactor, Platform } from '@impressions/shared';

/**
 * Curated hardware catalog. Viewport values are CSS pixels as seen by the page
 * (screen minus browser UI); screen values are the full CSS screen size.
 */

const ANDROID_OS = ['15', '14', '13', '12'];
const ANDROID_OS_OLD = ['13', '12', '11', '10'];
const IOS_LATEST = ['26.1', '18.6', '17.6'];
const IOS_OLDER = ['18.6', '17.6', '16.7'];
const IOS_LEGACY = ['17.6', '16.7', '15.8'];
const WINDOWS_OS = ['11', '10'];
const MACOS_OS = ['26.1', '15.7', '14.7', '13.7'];
const LINUX_OS = ['Ubuntu 24.04', 'Ubuntu 22.04', 'Fedora 42', 'Debian 12'];

const ANDROID_BROWSERS: BrowserFamily[] = ['chrome', 'firefox', 'edge', 'opera'];
const SAMSUNG_BROWSERS: BrowserFamily[] = ['chrome', 'samsung', 'firefox', 'edge', 'opera'];
const IOS_BROWSERS: BrowserFamily[] = ['safari', 'chrome', 'firefox', 'edge'];
const WINDOWS_BROWSERS: BrowserFamily[] = ['chrome', 'edge', 'firefox', 'opera'];
const MAC_BROWSERS: BrowserFamily[] = ['safari', 'chrome', 'firefox', 'edge', 'opera'];
const LINUX_BROWSERS: BrowserFamily[] = ['chrome', 'firefox', 'edge', 'opera'];

interface Spec {
  id: string;
  vendor: string;
  model: string;
  /** Screen CSS size [width, height] in portrait for handhelds. */
  screen: [number, number];
  /** Browser chrome height to subtract for the viewport. */
  chrome?: number;
  dpr: number;
  os?: string[];
  browsers?: BrowserFamily[];
  /** Android model code used by UAs that expose it (Samsung Internet). */
  code?: string;
}

function make(platform: Platform, formFactor: FormFactor, defaults: { os: string[]; browsers: BrowserFamily[]; chrome: number }) {
  return (s: Spec): CatalogDevice & { modelCode?: string } => ({
    id: s.id,
    vendor: s.vendor,
    model: s.model,
    platform,
    formFactor,
    screenWidth: s.screen[0],
    screenHeight: s.screen[1],
    viewportWidth: s.screen[0],
    viewportHeight: s.screen[1] - (s.chrome ?? defaults.chrome),
    deviceScaleFactor: s.dpr,
    osVersions: s.os ?? defaults.os,
    browsers: s.browsers ?? defaults.browsers,
    ...(s.code ? { modelCode: s.code } : {}),
  });
}

const androidPhone = make('android', 'mobile', { os: ANDROID_OS, browsers: ANDROID_BROWSERS, chrome: 76 });
const samsungPhone = make('android', 'mobile', { os: ANDROID_OS, browsers: SAMSUNG_BROWSERS, chrome: 76 });
const androidTablet = make('android', 'tablet', { os: ANDROID_OS, browsers: ANDROID_BROWSERS, chrome: 80 });
const samsungTablet = make('android', 'tablet', { os: ANDROID_OS, browsers: SAMSUNG_BROWSERS, chrome: 80 });
const iphone = make('ios', 'mobile', { os: IOS_LATEST, browsers: IOS_BROWSERS, chrome: 193 });
const ipad = make('ios', 'tablet', { os: IOS_LATEST, browsers: IOS_BROWSERS, chrome: 74 });
const winDesktop = make('windows', 'desktop', { os: WINDOWS_OS, browsers: WINDOWS_BROWSERS, chrome: 133 });
const macDesktop = make('macos', 'desktop', { os: MACOS_OS, browsers: MAC_BROWSERS, chrome: 113 });
const linuxDesktop = make('linux', 'desktop', { os: LINUX_OS, browsers: LINUX_BROWSERS, chrome: 128 });

export type CatalogDeviceWithCode = CatalogDevice & { modelCode?: string };

export const DEVICE_CATALOG: CatalogDeviceWithCode[] = [
  /* ------------------------------ Android phones ------------------------------ */
  androidPhone({ id: 'pixel-9-pro-xl', vendor: 'Google', model: 'Pixel 9 Pro XL', screen: [412, 921], dpr: 3.5, os: ['15', '14'] }),
  androidPhone({ id: 'pixel-9-pro', vendor: 'Google', model: 'Pixel 9 Pro', screen: [410, 914], dpr: 3.12, os: ['15', '14'] }),
  androidPhone({ id: 'pixel-9', vendor: 'Google', model: 'Pixel 9', screen: [412, 923], dpr: 2.625, os: ['15', '14'] }),
  androidPhone({ id: 'pixel-8-pro', vendor: 'Google', model: 'Pixel 8 Pro', screen: [448, 998], dpr: 3, os: ['15', '14'] }),
  androidPhone({ id: 'pixel-8', vendor: 'Google', model: 'Pixel 8', screen: [412, 915], dpr: 2.625, os: ['15', '14'] }),
  androidPhone({ id: 'pixel-8a', vendor: 'Google', model: 'Pixel 8a', screen: [412, 915], dpr: 2.625, os: ['15', '14'] }),
  androidPhone({ id: 'pixel-7-pro', vendor: 'Google', model: 'Pixel 7 Pro', screen: [412, 892], dpr: 3.5, os: ['15', '14', '13'] }),
  androidPhone({ id: 'pixel-7', vendor: 'Google', model: 'Pixel 7', screen: [412, 915], dpr: 2.625, os: ['15', '14', '13'] }),
  androidPhone({ id: 'pixel-7a', vendor: 'Google', model: 'Pixel 7a', screen: [412, 915], dpr: 2.625, os: ['15', '14', '13'] }),
  androidPhone({ id: 'pixel-6', vendor: 'Google', model: 'Pixel 6', screen: [412, 915], dpr: 2.625, os: ['15', '14', '13', '12'] }),
  androidPhone({ id: 'pixel-6a', vendor: 'Google', model: 'Pixel 6a', screen: [412, 915], dpr: 2.625, os: ['15', '14', '13', '12'] }),
  androidPhone({ id: 'pixel-5', vendor: 'Google', model: 'Pixel 5', screen: [393, 851], dpr: 2.75, os: ['14', '13', '12', '11'] }),
  androidPhone({ id: 'pixel-4a', vendor: 'Google', model: 'Pixel 4a', screen: [393, 851], dpr: 2.75, os: ['13', '12', '11', '10'] }),
  samsungPhone({ id: 'galaxy-s25-ultra', vendor: 'Samsung', model: 'Galaxy S25 Ultra', screen: [412, 891], dpr: 3.5, code: 'SM-S938B', os: ['15'] }),
  samsungPhone({ id: 'galaxy-s25', vendor: 'Samsung', model: 'Galaxy S25', screen: [360, 780], dpr: 3, code: 'SM-S931B', os: ['15'] }),
  samsungPhone({ id: 'galaxy-s24-ultra', vendor: 'Samsung', model: 'Galaxy S24 Ultra', screen: [384, 824], dpr: 3.75, code: 'SM-S928B', os: ['15', '14'] }),
  samsungPhone({ id: 'galaxy-s24', vendor: 'Samsung', model: 'Galaxy S24', screen: [360, 780], dpr: 3, code: 'SM-S921B', os: ['15', '14'] }),
  samsungPhone({ id: 'galaxy-s23-ultra', vendor: 'Samsung', model: 'Galaxy S23 Ultra', screen: [384, 824], dpr: 3.75, code: 'SM-S918B', os: ['15', '14', '13'] }),
  samsungPhone({ id: 'galaxy-s23', vendor: 'Samsung', model: 'Galaxy S23', screen: [360, 780], dpr: 3, code: 'SM-S911B', os: ['15', '14', '13'] }),
  samsungPhone({ id: 'galaxy-s22', vendor: 'Samsung', model: 'Galaxy S22', screen: [360, 780], dpr: 3, code: 'SM-S901B', os: ['14', '13', '12'] }),
  samsungPhone({ id: 'galaxy-s21', vendor: 'Samsung', model: 'Galaxy S21', screen: [360, 800], dpr: 3, code: 'SM-G991B', os: ['14', '13', '12', '11'] }),
  samsungPhone({ id: 'galaxy-s20', vendor: 'Samsung', model: 'Galaxy S20', screen: [360, 800], dpr: 4, code: 'SM-G981B', os: ANDROID_OS_OLD }),
  samsungPhone({ id: 'galaxy-a55', vendor: 'Samsung', model: 'Galaxy A55', screen: [384, 854], dpr: 2.8125, code: 'SM-A556B', os: ['15', '14'] }),
  samsungPhone({ id: 'galaxy-a54', vendor: 'Samsung', model: 'Galaxy A54', screen: [384, 854], dpr: 2.8125, code: 'SM-A546B', os: ['15', '14', '13'] }),
  samsungPhone({ id: 'galaxy-a35', vendor: 'Samsung', model: 'Galaxy A35', screen: [384, 854], dpr: 2.8125, code: 'SM-A356B', os: ['15', '14'] }),
  samsungPhone({ id: 'galaxy-a15', vendor: 'Samsung', model: 'Galaxy A15', screen: [384, 854], dpr: 2.8125, code: 'SM-A155F', os: ['15', '14'] }),
  samsungPhone({ id: 'galaxy-a14', vendor: 'Samsung', model: 'Galaxy A14', screen: [412, 915], dpr: 2.625, code: 'SM-A145F', os: ['14', '13'] }),
  samsungPhone({ id: 'galaxy-a12', vendor: 'Samsung', model: 'Galaxy A12', screen: [360, 800], dpr: 2, code: 'SM-A125F', os: ['12', '11', '10'] }),
  samsungPhone({ id: 'galaxy-z-fold6', vendor: 'Samsung', model: 'Galaxy Z Fold6 (folded)', screen: [360, 884], dpr: 3, code: 'SM-F956B', os: ['15', '14'] }),
  samsungPhone({ id: 'galaxy-z-flip6', vendor: 'Samsung', model: 'Galaxy Z Flip6', screen: [412, 1006], dpr: 2.625, code: 'SM-F741B', os: ['15', '14'] }),
  samsungPhone({ id: 'galaxy-z-flip5', vendor: 'Samsung', model: 'Galaxy Z Flip5', screen: [412, 1006], dpr: 2.625, code: 'SM-F731B', os: ['15', '14', '13'] }),
  androidPhone({ id: 'oneplus-13', vendor: 'OnePlus', model: 'OnePlus 13', screen: [412, 916], dpr: 3.5, os: ['15'] }),
  androidPhone({ id: 'oneplus-12', vendor: 'OnePlus', model: 'OnePlus 12', screen: [412, 919], dpr: 3.5, os: ['15', '14'] }),
  androidPhone({ id: 'oneplus-nord-4', vendor: 'OnePlus', model: 'Nord 4', screen: [412, 917], dpr: 2.625, os: ['15', '14'] }),
  androidPhone({ id: 'oneplus-nord-ce3', vendor: 'OnePlus', model: 'Nord CE 3', screen: [412, 915], dpr: 2.625, os: ['14', '13'] }),
  androidPhone({ id: 'xiaomi-14', vendor: 'Xiaomi', model: 'Xiaomi 14', screen: [393, 873], dpr: 3.05, os: ['15', '14'] }),
  androidPhone({ id: 'xiaomi-13t', vendor: 'Xiaomi', model: 'Xiaomi 13T', screen: [393, 873], dpr: 2.75, os: ['14', '13'] }),
  androidPhone({ id: 'redmi-note-13-pro', vendor: 'Xiaomi', model: 'Redmi Note 13 Pro', screen: [393, 873], dpr: 3.05, os: ['14', '13'] }),
  androidPhone({ id: 'redmi-note-12', vendor: 'Xiaomi', model: 'Redmi Note 12', screen: [393, 873], dpr: 2.75, os: ['14', '13', '12'] }),
  androidPhone({ id: 'redmi-13c', vendor: 'Xiaomi', model: 'Redmi 13C', screen: [360, 800], dpr: 2, os: ['14', '13'] }),
  androidPhone({ id: 'poco-x6-pro', vendor: 'Xiaomi', model: 'POCO X6 Pro', screen: [393, 873], dpr: 3.05, os: ['15', '14'] }),
  androidPhone({ id: 'moto-edge-50', vendor: 'Motorola', model: 'Edge 50', screen: [412, 915], dpr: 2.625, os: ['15', '14'] }),
  androidPhone({ id: 'moto-g84', vendor: 'Motorola', model: 'Moto G84', screen: [412, 915], dpr: 2.625, os: ['14', '13'] }),
  androidPhone({ id: 'moto-g-power-2024', vendor: 'Motorola', model: 'Moto G Power (2024)', screen: [412, 915], dpr: 1.75, os: ['15', '14'] }),
  androidPhone({ id: 'moto-e13', vendor: 'Motorola', model: 'Moto E13', screen: [360, 800], dpr: 2, os: ['13', '12'] }),
  androidPhone({ id: 'nothing-phone-2a', vendor: 'Nothing', model: 'Phone (2a)', screen: [412, 915], dpr: 2.625, os: ['15', '14'] }),
  androidPhone({ id: 'nothing-phone-2', vendor: 'Nothing', model: 'Phone (2)', screen: [412, 915], dpr: 2.625, os: ['15', '14', '13'] }),
  androidPhone({ id: 'oppo-find-x8', vendor: 'OPPO', model: 'Find X8', screen: [412, 905], dpr: 3, os: ['15'] }),
  androidPhone({ id: 'oppo-reno-12', vendor: 'OPPO', model: 'Reno12', screen: [412, 915], dpr: 2.625, os: ['15', '14'] }),
  androidPhone({ id: 'vivo-v30', vendor: 'vivo', model: 'V30', screen: [412, 915], dpr: 2.625, os: ['15', '14'] }),
  androidPhone({ id: 'realme-12-pro', vendor: 'realme', model: '12 Pro+', screen: [412, 915], dpr: 2.625, os: ['15', '14'] }),
  androidPhone({ id: 'sony-xperia-1-vi', vendor: 'Sony', model: 'Xperia 1 VI', screen: [384, 853], dpr: 2.8125, os: ['15', '14'] }),
  androidPhone({ id: 'sony-xperia-10-v', vendor: 'Sony', model: 'Xperia 10 V', screen: [360, 840], dpr: 3, os: ['14', '13'] }),
  androidPhone({ id: 'huawei-p30-pro', vendor: 'Huawei', model: 'P30 Pro', screen: [360, 780], dpr: 3, os: ANDROID_OS_OLD }),
  androidPhone({ id: 'nokia-g42', vendor: 'Nokia', model: 'G42 5G', screen: [360, 800], dpr: 2, os: ['14', '13'] }),

  /* ------------------------------ Android tablets ----------------------------- */
  samsungTablet({ id: 'galaxy-tab-s10-ultra', vendor: 'Samsung', model: 'Galaxy Tab S10 Ultra', screen: [924, 1478], dpr: 2, code: 'SM-X920', os: ['15', '14'] }),
  samsungTablet({ id: 'galaxy-tab-s9', vendor: 'Samsung', model: 'Galaxy Tab S9', screen: [800, 1280], dpr: 2, code: 'SM-X710', os: ['15', '14', '13'] }),
  samsungTablet({ id: 'galaxy-tab-s9-fe', vendor: 'Samsung', model: 'Galaxy Tab S9 FE', screen: [800, 1280], dpr: 2, code: 'SM-X510', os: ['15', '14', '13'] }),
  samsungTablet({ id: 'galaxy-tab-a9-plus', vendor: 'Samsung', model: 'Galaxy Tab A9+', screen: [800, 1280], dpr: 1.5, code: 'SM-X210', os: ['15', '14', '13'] }),
  samsungTablet({ id: 'galaxy-tab-a8', vendor: 'Samsung', model: 'Galaxy Tab A8', screen: [800, 1280], dpr: 1.5, code: 'SM-X200', os: ['14', '13', '12', '11'] }),
  androidTablet({ id: 'pixel-tablet', vendor: 'Google', model: 'Pixel Tablet', screen: [800, 1280], dpr: 2, os: ['15', '14', '13'] }),
  androidTablet({ id: 'lenovo-tab-p12', vendor: 'Lenovo', model: 'Tab P12', screen: [900, 1440], dpr: 1.6, os: ['14', '13'] }),
  androidTablet({ id: 'lenovo-tab-m10', vendor: 'Lenovo', model: 'Tab M10 Plus', screen: [800, 1333], dpr: 1.5, os: ['13', '12'] }),
  androidTablet({ id: 'xiaomi-pad-6', vendor: 'Xiaomi', model: 'Pad 6', screen: [900, 1440], dpr: 2, os: ['14', '13'] }),
  androidTablet({ id: 'oneplus-pad', vendor: 'OnePlus', model: 'Pad', screen: [868, 1240], dpr: 2.2, os: ['15', '14', '13'] }),

  /* ------------------------------- iPhone ------------------------------------- */
  iphone({ id: 'iphone-17-pro-max', vendor: 'Apple', model: 'iPhone 17 Pro Max', screen: [440, 956], dpr: 3, os: ['26.1', '26.0'] }),
  iphone({ id: 'iphone-17-pro', vendor: 'Apple', model: 'iPhone 17 Pro', screen: [402, 874], dpr: 3, os: ['26.1', '26.0'] }),
  iphone({ id: 'iphone-17', vendor: 'Apple', model: 'iPhone 17', screen: [402, 874], dpr: 3, os: ['26.1', '26.0'] }),
  iphone({ id: 'iphone-air', vendor: 'Apple', model: 'iPhone Air', screen: [420, 912], dpr: 3, os: ['26.1', '26.0'] }),
  iphone({ id: 'iphone-16-pro-max', vendor: 'Apple', model: 'iPhone 16 Pro Max', screen: [440, 956], dpr: 3, os: ['26.1', '18.6'] }),
  iphone({ id: 'iphone-16-pro', vendor: 'Apple', model: 'iPhone 16 Pro', screen: [402, 874], dpr: 3, os: ['26.1', '18.6'] }),
  iphone({ id: 'iphone-16-plus', vendor: 'Apple', model: 'iPhone 16 Plus', screen: [430, 932], dpr: 3, os: ['26.1', '18.6'] }),
  iphone({ id: 'iphone-16', vendor: 'Apple', model: 'iPhone 16', screen: [393, 852], dpr: 3, os: ['26.1', '18.6'] }),
  iphone({ id: 'iphone-16e', vendor: 'Apple', model: 'iPhone 16e', screen: [390, 844], dpr: 3, os: ['26.1', '18.6'] }),
  iphone({ id: 'iphone-15-pro-max', vendor: 'Apple', model: 'iPhone 15 Pro Max', screen: [430, 932], dpr: 3 }),
  iphone({ id: 'iphone-15-pro', vendor: 'Apple', model: 'iPhone 15 Pro', screen: [393, 852], dpr: 3 }),
  iphone({ id: 'iphone-15', vendor: 'Apple', model: 'iPhone 15', screen: [393, 852], dpr: 3 }),
  iphone({ id: 'iphone-14-pro-max', vendor: 'Apple', model: 'iPhone 14 Pro Max', screen: [430, 932], dpr: 3 }),
  iphone({ id: 'iphone-14', vendor: 'Apple', model: 'iPhone 14', screen: [390, 844], dpr: 3 }),
  iphone({ id: 'iphone-14-plus', vendor: 'Apple', model: 'iPhone 14 Plus', screen: [428, 926], dpr: 3 }),
  iphone({ id: 'iphone-13', vendor: 'Apple', model: 'iPhone 13', screen: [390, 844], dpr: 3, os: IOS_OLDER }),
  iphone({ id: 'iphone-13-mini', vendor: 'Apple', model: 'iPhone 13 mini', screen: [375, 812], dpr: 3, os: IOS_OLDER }),
  iphone({ id: 'iphone-12', vendor: 'Apple', model: 'iPhone 12', screen: [390, 844], dpr: 3, os: IOS_OLDER }),
  iphone({ id: 'iphone-se-3', vendor: 'Apple', model: 'iPhone SE (3rd gen)', screen: [375, 667], chrome: 119, dpr: 2, os: IOS_OLDER }),
  iphone({ id: 'iphone-11', vendor: 'Apple', model: 'iPhone 11', screen: [414, 896], dpr: 2, os: IOS_OLDER }),
  iphone({ id: 'iphone-xr', vendor: 'Apple', model: 'iPhone XR', screen: [414, 896], dpr: 2, os: IOS_LEGACY }),
  iphone({ id: 'iphone-x', vendor: 'Apple', model: 'iPhone X', screen: [375, 812], dpr: 3, os: ['16.7', '15.8'] }),
  iphone({ id: 'iphone-8', vendor: 'Apple', model: 'iPhone 8', screen: [375, 667], chrome: 119, dpr: 2, os: ['16.7', '15.8'] }),

  /* -------------------------------- iPad -------------------------------------- */
  ipad({ id: 'ipad-pro-13-m4', vendor: 'Apple', model: 'iPad Pro 13" (M4)', screen: [1032, 1376], dpr: 2 }),
  ipad({ id: 'ipad-pro-11-m4', vendor: 'Apple', model: 'iPad Pro 11" (M4)', screen: [834, 1210], dpr: 2 }),
  ipad({ id: 'ipad-pro-12-9', vendor: 'Apple', model: 'iPad Pro 12.9"', screen: [1024, 1366], dpr: 2, os: IOS_OLDER }),
  ipad({ id: 'ipad-air-13', vendor: 'Apple', model: 'iPad Air 13"', screen: [1024, 1366], dpr: 2 }),
  ipad({ id: 'ipad-air-11', vendor: 'Apple', model: 'iPad Air 11"', screen: [820, 1180], dpr: 2 }),
  ipad({ id: 'ipad-10', vendor: 'Apple', model: 'iPad (10th gen)', screen: [820, 1180], dpr: 2 }),
  ipad({ id: 'ipad-9', vendor: 'Apple', model: 'iPad (9th gen)', screen: [810, 1080], dpr: 2, os: IOS_OLDER }),
  ipad({ id: 'ipad-mini-7', vendor: 'Apple', model: 'iPad mini (A17 Pro)', screen: [744, 1133], dpr: 2 }),
  ipad({ id: 'ipad-mini-6', vendor: 'Apple', model: 'iPad mini (6th gen)', screen: [744, 1133], dpr: 2, os: IOS_OLDER }),

  /* ------------------------------- Windows ------------------------------------ */
  winDesktop({ id: 'win-desktop-1080p', vendor: 'Generic', model: 'Desktop 1920x1080', screen: [1920, 1080], dpr: 1 }),
  winDesktop({ id: 'win-desktop-1440p', vendor: 'Generic', model: 'Desktop 2560x1440', screen: [2560, 1440], dpr: 1 }),
  winDesktop({ id: 'win-desktop-4k-150', vendor: 'Generic', model: 'Desktop 4K @150%', screen: [2560, 1440], dpr: 1.5 }),
  winDesktop({ id: 'win-desktop-1080p-125', vendor: 'Generic', model: 'Laptop 1080p @125%', screen: [1536, 864], dpr: 1.25 }),
  winDesktop({ id: 'win-laptop-768p', vendor: 'Generic', model: 'Laptop 1366x768', screen: [1366, 768], dpr: 1 }),
  winDesktop({ id: 'win-laptop-900p', vendor: 'Generic', model: 'Laptop 1600x900', screen: [1600, 900], dpr: 1 }),
  winDesktop({ id: 'win-desktop-1440x900', vendor: 'Generic', model: 'Desktop 1440x900', screen: [1440, 900], dpr: 1 }),
  winDesktop({ id: 'win-desktop-ultrawide', vendor: 'Generic', model: 'Ultrawide 3440x1440', screen: [3440, 1440], dpr: 1 }),
  winDesktop({ id: 'surface-pro-11', vendor: 'Microsoft', model: 'Surface Pro 11', screen: [1440, 960], dpr: 2 }),
  winDesktop({ id: 'surface-laptop-7', vendor: 'Microsoft', model: 'Surface Laptop 7', screen: [1536, 1024], dpr: 1.5 }),
  winDesktop({ id: 'dell-xps-13', vendor: 'Dell', model: 'XPS 13', screen: [1280, 800], dpr: 1.5 }),
  winDesktop({ id: 'dell-latitude-5440', vendor: 'Dell', model: 'Latitude 5440', screen: [1536, 864], dpr: 1.25 }),
  winDesktop({ id: 'lenovo-thinkpad-x1', vendor: 'Lenovo', model: 'ThinkPad X1 Carbon', screen: [1280, 800], dpr: 1.5 }),
  winDesktop({ id: 'lenovo-ideapad-5', vendor: 'Lenovo', model: 'IdeaPad 5', screen: [1536, 864], dpr: 1.25 }),
  winDesktop({ id: 'hp-pavilion-15', vendor: 'HP', model: 'Pavilion 15', screen: [1536, 864], dpr: 1.25 }),
  winDesktop({ id: 'hp-elitebook-840', vendor: 'HP', model: 'EliteBook 840', screen: [1536, 960], dpr: 1.25 }),
  winDesktop({ id: 'asus-zenbook-14', vendor: 'ASUS', model: 'Zenbook 14 OLED', screen: [1920, 1200], dpr: 1.5 }),
  winDesktop({ id: 'acer-aspire-5', vendor: 'Acer', model: 'Aspire 5', screen: [1366, 768], dpr: 1 }),

  /* -------------------------------- macOS ------------------------------------- */
  macDesktop({ id: 'macbook-air-13-m3', vendor: 'Apple', model: 'MacBook Air 13" (M3)', screen: [1470, 956], dpr: 2 }),
  macDesktop({ id: 'macbook-air-15-m3', vendor: 'Apple', model: 'MacBook Air 15" (M3)', screen: [1710, 1112], dpr: 2 }),
  macDesktop({ id: 'macbook-air-13-m1', vendor: 'Apple', model: 'MacBook Air 13" (M1)', screen: [1440, 900], dpr: 2, os: ['15.7', '14.7', '13.7', '12.7'] }),
  macDesktop({ id: 'macbook-pro-14', vendor: 'Apple', model: 'MacBook Pro 14"', screen: [1512, 982], dpr: 2 }),
  macDesktop({ id: 'macbook-pro-16', vendor: 'Apple', model: 'MacBook Pro 16"', screen: [1728, 1117], dpr: 2 }),
  macDesktop({ id: 'macbook-pro-13-intel', vendor: 'Apple', model: 'MacBook Pro 13" (Intel)', screen: [1440, 900], dpr: 2, os: ['14.7', '13.7', '12.7'] }),
  macDesktop({ id: 'imac-24', vendor: 'Apple', model: 'iMac 24"', screen: [2240, 1260], dpr: 2 }),
  macDesktop({ id: 'mac-studio-display', vendor: 'Apple', model: 'Studio Display 27"', screen: [2560, 1440], dpr: 2 }),
  macDesktop({ id: 'mac-mini-1080p', vendor: 'Apple', model: 'Mac mini + 1080p display', screen: [1920, 1080], dpr: 1 }),

  /* -------------------------------- Linux ------------------------------------- */
  linuxDesktop({ id: 'linux-desktop-1080p', vendor: 'Generic', model: 'Desktop 1920x1080', screen: [1920, 1080], dpr: 1 }),
  linuxDesktop({ id: 'linux-desktop-1440p', vendor: 'Generic', model: 'Desktop 2560x1440', screen: [2560, 1440], dpr: 1 }),
  linuxDesktop({ id: 'linux-laptop-768p', vendor: 'Generic', model: 'Laptop 1366x768', screen: [1366, 768], dpr: 1 }),
  linuxDesktop({ id: 'framework-13', vendor: 'Framework', model: 'Laptop 13', screen: [1504, 1003], dpr: 1.5 }),
  linuxDesktop({ id: 'thinkpad-t14-linux', vendor: 'Lenovo', model: 'ThinkPad T14', screen: [1920, 1200], dpr: 1 }),
  linuxDesktop({ id: 'system76-lemur', vendor: 'System76', model: 'Lemur Pro', screen: [1920, 1080], dpr: 1 }),
  linuxDesktop({ id: 'dell-xps-13-linux', vendor: 'Dell', model: 'XPS 13 Developer Edition', screen: [1280, 800], dpr: 1.5 }),
  linuxDesktop({ id: 'steam-deck-desktop', vendor: 'Valve', model: 'Steam Deck (desktop mode)', screen: [1280, 800], dpr: 1, os: ['SteamOS 3'], browsers: ['chrome', 'firefox'] }),
];

export function findDevice(id: string): CatalogDeviceWithCode | undefined {
  return DEVICE_CATALOG.find((d) => d.id === id);
}
