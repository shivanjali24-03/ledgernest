import { describe, expect, it } from 'vitest';
import { describeUserAgent } from './index.js';

describe('Describing a device', () => {
  it('names the browser and system people would call it', () => {
    expect(describeUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36')).toEqual({ browser: 'Chrome', os: 'Windows', mobile: false });
    expect(describeUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0')).toMatchObject({ browser: 'Edge' });
    expect(describeUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1')).toEqual({ browser: 'Safari', os: 'iPhone', mobile: true });
    expect(describeUserAgent('Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36')).toEqual({ browser: 'Samsung Internet', os: 'Android', mobile: true });
    expect(describeUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:131.0) Gecko/20100101 Firefox/131.0')).toEqual({ browser: 'Firefox', os: 'macOS', mobile: false });
    expect(describeUserAgent('curl/8.4.0')).toEqual({ browser: null, os: null, mobile: false });
    expect(describeUserAgent(null)).toEqual({ browser: null, os: null, mobile: false });
  });
});
