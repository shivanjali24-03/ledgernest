import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ToastProvider from '../ui/ToastProvider';
import { SessionContext, type Session } from '../layout/session';
import ChallanGoods from './ChallanGoods';
import type { Quote, QuotesApi } from './types';

const session = { mode: 'live', name: 'Asha', email: 'asha@example.com', organization: 'Nest', organizationId: 'o-1', role: 'owner', permissions: new Set(), signOut: async () => {} } as unknown as Session;
const challan = (goods: Quote['goods']) =>
  ({
    id: 'q-1',
    kind: 'delivery_challan',
    purpose: 'job_work',
    number: 'DC-0003',
    status: 'sent',
    quoteDate: '2026-06-05',
    goods,
    lines: [
      { id: 'l-1', description: 'Pump', quantity: '2', item: { id: 'i-1', name: 'Pump', trackStock: true, trackSerials: false } },
      { id: 'l-2', description: 'Phone X', quantity: '1', item: { id: 'i-2', name: 'Phone X', trackStock: true, trackSerials: true } },
    ],
  }) as unknown as Quote;

const show = (q: Quote, api: Partial<QuotesApi>) => {
  const onChanged = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SessionContext.Provider value={session}>
        <ToastProvider>
          <ChallanGoods quote={q} api={api as QuotesApi} canManage errorMessage={() => 'nope'} onChanged={onChanged} />
        </ToastProvider>
      </SessionContext.Provider>
    </QueryClientProvider>,
  );
  return onChanged;
};

describe('Challan goods', () => {
  it('sends the goods with the serial numbers of the units', { timeout: 20_000 }, async () => {
    const sent = challan({ dispatchedAt: '2026-06-06', backAt: null, backReason: null, jobWorkDue: '2027-06-06' });
    const dispatch = vi.fn(async () => sent);
    const onChanged = show(challan({ dispatchedAt: null, backAt: null, backReason: null, jobWorkDue: null }), { dispatch });
    expect(screen.getByText(/haven’t left yet/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Goods sent' }));
    const dialog = await screen.findByRole('dialog', { name: 'Send the goods on DC-0003' });
    const date = within(dialog).getByLabelText('Date');
    await userEvent.clear(date);
    await userEvent.type(date, '2026-06-06');
    await userEvent.type(within(dialog).getByLabelText('Serial numbers of Phone X (1)'), 'imei-7');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Goods sent' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(sent));
    expect(dispatch).toHaveBeenCalledWith('q-1', { date: '2026-06-06', lines: [{ quoteLineId: 'l-2', serials: ['imei-7'] }] });
  });

  it('shows goods out for job work with the date they’re due back, and records them coming back', { timeout: 20_000 }, async () => {
    const goodsBack = vi.fn(async () => challan({ dispatchedAt: '2026-06-06', backAt: '2026-07-01', backReason: 'returned', jobWorkDue: null }));
    show(challan({ dispatchedAt: '2026-06-06', backAt: null, backReason: null, jobWorkDue: '2027-06-06' }), { goodsBack });
    expect(screen.getByText(/due back by/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Goods sent' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Goods came back' }));
    const dialog = await screen.findByRole('dialog', { name: 'Goods back on DC-0003' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Goods came back' }));
    await waitFor(() => expect(goodsBack).toHaveBeenCalled());
  });
});
