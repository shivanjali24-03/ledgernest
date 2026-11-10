import type { BalanceConfirmationResponse, ConfirmationSide, ConfirmationStatus } from '@ledgernest/shared';
import { API_URL, ApiError } from '../auth/client';

/** What GET /public/confirmations/:token returns: the balance a party is asked to confirm */
export interface ConfirmationView {
  organization: { name: string; taxId: string | null };
  party: { name: string };
  side: ConfirmationSide;
  asOf: string;
  currency: string;
  balance: number;
  status: ConfirmationStatus;
  theirBalance: number | null;
  note: string | null;
  respondedBy: string | null;
  respondedAt: string | null;
}

export interface ConfirmationSource {
  view: ConfirmationView;
  respond: (input: BalanceConfirmationResponse) => Promise<ConfirmationView>;
  /** The statement behind the balance: where it downloads from (live), or the file (demo) */
  statement: { href: string } | { blob: () => Promise<Blob> };
}

const failed = (res: Response) => new ApiError(res.status === 404 ? 'not_found' : res.status === 409 ? 'conflict' : res.status === 400 ? 'validation' : res.status === 429 ? 'rate_limited' : 'server', res.status);

export async function loadConfirmation(token: string): Promise<ConfirmationSource> {
  if (!/^[A-Za-z0-9_-]{32}$/.test(token)) throw new ApiError('not_found', 404);
  if (!API_URL) {
    const { demoConfirmationSource } = await import('../reports/demoConfirmations');
    const demo = await demoConfirmationSource(token);
    if (!demo) throw new ApiError('not_found', 404);
    return demo;
  }
  const base = `${API_URL}/public/confirmations/${token}`;
  let res: Response;
  try {
    res = await fetch(base, { headers: { Accept: 'application/json' } });
  } catch {
    throw new ApiError('network', 0);
  }
  if (!res.ok) throw failed(res);
  return {
    view: (await res.json()) as ConfirmationView,
    statement: { href: `${base}/statement` },
    respond: async (input) => {
      let r: Response;
      try {
        r = await fetch(base, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
      } catch {
        throw new ApiError('network', 0);
      }
      if (!r.ok) throw failed(r);
      return (await r.json()) as ConfirmationView;
    },
  };
}
