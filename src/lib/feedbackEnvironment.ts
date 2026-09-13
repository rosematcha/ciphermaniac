/**
 * The browser, device, and OS details the feedback form offers to send.
 *
 * Read locally so the visitor can see exactly what would go out; nothing leaves
 * the browser unless they tick the box. Chromium's client hints give real OS
 * and browser versions where they exist. Everywhere else the user-agent string
 * is the fallback, and it lies in known ways (Safari and Firefox freeze macOS
 * at 10.15, and iPadOS claims to be a Mac), which the parsers account for.
 * @module lib/feedbackEnvironment
 */

import type { Environment } from '../../shared/feedback';
import type { Mode } from './theme';

interface UserAgentBrand {
  brand: string;
  version: string;
}

/** The slice of `navigator.userAgentData` we read. Not in TypeScript's DOM lib yet. */
export interface UserAgentData {
  brands: UserAgentBrand[];
  mobile: boolean;
  platform: string;
  getHighEntropyValues(hints: string[]): Promise<{
    platformVersion?: string;
    fullVersionList?: UserAgentBrand[];
    model?: string;
  }>;
}

export interface UserAgentHints {
  brands?: UserAgentBrand[];
  platform?: string;
  platformVersion?: string;
  model?: string;
  mobile?: boolean;
}

export interface EnvironmentInput {
  userAgent: string;
  maxTouchPoints: number;
  hints?: UserAgentHints | undefined;
  screen: { width: number; height: number };
  pixelRatio: number;
  viewport: { width: number; height: number };
  coarsePointer: boolean;
  mode: Mode;
  language: string;
}

const NOT_A_BRAND = /not.?a.?brand/i;

/** Order matters: Edge, Opera, and Samsung all also claim to be Chrome. */
const BROWSER_PATTERNS: [RegExp, string][] = [
  [/Edg(?:e|A|iOS)?\/(\d+)/, 'Edge'],
  [/OPR\/(\d+)/, 'Opera'],
  [/SamsungBrowser\/(\d+)/, 'Samsung Internet'],
  [/(?:Firefox|FxiOS)\/(\d+)/, 'Firefox'],
  [/CriOS\/(\d+)/, 'Chrome'],
  [/Chrome\/(\d+)/, 'Chrome'],
  [/Version\/(\d+(?:\.\d+)?).*Safari/, 'Safari']
];

export function browserFromUserAgent(userAgent: string): string {
  for (const [pattern, name] of BROWSER_PATTERNS) {
    const match = userAgent.match(pattern);
    if (match) {
      return `${name} ${match[1]}`;
    }
  }
  return 'Unknown';
}

/** The first real brand, preferring a named browser over bare Chromium. */
function browserFromHints(brands: UserAgentBrand[] | undefined): string | undefined {
  const real = (brands ?? []).filter(entry => !NOT_A_BRAND.test(entry.brand));
  const brand = real.find(entry => entry.brand !== 'Chromium') ?? real[0];
  return brand ? `${brand.brand.replace(/^Google /, '')} ${brand.version.split('.')[0]}` : undefined;
}

// "Macintosh", not "Mac OS X": an iPhone's string says "like Mac OS X" too.
const isTouchMac = (userAgent: string, maxTouchPoints: number): boolean =>
  /Macintosh/.test(userAgent) && maxTouchPoints > 1;

/** iOS 26 browsers freeze the version they report at 18.6, so that one is a floor, not a fact. */
function describeIos(match: RegExpMatchArray): string {
  const version = `${match[1]}.${match[2]}`;
  return version === '18.6' ? 'iOS 18.6 or later' : `iOS ${version}`;
}

const OS_PATTERNS: [RegExp, (match: RegExpMatchArray) => string][] = [
  [/(?:iPhone|iPad|iPod).*? OS (\d+)[_.](\d+)/, describeIos],
  [/Android (\d+(?:\.\d+)?)/, match => `Android ${match[1]}`],
  [/Windows NT 10/, () => 'Windows 10 or 11'],
  [/Windows/, () => 'Windows'],
  [/CrOS/, () => 'ChromeOS'],
  [/Mac OS X/, () => 'macOS'],
  [/Linux/, () => 'Linux']
];

