import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ToastProvider from '../ui/ToastProvider';
import { ReceiveDialog } from './pages/PurchaseOrderEditor';
import type { PurchaseOrder, PurchaseOrdersApi } from './types';

const order = {
  id: 'po-1',
  number: 'PO-0004',
  orderDate: '2026-06-01',
  currency: null,
  lines: [
    { id: 'l-1', description: 'Paint', toReceive: '5', item: { id: 'i-1', name: 'Paint', unit: 'LTR', trackStock: true, trackBatches: true } },
    { id: 'l-2', description: 'Drill', toReceive: '2', item: { id: 'i-2', name: 'Drill', unit: 'NOS', trackStock: true, trackSerials: true } },
  ],
} as unknown as PurchaseOrder;

describe('Goods receipt dialog', () => {
  it('takes the batch and the serial numbers of what came, and says it is owed till the bill', { timeout: 20_000 }, async () => {
    const receive = vi.fn(async () => ({ ...order, receipts: [{ number: 'GRN-0001' }] }) as unknown as PurchaseOrder);
    const onClose = vi.fn();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ToastProvider>
          <ReceiveDialog order={order} api={{ receive } as unknown as PurchaseOrdersApi} onClose={onClose} />
        </ToastProvider>
      </QueryClientProvider>,
    );
    const dialog = await screen.findByRole('dialog', {}, { timeout: 4000 });
    expect(within(dialog).getByText(/owed as goods received not yet billed/)).toBeInTheDocument();
    const date = within(dialog).getByLabelText('Received on');
    await userEvent.clear(date);
    await userEvent.type(date, '2026-06-06');
    await userEvent.type(within(dialog).getByLabelText('Batch of Paint'), 'P-77');
    await userEvent.type(within(dialog).getByLabelText('Serial numbers of Drill'), 'D1, D2');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record receipt' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(receive).toHaveBeenCalledWith('po-1', {
      date: '2026-06-06',
      reference: '',
      lines: [
        { lineId: 'l-1', quantity: '5', batchNo: 'P-77', expiryDate: null },
        { lineId: 'l-2', quantity: '2', serials: ['D1', 'D2'] },
      ],
    });
  });
});
