import { currencyDigits, invoiceRows, invoiceState, pdfTableBytes, todayIn, upiPayUri } from '@ledgernest/shared';
import { API_URL, ApiError } from '../auth/client';

/** What GET /public/customers/:token returns: everything a customer still owes, as they see it */
export interface CustomerAccount {
  organization: { name: string; taxId: string | null; email: string | null; phone: string | null };
  customer: { name: string };
  invoices: { id: string; number: string; issueDate: string; dueDate: string; currency: string; total: number; balance: number; state: string }[];
  totals: { currency: string; balance: number }[];
  overdue: number;
  upi: { upiId: string; amount: number; link: string } | null;
}

export interface CustomerAccountSource {
  view: CustomerAccount;
  /** Each invoice's PDF: where it downloads from (live), or the file itself (demo) */
  pdf: (invoiceId: string) => { href: string } | { blob: () => Promise<Blob> };
}

/** The demo's account links, opened in the same browser */
async function demoAccount(token: string): Promise<CustomerAccountSource | null> {
  const [{ demoCustomerByToken }, { demoInvoiceViews }] = await Promise.all([import('../contacts/demoContactsApi'), import('../invoices/demoInvoicesApi')]);
  const c = demoCustomerByToken(token);
  if (!c) return null;
  let upiId: string | null = null;
  try {
    upiId = (JSON.parse(localStorage.getItem('ledgernest.demo.settings') ?? 'null') as { settings?: { upiId?: string | null } } | null)?.settings?.upiId ?? null;
  } catch {
    /* no saved settings */
  }
  const today = todayIn('Asia/Kolkata');
  const views = (await demoInvoiceViews()).filter((i) => i.contact.id === c.id && i.status === 'issued' && i.balance > 0);
  const invoices = views.map((i) => ({ id: i.id, number: i.number!, issueDate: i.issueDate, dueDate: i.dueDate, currency: i.currency ?? 'INR', total: i.total, balance: i.balance, state: invoiceState({ status: 'issued', total: i.total, amountPaid: i.amountPaid, dueDate: i.dueDate }, today) }));
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
      upi: upiId && inr > 0 ? { upiId, amount: inr, link: upiPayUri({ upiId, name: 'Nest Demo Private Limited', amount: inr, note: rupees.length === 1 ? `Invoice ${rupees[0]!.number}` : `Invoices ${rupees.map((i) => i.number).join(', ')}`, reference: rupees.length === 1 ? rupees[0]!.number : null }) } : null,
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
  return { view: (await res.json()) as CustomerAccount, pdf: (invoiceId) => ({ href: `${base}/invoices/${invoiceId}/pdf` }) };
}
