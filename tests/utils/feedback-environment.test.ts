import test from 'node:test';
import assert from 'node:assert/strict';

import {
  browserFromUserAgent,
  describeEnvironment,
  deviceKind,
  type EnvironmentInput,
  osFromHints,
  osFromUserAgent,
  readHints,
  type UserAgentData
} from '../../src/lib/feedbackEnvironment';

const UA = {
  chromeWindows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.2739.42',
  opera:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 OPR/112.0.0.0',
  firefoxMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:130.0) Gecko/20100101 Firefox/130.0',
  firefoxLinux: 'Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0',
  safariIphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  chromeIphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/128.0.6613.98 Mobile/15E148 Safari/604.1',
  safariIpad:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  samsung:
    'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36',
  androidTablet:
    'Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  chromebook:
    'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  oldWindows: 'Mozilla/5.0 (Windows NT 6.1; Win64; x64; rv:115.0) Gecko/20100101 Firefox/115.0'
};

test('browserFromUserAgent names the browser, not the engine it borrows', () => {
  assert.equal(browserFromUserAgent(UA.chromeWindows), 'Chrome 128');
  assert.equal(browserFromUserAgent(UA.edge), 'Edge 128');
  assert.equal(browserFromUserAgent(UA.opera), 'Opera 112');
  assert.equal(browserFromUserAgent(UA.samsung), 'Samsung Internet 25');
  assert.equal(browserFromUserAgent(UA.firefoxMac), 'Firefox 130');
  assert.equal(browserFromUserAgent(UA.chromeIphone), 'Chrome 128');
  assert.equal(browserFromUserAgent(UA.safariIphone), 'Safari 17.5');
  assert.equal(browserFromUserAgent('curl/8.5.0'), 'Unknown');
});

test('osFromUserAgent reads versions where the string carries them', () => {
  assert.equal(osFromUserAgent(UA.safariIphone, 5), 'iOS 17.5');
  assert.equal(osFromUserAgent(UA.samsung, 5), 'Android 14');
  assert.equal(osFromUserAgent(UA.chromeWindows, 0), 'Windows 10 or 11');
  assert.equal(osFromUserAgent(UA.oldWindows, 0), 'Windows');
  assert.equal(osFromUserAgent(UA.chromebook, 0), 'ChromeOS');
  assert.equal(osFromUserAgent(UA.firefoxLinux, 0), 'Linux');
  assert.equal(osFromUserAgent('curl/8.5.0', 0), 'Unknown');
});

test('osFromUserAgent does not trust the frozen macOS version, and spots an iPad posing as a Mac', () => {
  assert.equal(osFromUserAgent(UA.firefoxMac, 0), 'macOS');
  assert.equal(osFromUserAgent(UA.safariIpad, 5), 'iPadOS');
});

test('osFromUserAgent reports the frozen iOS 18.6 as a floor', () => {
  const frozen = UA.safariIphone.replace('17_5', '18_6');
  assert.equal(osFromUserAgent(frozen, 5), 'iOS 18.6 or later');
  assert.equal(osFromUserAgent(UA.safariIphone.replace('17_5', '18_5'), 5), 'iOS 18.5');
});

test('osFromHints turns client-hint platform versions into marketing names', () => {
  assert.equal(osFromHints('Windows', '15.0.0'), 'Windows 11');
  assert.equal(osFromHints('Windows', '10.0.0'), 'Windows 10');
  assert.equal(osFromHints('macOS', '14.6.1'), 'macOS 14.6');
  assert.equal(osFromHints('Android', '14.0.0'), 'Android 14');
  assert.equal(osFromHints('Chrome OS', '15000.0.0'), 'Chrome OS');
  assert.equal(osFromHints('', ''), '');
});

test('osFromHints gives nothing without a version, rather than a wrong one', () => {
  assert.equal(osFromHints('Windows', ''), '');
  assert.equal(osFromHints('macOS', ''), '');
  // So a refused high-entropy hint falls back to the user agent.
  const described = describeEnvironment({ ...base, userAgent: UA.chromeWindows, hints: { platform: 'Windows' } });
  assert.equal(described.os, 'Windows 10 or 11');
});