export function osFromUserAgent(userAgent: string, maxTouchPoints: number): string {
  if (isTouchMac(userAgent, maxTouchPoints)) {
    return 'iPadOS';
  }
  for (const [pattern, describe] of OS_PATTERNS) {
    const match = userAgent.match(pattern);
    if (match) {
      return describe(match);
    }
  }
  return 'Unknown';
}

/**
 * Windows 11 reports platform version 13 or higher; 10 reports below it.
 * Empty without a version, so the caller falls back to the user agent rather
 * than reporting "Windows 10" or "macOS 0.0" for a refused hint.
 */
export function osFromHints(platform: string, version: string): string {
  if (!platform || !version) {
    return '';
  }
  const [major = '0', minor = '0'] = version.split('.');
  if (platform === 'Windows') {
    return Number(major) >= 13 ? 'Windows 11' : 'Windows 10';
  }
  if (platform === 'macOS') {
    return `macOS ${major}.${minor}`;
  }
  return platform === 'Android' ? `Android ${major}` : platform;
}

export function deviceKind(userAgent: string, maxTouchPoints: number, mobileHint?: boolean): string {
  const isPhone = mobileHint === true || /iPhone|iPod/.test(userAgent) || /Android.*Mobile/.test(userAgent);
  if (isPhone) {
    return 'Phone';
  }
  return /iPad|Android/.test(userAgent) || isTouchMac(userAgent, maxTouchPoints) ? 'Tablet' : 'Desktop';
}

function describeOs({ hints, userAgent, maxTouchPoints }: EnvironmentInput): string {
  return osFromHints(hints?.platform ?? '', hints?.platformVersion ?? '') || osFromUserAgent(userAgent, maxTouchPoints);
}

function describeDevice({ hints, userAgent, maxTouchPoints }: EnvironmentInput): string {
  const device = deviceKind(userAgent, maxTouchPoints, hints?.mobile);
  return hints?.model ? `${device} (${hints.model})` : device;
}

export function describeEnvironment(input: EnvironmentInput): Environment {
  return {
    browser: browserFromHints(input.hints?.brands) ?? browserFromUserAgent(input.userAgent),
    os: describeOs(input),
    device: describeDevice(input),
    screen: `${input.screen.width}×${input.screen.height} @${Number(input.pixelRatio.toFixed(2))}x`,
    viewport: `${input.viewport.width}×${input.viewport.height}`,
    input: input.coarsePointer ? 'Touch' : 'Mouse or trackpad',
    mode: input.mode === 'dark' ? 'Dark' : 'Light',
    language: input.language
  };
}

/** High-entropy hints when the browser grants them, the low-entropy ones when it doesn't. */
export async function readHints(data: UserAgentData | undefined): Promise<UserAgentHints | undefined> {
  if (!data) {
    return undefined;
  }
  const base = { platform: data.platform, mobile: data.mobile };
  try {
    const high = await data.getHighEntropyValues(['platformVersion', 'fullVersionList', 'model']);
    return {
      ...base,
      brands: high.fullVersionList ?? data.brands,
      platformVersion: high.platformVersion,
      model: high.model
    };
  } catch {
    return { ...base, brands: data.brands };
  }
}

export async function collectEnvironment(mode: Mode): Promise<Environment> {
  const nav = navigator as Navigator & { userAgentData?: UserAgentData };
  return describeEnvironment({
    userAgent: nav.userAgent,
    maxTouchPoints: nav.maxTouchPoints,
    hints: await readHints(nav.userAgentData),
    screen: { width: screen.width, height: screen.height },
    pixelRatio: devicePixelRatio,
    viewport: { width: innerWidth, height: innerHeight },
    coarsePointer: matchMedia('(pointer: coarse)').matches,
    mode,
    language: nav.language
  });
}
