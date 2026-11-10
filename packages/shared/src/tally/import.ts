import type { AccountType } from '../accounts/index.js';

/**
 * Moving from Tally: the "List of Accounts" exported from Tally as XML (groups and ledgers) turned into what
 * LedgerNest imports: accounts for ordinary ledgers, customers and vendors for Sundry Debtors and Creditors (with GSTIN,
 * address, phone, email, state and credit days), and the opening balances. Party balances go to the Debtors and
 * Creditors accounts as totals. Nothing is saved here; the plan goes through the usual checked imports.
 */

export interface TallyMasterLedger {
  name: string;
  parent: string;
  /** Paise, debit positive (Tally writes debits as negative) */
  opening: number;
  gstin: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  state: string | null;
  pincode: string | null;
  creditDays: number | null;
}

export interface TallyMasters {
  groups: Map<string, string>;
  ledgers: TallyMasterLedger[];
}

const ENTITY: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (s: string) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&(amp|lt|gt|quot|apos);/g, (_, e: string) => ENTITY[e]!)
    // Tally writes control characters as &#4; and the like: drop them
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .trim();
const tag = (block: string, name: string) => {
  const m = new RegExp(`<${name.replace('.', '\\.')}(?:\\s[^>]*)?>([\\s\\S]*?)</${name.replace('.', '\\.')}>`, 'i').exec(block);
  return m ? decode(m[1]!) || null : null;
};
const all = (block: string, name: string) => [...block.matchAll(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'gi'))].map((m) => decode(m[1]!)).filter(Boolean);
const attrName = (open: string) => {
  const m = /\bNAME="([^"]*)"/i.exec(open);
  return m ? decode(m[1]!) : null;
};

/** Paise from Tally's "-12,345.50" style amounts (which may carry a currency symbol), debits positive */
export function tallyAmount(s: string | null): number {
  if (!s) return 0;
  const m = /-?\s*[\d,]+(\.\d+)?/.exec(s.replace(/₹|Rs\.?/gi, ''));
  if (!m) return 0;
  const n = Number(m[0].replace(/[\s,]/g, ''));
  return Number.isFinite(n) ? -Math.round(n * 100) : 0;
}

export function parseTallyXml(xml: string): TallyMasters {
  const groups = new Map<string, string>();
  for (const m of xml.matchAll(/<GROUP\b([^>]*)>([\s\S]*?)<\/GROUP>/gi)) {
    const name = attrName(m[1]!) ?? tag(m[2]!, 'NAME');
    if (name) groups.set(name, tag(m[2]!, 'PARENT') ?? '');
  }
  const ledgers: TallyMasterLedger[] = [];
  for (const m of xml.matchAll(/<LEDGER\b([^>]*)>([\s\S]*?)<\/LEDGER>/gi)) {
    const body = m[2]!;
    const name = attrName(m[1]!) ?? tag(body, 'NAME');
    if (!name) continue;
    const credit = tag(body, 'BILLCREDITPERIOD');
    ledgers.push({
      name,
      parent: tag(body, 'PARENT') ?? '',
      opening: tallyAmount(tag(body, 'OPENINGBALANCE')),
      gstin: (tag(body, 'PARTYGSTIN') ?? tag(body, 'GSTIN'))?.toUpperCase() ?? null,
      email: tag(body, 'EMAIL'),
      phone: tag(body, 'LEDGERMOBILE') ?? tag(body, 'LEDGERPHONE'),
      address: all(body, 'ADDRESS').join(', ') || null,
      state: tag(body, 'LEDSTATENAME') ?? tag(body, 'STATENAME'),
      pincode: tag(body, 'PINCODE'),
      creditDays: credit && /\d+/.test(credit) ? Number(/\d+/.exec(credit)![0]) : null,
    });
  }
  return { groups, ledgers };
}

/** What each of Tally's built-in groups becomes */
const PRIMARY: Record<string, { type: AccountType; subtype: string } | 'customer' | 'vendor'> = {
  'sundry debtors': 'customer',
  'sundry creditors': 'vendor',
  'bank accounts': { type: 'asset', subtype: 'bank' },
  'cash-in-hand': { type: 'asset', subtype: 'cash' },
  'stock-in-hand': { type: 'asset', subtype: 'inventory' },
  'current assets': { type: 'asset', subtype: 'current_asset' },
  'deposits (asset)': { type: 'asset', subtype: 'current_asset' },
  'loans & advances (asset)': { type: 'asset', subtype: 'current_asset' },
  'fixed assets': { type: 'asset', subtype: 'fixed_asset' },
  investments: { type: 'asset', subtype: 'other_asset' },
  'misc. expenses (asset)': { type: 'asset', subtype: 'other_asset' },
  'suspense a/c': { type: 'asset', subtype: 'other_asset' },
  'branch / divisions': { type: 'asset', subtype: 'other_asset' },
  'bank od a/c': { type: 'liability', subtype: 'current_liability' },
  'duties & taxes': { type: 'liability', subtype: 'tax_payable' },
  'current liabilities': { type: 'liability', subtype: 'current_liability' },
  provisions: { type: 'liability', subtype: 'current_liability' },
  'loans (liability)': { type: 'liability', subtype: 'long_term_liability' },
  'secured loans': { type: 'liability', subtype: 'long_term_liability' },
  'unsecured loans': { type: 'liability', subtype: 'long_term_liability' },
  'capital account': { type: 'equity', subtype: 'owner_equity' },
  'reserves & surplus': { type: 'equity', subtype: 'retained_earnings' },
  'sales accounts': { type: 'income', subtype: 'operating_income' },
  'direct incomes': { type: 'income', subtype: 'operating_income' },
  'indirect incomes': { type: 'income', subtype: 'other_income' },
  'purchase accounts': { type: 'expense', subtype: 'cost_of_sales' },
  'direct expenses': { type: 'expense', subtype: 'cost_of_sales' },
  'indirect expenses': { type: 'expense', subtype: 'operating_expense' },
};

