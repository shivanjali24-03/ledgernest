import en from '../i18n/locales/en.json';
import hi from '../i18n/locales/hi.json';
import mr from '../i18n/locales/mr.json';

// The API's source, read as text (generated Prisma code excluded)
const sources = import.meta.glob(['../../../api/src/**/*.ts', '!../../../api/src/generated/**', '!../../../api/src/**/*.spec.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

/** Every action the API writes to an organisation's audit log, read from its source */
function auditedActions(): string[] {
  const found = new Set<string>();
  for (const text of Object.values(sources))
    for (const line of text.split('\n')) if (/action|audit/.test(line)) for (const m of line.matchAll(/'(org\.[a-z_]+\.[a-z_.]+)'/g)) found.add(m[1]!);
  // Permissions that share the shape, not actions
  for (const p of ['org.settings.view', 'org.settings.manage']) found.delete(p);
  return [...found].sort();
}

describe('audit log labels', () => {
  it('names every audited action in each language, so nobody sees a raw key', () => {
    const actions = auditedActions();
    expect(actions.length).toBeGreaterThan(100);
    for (const [lang, d] of [['en', en], ['hi', hi], ['mr', mr]] as const) {
      const labels = (d as { audit: { actions: Record<string, string> } }).audit.actions;
      expect(actions.filter((a) => !labels[a.replace(/\./g, '_')]), lang).toEqual([]);
    }
  });
});
