/**
 * Where someone is signed in, told plainly from the browser's user agent: "Chrome on Windows", "Safari on iPhone".
 * Only for showing people their own sessions; never used to decide anything.
 */
export interface DeviceSummary {
  browser: string | null;
  os: string | null;
  mobile: boolean;
}

const BROWSERS: [RegExp, string][] = [
  [/Edg(e|A|iOS)?\//, 'Edge'],
  [/OPR\/|Opera/, 'Opera'],
  [/SamsungBrowser\//, 'Samsung Internet'],
  [/Firefox\/|FxiOS\//, 'Firefox'],
  [/Chrome\/|CriOS\//, 'Chrome'],
  [/Safari\//, 'Safari'],
];
const SYSTEMS: [RegExp, string][] = [
  [/iPhone/, 'iPhone'],
  [/iPad/, 'iPad'],
  [/Android/, 'Android'],
  [/Windows/, 'Windows'],
  [/Mac OS X|Macintosh/, 'macOS'],
  [/CrOS/, 'ChromeOS'],
  [/Linux/, 'Linux'],
];

export function describeUserAgent(ua: string | null | undefined): DeviceSummary {
  if (!ua) return { browser: null, os: null, mobile: false };
  return {
    browser: BROWSERS.find(([re]) => re.test(ua))?.[1] ?? null,
    os: SYSTEMS.find(([re]) => re.test(ua))?.[1] ?? null,
    mobile: /Mobi|iPhone|Android(?!.*Tablet)/.test(ua),
  };
}