test('deviceKind separates phones, tablets, and desktops', () => {
  assert.equal(deviceKind(UA.safariIphone, 5), 'Phone');
  assert.equal(deviceKind(UA.samsung, 5), 'Phone');
  assert.equal(deviceKind(UA.chromeWindows, 0, true), 'Phone');
  assert.equal(deviceKind(UA.androidTablet, 5), 'Tablet');
  assert.equal(deviceKind(UA.safariIpad, 5), 'Tablet');
  assert.equal(deviceKind(UA.firefoxMac, 0), 'Desktop');
});

const base: EnvironmentInput = {
  userAgent: UA.firefoxMac,
  maxTouchPoints: 0,
  screen: { width: 1440, height: 900 },
  pixelRatio: 2,
  viewport: { width: 1280, height: 800 },
  coarsePointer: false,
  mode: 'dark',
  language: 'en-US'
};

test('describeEnvironment falls back to the user agent without hints', () => {
  assert.deepEqual(describeEnvironment(base), {
    browser: 'Firefox 130',
    os: 'macOS',
    device: 'Desktop',
    screen: '1440×900 @2x',
    viewport: '1280×800',
    input: 'Mouse or trackpad',
    mode: 'Dark',
    language: 'en-US'
  });
});

test('describeEnvironment prefers client hints and a named brand over Chromium', () => {
  const described = describeEnvironment({
    ...base,
    userAgent: UA.chromeWindows,
    pixelRatio: 2.625,
    coarsePointer: true,
    mode: 'light',
    hints: {
      brands: [
        { brand: 'Not)A;Brand', version: '99.0.0.0' },
        { brand: 'Chromium', version: '128.0.6613.120' },
        { brand: 'Google Chrome', version: '128.0.6613.120' }
      ],
      platform: 'Android',
      platformVersion: '14.0.0',
      model: 'Pixel 7',
      mobile: true
    }
  });
  assert.equal(described.browser, 'Chrome 128');
  assert.equal(described.os, 'Android 14');
  assert.equal(described.device, 'Phone (Pixel 7)');
  assert.equal(described.screen, '1440×900 @2.63x');
  assert.equal(described.input, 'Touch');
  assert.equal(described.mode, 'Light');
});

test('describeEnvironment reports bare Chromium when that is the only brand', () => {
  const hints = { brands: [{ brand: 'Chromium', version: '128.0.0.0' }], platform: 'Linux' };
  const described = describeEnvironment({ ...base, userAgent: UA.firefoxLinux, hints });
  assert.equal(described.browser, 'Chromium 128');
  assert.equal(described.os, 'Linux');
});

function fakeUserAgentData(highEntropy: () => ReturnType<UserAgentData['getHighEntropyValues']>): UserAgentData {
  return {
    brands: [{ brand: 'Google Chrome', version: '128' }],
    mobile: false,
    platform: 'Windows',
    getHighEntropyValues: highEntropy
  };
}

test('readHints merges high-entropy values when the browser grants them', async () => {
  const hints = await readHints(
    fakeUserAgentData(async () => ({
      platformVersion: '15.0.0',
      fullVersionList: [{ brand: 'Google Chrome', version: '128.0.6613.120' }],
      model: ''
    }))
  );
  assert.deepEqual(hints, {
    platform: 'Windows',
    mobile: false,
    platformVersion: '15.0.0',
    brands: [{ brand: 'Google Chrome', version: '128.0.6613.120' }],
    model: ''
  });
});

test('readHints keeps the low-entropy brands when high-entropy values are refused or missing', async () => {
  const refused = await readHints(fakeUserAgentData(() => Promise.reject(new Error('denied'))));
  assert.deepEqual(refused, {
    platform: 'Windows',
    mobile: false,
    brands: [{ brand: 'Google Chrome', version: '128' }]
  });
  const partial = await readHints(fakeUserAgentData(async () => ({ platformVersion: '10.0.0' })));
  assert.deepEqual(partial?.brands, [{ brand: 'Google Chrome', version: '128' }]);
  assert.equal(await readHints(undefined), undefined);
});
