import html from '../index.html?raw';
import manifestText from '../public/manifest.webmanifest?raw';

// The files in public/, by name
const publicFiles = Object.keys(import.meta.glob('../public/*')).map((p) => p.replace('../public/', ''));

describe('installable app', () => {
  const manifest = JSON.parse(manifestText) as { name: string; start_url: string; scope: string; display: string; icons: { src: string; sizes: string; purpose: string }[] };

  it('opens as an app from where it is hosted, with relative paths that work under any base path', () => {
    expect(manifest).toMatchObject({ name: 'LedgerNest', start_url: './', scope: './', display: 'standalone' });
    for (const i of manifest.icons) expect(i.src.startsWith('/'), i.src).toBe(false);
  });

  it('has the icons phones need, and they exist', () => {
    expect(manifest.icons.map((i) => `${i.sizes} ${i.purpose}`)).toEqual(expect.arrayContaining(['192x192 any', '512x512 any', '512x512 maskable']));
    for (const i of manifest.icons) expect(publicFiles, i.src).toContain(i.src);
    expect(publicFiles).toContain('apple-touch-icon.png');
  });

  it('is linked from the page', () => {
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest" />');
    expect(html).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon.png" />');
  });
});
