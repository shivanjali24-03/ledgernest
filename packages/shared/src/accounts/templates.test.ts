import { describe, expect, it } from 'vitest';
import { ACCOUNT_CODE_PATTERN, MAX_ACCOUNT_DEPTH, SYSTEM_ACCOUNTS, SYSTEM_ACCOUNT_NAMES, subtypeBelongsTo } from './index.js';
import { INDUSTRIES, namedTemplate, TEMPLATE_ACCOUNT_NAMES, TEMPLATE_LANGUAGES, templateAccounts } from './templates.js';

describe('industry templates', () => {
  it.each(INDUSTRIES)('%s is a valid chart of accounts', (industry) => {
    const accounts = templateAccounts(industry);
    expect(accounts.length).toBeGreaterThanOrEqual(25);
    const codes = accounts.map((a) => a.code);
    expect(new Set(codes).size, 'codes are unique').toBe(codes.length);
    const systemCodes: string[] = Object.values(SYSTEM_ACCOUNTS).map((s) => s.code);
    for (const a of accounts) {
      expect(a.code, a.code).toMatch(ACCOUNT_CODE_PATTERN);
      expect(systemCodes, `${a.code} clashes with a system account`).not.toContain(a.code);
      expect(subtypeBelongsTo(a.type, a.subtype), `${a.code} sub-type`).toBe(true);
      expect(TEMPLATE_ACCOUNT_NAMES[a.key], `${a.code} has names`).toBeDefined();
      if (a.parent) {
        const p = accounts.find((x) => x.code === a.parent);
        expect(p, `${a.code} parent exists`).toBeDefined();
        expect(p!.type, `${a.code} same type as parent`).toBe(a.type);
      }
      let level = 1;
      for (let at = a; at.parent; at = accounts.find((x) => x.code === at.parent)!) level++;
      expect(level, `${a.code} depth`).toBeLessThanOrEqual(MAX_ACCOUNT_DEPTH);
    }
    for (const type of ['asset', 'liability', 'equity', 'income', 'expense']) expect(accounts.some((a) => a.type === type), `has ${type}`).toBe(true);
  });

  it.each(TEMPLATE_LANGUAGES)('every name exists in %s, and names are unique per template, ignoring case', (lang) => {
    for (const [key, names] of Object.entries(TEMPLATE_ACCOUNT_NAMES)) expect(names[lang]?.trim(), `${key}.${lang}`).toBeTruthy();
    const system = Object.values(SYSTEM_ACCOUNT_NAMES).map((n) => (n[lang] ?? n.en).toLocaleLowerCase());
    for (const industry of INDUSTRIES) {
      const names = namedTemplate(industry, lang).map((a) => a.name.toLocaleLowerCase());
      expect(new Set(names).size, `${industry} names unique in ${lang}`).toBe(names.length);
      for (const n of names) expect(system, `${industry}: "${n}" clashes with a system account`).not.toContain(n);
      expect(names.every((n) => n.length <= 120)).toBe(true);
    }
  });

  it('lists parents before children, named in the organisation language', () => {
    const t = namedTemplate('retail', 'hi-IN');
    const seen = new Set<string>();
    for (const a of t) {
      if (a.parent) expect(seen.has(a.parent)).toBe(true);
      seen.add(a.code);
    }
    expect(namedTemplate('retail', 'ja-JP')[0]!.name).toBe(TEMPLATE_ACCOUNT_NAMES[templateAccounts('retail')[0]!.key]!.en);
  });
});
