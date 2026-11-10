import { currencyDigits, fiscalYearOf, fiscalYearSpan, invoiceRows, invoiceState, msmeCovered, statementRows, statementTitle, msmeLateInterest, pdfTableBytes, todayIn, upiPayUri } from '@ledgernest/shared';
import { API_URL, ApiError } from '../auth/client';

/** What GET /public/customers/:token returns: everything a customer still owes, as they see it */
export interface CustomerAccount {
  organization: { name: string; taxId: string | null; email: string | null; phone: string | null };
  customer: { name: string };
  /** msmeInterest: what the business may charge for paying late (MSMED Act s.16), when it is a micro or small enterprise */
  invoices: { id: string; number: string; issueDate: string; dueDate: string; currency: string; total: number; balance: number; state: string; msmeInterest?: number }[];
  totals: { currency: string; balance: number }[];
  overdue: number;
  upi: { upiId: string; amount: number; link: string } | null;
  msme?: { udyamNumber: string | null; interest: number } | null;
}

export interface CustomerAccountSource {
  view: CustomerAccount;
  /** Each invoice's PDF: where it downloads from (live), or the file itself (demo) */
  pdf: (invoiceId: string) => { href: string } | { blob: () => Promise<Blob> };
  /** Their statement of account for the year so far */
  statement: { href: string } | { blob: () => Promise<Blob> };
}

/** The demo's account links, opened in the same browser */
async function demoAccount(token: string): Promise<CustomerAccountSource | null> {
  const [{ demoCustomerByToken }, { demoInvoiceViews }] = await Promise.all([import('../contacts/demoContactsApi'), import('../invoices/demoInvoicesApi')]);
  const c = demoCustomerByToken(token);
  if (!c) return null;
  let upiId: string | null = null;
  let msme: { msmeCategory?: 'micro' | 'small' | 'medium' | null; udyamNumber?: string | null; msmeBankRateBp?: number | null } = {};
  try {
    const saved = (JSON.parse(localStorage.getItem('ledgernest.demo.settings') ?? 'null') as { settings?: { upiId?: string | null } & typeof msme } | null)?.settings;
    upiId = saved?.upiId ?? null;
    msme = saved ?? {};
  } catch {
    /* no saved settings */
  }
  const charges = msmeCovered(msme.msmeCategory) && !!msme.msmeBankRateBp;
  const today = todayIn('Asia/Kolkata');
  const views = (await demoInvoiceViews()).filter((i) => i.contact.id === c.id && i.status === 'issued' && i.balance > 0);
  const invoices = views.map((i) => ({ id: i.id, number: i.number!, issueDate: i.issueDate, dueDate: i.dueDate, currency: i.currency ?? 'INR', total: i.total, balance: i.balance, state: invoiceState({ status: 'issued', total: i.total, amountPaid: i.amountPaid, dueDate: i.dueDate }, today), msmeInterest: charges && !i.currency ? msmeLateInterest(i.balance, i.issueDate, i.dueDate, today, msme.msmeBankRateBp!) : 0 }));
  const totals = [...new Set(invoices.map((i) => i.currency))].map((currency) => ({ currency, balance: invoices.filter((i) => i.currency === currency).reduce((s, i) => s + i.balance, 0) }));
  const rupees = invoices.filter((i) => i.currency === 'INR');
  const inr = rupees.reduce((s, i) => s + i.balance, 0);
  return {
    view: {
      organization: { name: 'Nest Demo Private Limited', taxId: '27AAPFN1234C1Z5', email: 'accounts@nestdemo.in', phone: '+91 20 4000 1234' },
      customer: { name: c.legalName ?? c.name },
      invoices,
      totals,
      overdue: rupees.filter((i) => i.state === 'overdue').reduce((s, i) => s + i.balance, 0),
      msme: charges ? { udyamNumber: msme.udyamNumber ?? null, interest: invoices.reduce((s, i) => s + (i.msmeInterest ?? 0), 0) } : null,
      upi: upiId && inr > 0 ? { upiId, amount: inr, link: upiPayUri({ upiId, name: 'Nest Demo Private Limited', amount: inr, note: rupees.length === 1 ? `Invoice ${rupees[0]!.number}` : `Invoices ${rupees.map((i) => i.number).join(', ')}`, reference: rupees.length === 1 ? rupees[0]!.number : null }) } : null,
    },
    statement: {
      blob: async () => {
        const { createDemoReportsApi } = await import('../reports/demoReportsApi');
        const from = fiscalYearSpan(fiscalYearOf(today, 4), 4).periods[0]!.startDate;
        const s = await createDemoReportsApi(() => true).statement(c.id, 'receivables', from, today);
        return new Blob([pdfTableBytes({ title: `${statementTitle(s.side)}: ${s.contact.name}`, subtitle: `Nest Demo Private Limited · ${s.from} to ${s.to}`, footer: 'Nest Demo Private Limited · LedgerNest', rows: statementRows(s) }).buffer as ArrayBuffer], { type: 'application/pdf' });
      },
    },
    pdf: (invoiceId) => ({
      blob: async () => {
        const v = views.find((i) => i.id === invoiceId)!;
        const cur = v.currency ?? 'INR';
        return new Blob([pdfTableBytes({ title: `Tax invoice ${v.number}`, subtitle: 'Nest Demo Private Limited', info: [`Bill to: ${v.contact.legalName ?? v.contact.name}`, `Invoice date ${v.issueDate} · Due ${v.dueDate}`], footer: `Nest Demo Private Limited · ${v.number}`, rows: invoiceRows({ ...v, currency: cur }, currencyDigits(cur)) }).buffer as ArrayBuffer], { type: 'application/pdf' });
      },
    }),
  };
}

export async function loadCustomerAccount(token: string): Promise<CustomerAccountSource> {
  if (!/^[A-Za-z0-9_-]{32}$/.test(token)) throw new ApiError('not_found', 404);
  if (!API_URL) {
    const demo = await demoAccount(token);
    if (!demo) throw new ApiError('not_found', 404);
    return demo;
  }
  const base = `${API_URL}/public/customers/${token}`;
  let res: Response;
  try {
    res = await fetch(base, { headers: { Accept: 'application/json' } });
  } catch {
    throw new ApiError('network', 0);
  }
  if (!res.ok) throw new ApiError(res.status === 404 ? 'not_found' : res.status === 429 ? 'rate_limited' : 'server', res.status);
  return { view: (await res.json()) as CustomerAccount, pdf: (invoiceId) => ({ href: `${base}/invoices/${invoiceId}/pdf` }), statement: { href: `${base}/statement` } };
}
