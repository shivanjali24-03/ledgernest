import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ToastProvider from '../ui/ToastProvider';
import { SessionContext, type Session } from '../layout/session';
import type { Bill } from '../bills/types';
import DebitNoteDialog from './DebitNoteDialog';
import type { DebitNote, DebitNotesApi } from './types';

const bill = {
  id: 'b-1',
  number: 'BILL/2026-27/0007',
  billDate: '2026-06-01',
  currency: null,
  balance: 2_360_000,
  lines: [{ id: 'l-1', description: 'Phone X', quantity: '2', unitPrice: 1_000_000, discount: 0, taxGroup: null, item: { id: 'i-1', name: 'Phone X', trackSerials: true }, serials: ['IMEI-1', 'IMEI-2'] }],
} as unknown as Bill;

const session = { mode: 'live', name: 'Asha', email: 'asha@example.com', organization: 'Nest', organizationId: 'o-1', role: 'owner', permissions: new Set(), signOut: async () => {} } as unknown as Session;

describe('Debit note dialog', () => {
  it('sends goods kept in stock back, the units ticked by serial number', { timeout: 20_000 }, async () => {
    const create = vi.fn(async () => ({ id: 'n-1', number: 'DN/2026-27/0001' }) as DebitNote);
    const api = { creditable: vi.fn(async () => [{ billLineId: 'l-1', quantity: '2', stock: true }]), create } as unknown as DebitNotesApi;
    render(
      <QueryClientProvider client={new QueryClient()}>
        <SessionContext.Provider value={session}>
          <ToastProvider>
            <DebitNoteDialog bill={bill} api={api} onClose={vi.fn()} onDone={vi.fn()} />
          </ToastProvider>
        </SessionContext.Provider>
      </QueryClientProvider>,
    );
    const dialog = await screen.findByRole('dialog', {}, { timeout: 4000 });
    const qty = within(dialog).getByLabelText('Quantity to send back for Phone X');
    await waitFor(() => expect(qty).not.toBeDisabled());
    expect(within(dialog).getByText(/goes back out of stock/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByLabelText('IMEI-2'));
    expect(qty).toHaveValue('1');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Raise debit note' }));
    await waitFor(() => expect(create).toHaveBeenCalled());
    expect((create.mock.calls as unknown as unknown[][])[0]![0]).toMatchObject({ billId: 'b-1', lines: [{ billLineId: 'l-1', quantity: '1', serials: ['IMEI-2'] }] });
  });
});
