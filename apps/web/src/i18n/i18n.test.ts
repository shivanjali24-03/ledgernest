import i18n, { LANGUAGES, RESOURCES, languageInfo } from '.';

type Tree = { [key: string]: string | Tree };

/** Flatten nested JSON into { 'a.b.c': 'text' } */
function flatten(obj: Tree, prefix = ''): Record<string, string> {
  return Object.entries(obj).reduce<Record<string, string>>((acc, [k, v]) => {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') acc[key] = v;
    else Object.assign(acc, flatten(v, key));
    return acc;
  }, {});
}

const placeholders = (s: string) => [...s.matchAll(/{{\s*(\w+)\s*}}/g)].map((m) => m[1]).sort();
const english = flatten(RESOURCES.en as Tree);

describe('translations', () => {
  it.each(LANGUAGES.map((l) => l.code))('%s has exactly the same keys as English', (code) => {
    const t = flatten(RESOURCES[code] as Tree);
    expect(Object.keys(t).sort()).toEqual(Object.keys(english).sort());
  });

  it.each(LANGUAGES.map((l) => l.code))('%s has no empty strings and keeps every {{placeholder}}', (code) => {
    const t = flatten(RESOURCES[code] as Tree);
    for (const [key, text] of Object.entries(t)) {
      expect(text.trim(), `${code}: ${key} is empty`).not.toBe('');
      expect(placeholders(text), `${code}: ${key} placeholders`).toEqual(placeholders(english[key]!));
    }
  });
});

describe('language switching', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('switches text and keeps <html lang> in sync', async () => {
    await i18n.changeLanguage('hi');
    expect(i18n.t('nav.items.dashboard')).toBe('डैशबोर्ड');
    expect(document.documentElement.lang).toBe('hi');
    expect(document.documentElement.dir).toBe('ltr');
  });

  it('uses right-to-left layout for Arabic', async () => {
    await i18n.changeLanguage('ar');
    expect(document.documentElement.dir).toBe('rtl');
    expect(i18n.t('nav.items.dashboard')).toBe('لوحة التحكم');
  });

  it('fills in placeholders', () => {
    expect(i18n.t('dashboard.greeting', { name: 'Asha' })).toBe('Good to see you, Asha');
  });

  it('maps each language to a formatting locale', () => {
    expect(languageInfo('mr').locale).toBe('mr-IN');
    expect(languageInfo('xx').code).toBe('en');
  });
});