/** Up through the user's own groups to one of Tally's built-in ones */
export function tallyPrimary(group: string, groups: Map<string, string>) {
  let g = group;
  for (let i = 0; i < 20 && g; i++) {
    const hit = PRIMARY[g.toLowerCase()];
    if (hit) return hit;
    g = groups.get(g) ?? '';
  }
  return null;
}

export interface ExistingAccount {
  code: string;
  name: string;
  type: string;
  subtype: string;
}

export interface TallyImportPlan {
  accounts: Record<string, string>[];
  contacts: Record<string, string>[];
  openings: Record<string, string>[];
  /** Ledgers already in the chart (by name), used as they are */
  matched: string[];
  skipped: { name: string; reason: 'unknown_group' | 'profit_and_loss' }[];
  totals: { debit: number; credit: number; customers: number; vendors: number };
}

const BASE: Record<AccountType, number> = { asset: 1500, liability: 2500, equity: 3500, income: 4500, expense: 5500 };
const rupees = (paise: number) => (paise / 100).toFixed(2);

export function tallyImportPlan(m: TallyMasters, existing: readonly ExistingAccount[]): TallyImportPlan {
  const used = new Set(existing.map((a) => a.code));
  const byName = new Map(existing.map((a) => [a.name.trim().toLowerCase(), a]));
  const nextCode = (type: AccountType) => {
    let c = BASE[type];
    while (used.has(String(c)) && c < 9999) c++;
    used.add(String(c));
    return String(c);
  };
  const plan: TallyImportPlan = { accounts: [], contacts: [], openings: [], matched: [], skipped: [], totals: { debit: 0, credit: 0, customers: 0, vendors: 0 } };
  const party = { customer: 0, vendor: 0 };
  const opening = (code: string, paise: number) => {
    if (!paise) return;
    plan.openings.push(paise > 0 ? { accountCode: code, debit: rupees(paise) } : { accountCode: code, credit: rupees(-paise) });
    if (paise > 0) plan.totals.debit += paise;
    else plan.totals.credit -= paise;
  };
  for (const l of m.ledgers) {
    if (/^profit\s*&\s*loss a\/c$/i.test(l.name)) {
      plan.skipped.push({ name: l.name, reason: 'profit_and_loss' });
      continue;
    }
    const kind = tallyPrimary(l.parent, m.groups);
    if (!kind) {
      plan.skipped.push({ name: l.name, reason: 'unknown_group' });
      continue;
    }
    if (kind === 'customer' || kind === 'vendor') {
      party[kind] += l.opening;
      plan.totals[kind === 'customer' ? 'customers' : 'vendors'] += 1;
      const indian = !!l.gstin || !!l.state || !!l.pincode;
      plan.contacts.push(
        Object.fromEntries(
          Object.entries({
            name: l.name,
            kind,
            taxId: l.gstin ?? '',
            email: l.email ?? '',
            phone: l.phone ?? '',
            line1: l.address ?? '',
            region: l.state ?? '',
            postalCode: l.pincode ?? '',
            country: indian ? 'IN' : '',
            paymentTermsDays: l.creditDays === null ? '' : String(l.creditDays),
          }).filter(([, v]) => v !== ''),
        ),
      );
      continue;
    }
    const found = byName.get(l.name.trim().toLowerCase());
    let code: string;
    if (found) {
      code = found.code;
      plan.matched.push(l.name);
    } else {
      code = nextCode(kind.type);
      plan.accounts.push({ code, name: l.name.slice(0, 120), type: kind.type, subtype: kind.subtype });
    }
    opening(code, l.opening);
  }
  // Party balances as totals on the Debtors and Creditors accounts (made if there are none)
  for (const [side, subtype, type, name] of [
    ['customer', 'accounts_receivable', 'asset', 'Sundry Debtors'],
    ['vendor', 'accounts_payable', 'liability', 'Sundry Creditors'],
  ] as const) {
    if (!party[side]) continue;
    let code = existing.find((a) => a.subtype === subtype)?.code ?? plan.accounts.find((a) => a.subtype === subtype)?.code;
    if (!code) {
      code = nextCode(type);
      plan.accounts.push({ code, name, type, subtype });
    }
    opening(code, party[side]);
  }
  return plan;
}
