import type { QuoteDecisionInput } from '@ledgernest/shared';
import { API_URL, ApiError } from '../auth/client';

/** What GET /public/quotes/:token returns: a quote as its customer sees it */
export interface PublicQuoteView {
  organization: { name: string; taxId: string | null; terms: string | null };
  customer: { name: string };
  number: string;
  quoteDate: string;
  expiryDate: string;
  reference: string | null;
  notes: string | null;
  currency: string;
  lines: { description: string; quantity: string; unitPrice: number; discount: number; amount: number; taxAmount: number }[];
  subtotal: number;
  taxTotal: number;
  total: number;
  status: string;
  state: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
}

export interface PublicQuoteSource {
  view: PublicQuoteView;
  decide: (input: QuoteDecisionInput) => Promise<PublicQuoteView>;
  pdf: { href: string } | { blob: () => Promise<Blob> };
}

const failed = (res: Response) => new ApiError(res.status === 404 ? 'not_found' : res.status === 409 ? 'conflict' : res.status === 400 ? 'validation' : res.status === 429 ? 'rate_limited' : 'server', res.status);

export async function loadPublicQuote(token: string): Promise<PublicQuoteSource> {
  if (!/^[A-Za-z0-9_-]{32}$/.test(token)) throw new ApiError('not_found', 404);
  if (!API_URL) {
    const { demoQuoteByToken, demoDecideQuote, demoQuotePdf } = await import('../quotes/demoQuotesApi');
    const q = await demoQuoteByToken(token);
    if (!q) throw new ApiError('not_found', 404);
    const shape = (x: NonNullable<typeof q>): PublicQuoteView => ({
      organization: { name: 'Nest Demo Private Limited', taxId: '27AAPFN1234C1Z5', terms: null },
      customer: { name: x.contact.name },
      number: x.number,
      quoteDate: x.quoteDate,
      expiryDate: x.expiryDate,
      reference: x.reference,
      notes: x.notes,
      currency: x.currency ?? 'INR',
      lines: x.lines.map((l) => ({ description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, discount: l.discount, amount: l.amount, taxAmount: l.taxAmount })),
      subtotal: x.subtotal,
      taxTotal: x.taxTotal,
      total: x.total,
      status: x.status,
      state: x.state,
      decidedBy: x.decidedBy ?? null,
      decidedAt: x.decidedAt,
      decisionNote: x.decisionNote ?? null,
    });
    return { view: shape(q), decide: async (input) => shape(await demoDecideQuote(token, { response: input.response, name: input.name, note: input.note ?? null })), pdf: { blob: () => demoQuotePdf(q) } };
  }
  const base = `${API_URL}/public/quotes/${token}`;
  let res: Response;
  try {
    res = await fetch(base, { headers: { Accept: 'application/json' } });
  } catch {
    throw new ApiError('network', 0);
  }
  if (!res.ok) throw failed(res);
  return {
    view: (await res.json()) as PublicQuoteView,
    pdf: { href: `${base}/pdf` },
    decide: async (input) => {
      let r: Response;
      try {
        r = await fetch(base, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
      } catch {
        throw new ApiError('network', 0);
      }
      if (!r.ok) throw failed(r);
      return (await r.json()) as PublicQuoteView;
    },
  };
}
