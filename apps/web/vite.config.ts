import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { loadEnv, type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/**
 * A Content-Security-Policy for the built app (GitHub Pages can't send headers, so it goes in a meta tag).
 * Scripts only from this site; network calls only to this site and the API. Not in dev: Vite's dev server
 * needs inline scripts for hot reload.
 */
function contentSecurityPolicy(): Plugin {
  let api = '';
  return {
    name: 'ledgernest-csp',
    apply: 'build',
    configResolved(c) {
      const url = loadEnv(c.mode, process.cwd(), 'VITE_').VITE_API_URL ?? process.env.VITE_API_URL ?? '';
      api = url ? new URL(url).origin : '';
    },
    transformIndexHtml(html) {
      const policy = [
        "default-src 'self'",
        "script-src 'self'",
        // Motion and charts set style attributes
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:" + (api ? ` ${api}` : ''),
        "font-src 'self'",
        "connect-src 'self'" + (api ? ` ${api}` : ''),
        "frame-src 'self' blob:",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ].join('; ');
      return html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`);
    },
  };
}

export default defineConfig({
  // GitHub Pages serves the app from /ledgernest/ (set in CI); local dev uses /
  base: process.env.BASE_PATH || '/',
  plugins: [react(), tailwindcss(), contentSecurityPolicy()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
});
