import { API_URL, ApiError } from '../auth/client';
import { demoPublicInvoice } from '../invoices/demoInvoicesApi';
import type { PublicInvoice } from './types';

/** An invoice opened from its shared link: the real API without signing in, or the demo's links in this browser */
export interface PublicInvoiceSource {
  view: PublicInvoice;
  /** Where the PDF downloads from (live), or the file itself (demo) */
  pdf: { href: string } | { blob: () => Blob };
  logoUrl: string | null;
}

export async function loadPublicInvoice(token: string): Promise<PublicInvoiceSource> {
  if (!/^[A-Za-z0-9_-]{32}$/.test(token)) throw new ApiError('not_found', 404);
  if (!API_URL) {
    const demo = await demoPublicInvoice(token);
    if (!demo) throw new ApiError('not_found', 404);
    return { view: demo.view, pdf: { blob: demo.pdf }, logoUrl: null };
  }
  const base = `${API_URL}/public/invoices/${token}`;
  let res: Response;
  try {
    res = await fetch(base, { headers: { Accept: 'application/json' } });
  } catch {
    throw new ApiError('network', 0);
  }
  if (!res.ok) throw new ApiError(res.status === 410 ? 'gone' : res.status === 404 ? 'not_found' : res.status === 429 ? 'rate_limited' : 'server', res.status);
  const view = (await res.json()) as PublicInvoice;
  return { view, pdf: { href: `${base}/pdf` }, logoUrl: view.organization.hasLogo ? `${base}/logo` : null };
}
