import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ChequeDialog from './ChequeDialog';
import type { Payment, PaymentsApi } from './types';

const payment = { id: 'p-1', number: 'PAY/2026-27/0004', contact: { id: 'c-1', name: 'Sharma Office Supplies' } } as unknown as Payment;

const show = (cheque: PaymentsApi['cheque']) => {
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ChequeDialog payment={payment} api={{ cheque } as PaymentsApi} onClose={onClose} />
    </QueryClientProvider>,
  );
  return onClose;
};

describe('Cheque dialog', () => {
  beforeEach(() => localStorage.removeItem('ledgernest.cheque.alignment'));

  it('prints with the nudges typed, and remembers them for next time', { timeout: 20_000 }, async () => {
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:pdf'), revokeObjectURL: vi.fn() });
    const cheque = vi.fn(async () => ({ blob: new Blob(['%PDF']), filename: 'cheque.pdf' }));
    const onClose = show(cheque);
    const dialog = await screen.findByRole('dialog', { name: 'Cheque for PAY/2026-27/0004' }, { timeout: 4000 });
    const right = within(dialog).getByLabelText('Move right (mm)');
    await userEvent.clear(right);
    await userEvent.type(right, '2.5');
    await userEvent.click(within(dialog).getByLabelText(/A\/c Payee/));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Download cheque PDF' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled(), { timeout: 8000 });
    expect(cheque).toHaveBeenCalledWith('p-1', { offsetX: 2.5, offsetY: 0, crossed: false });
    expect(JSON.parse(localStorage.getItem('ledgernest.cheque.alignment')!)).toEqual({ offsetX: 2.5, offsetY: 0, crossed: false });
  });

  it('starts from what was remembered, and refuses nudges that are too far', { timeout: 20_000 }, async () => {
    localStorage.setItem('ledgernest.cheque.alignment', JSON.stringify({ offsetX: -1, offsetY: 3, crossed: true }));
    show(vi.fn());
    const dialog = await screen.findByRole('dialog', {}, { timeout: 4000 });
    expect(within(dialog).getByLabelText('Move down (mm)')).toHaveValue('3');
    const right = within(dialog).getByLabelText('Move right (mm)');
    expect(right).toHaveValue('-1');
    await userEvent.clear(right);
    await userEvent.type(right, '45');
    // Under load the check can trail the typing: wait for it
    expect(await within(dialog).findByText('Between -30 and 30 mm.', {}, { timeout: 4000 })).toBeInTheDocument();
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Download cheque PDF' })).toBeDisabled());
  });
});
