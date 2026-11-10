import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from '../auth/client';
import EwayBillDialog from './EwayBillDialog';
import type { Invoice, InvoicesApi } from './types';

const invoice = {
  id: 'inv-1',
  number: 'INV/2026-27/0007',
  contact: { id: 'c-1', name: 'Bluewave Clinics' },
  lines: [{ description: 'Dell Latitude 5440', item: { id: 'i-1', name: 'Laptop', hsnSac: '84713010', unit: 'nos' } }, { description: 'Laptop bags', item: null }],
} as unknown as Invoice;

const show = (ewayBill: InvoicesApi['ewayBill']) => {
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <EwayBillDialog invoice={invoice} api={{ ewayBill } as InvoicesApi} onClose={onClose} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return onClose;
};

describe('E-way bill dialog', () => {
  it('sends the transport details typed, the vehicle cleaned up, and saves the file', { timeout: 20_000 }, async () => {
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:json'), revokeObjectURL: vi.fn() });
    const ewayBill = vi.fn(async () => ({ blob: new Blob(['{}']), filename: 'e-way-bill.json' }));
    const onClose = show(ewayBill);
    const dialog = await screen.findByRole('dialog', { name: 'E-way bill for INV/2026-27/0007' }, { timeout: 4000 });
    await userEvent.type(within(dialog).getByLabelText('Distance (km)'), '84a0');
    await userEvent.type(within(dialog).getByLabelText(/^Vehicle number/), 'mh 12 ab 1234');
    await userEvent.type(within(dialog).getByLabelText('Transporter name'), 'VRL Logistics');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Download JSON' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled(), { timeout: 8000 });
    expect(ewayBill).toHaveBeenCalledWith('inv-1', expect.objectContaining({ mode: 'road', distanceKm: 840, vehicleNo: 'MH12AB1234', transporterName: 'VRL Logistics', transporterId: null }));
  });

  it('flags a vehicle number that isn’t one, and lists what the portal would refuse with where to fix it', { timeout: 20_000 }, async () => {
    const ewayBill = vi.fn(async () => {
      throw new ApiError('conflict', 409, undefined, undefined, { reason: 'eway_incomplete', problems: [{ code: 'pin', party: 'buyer' }, { code: 'hsn', line: 2 }] });
    });
    show(ewayBill);
    const dialog = await screen.findByRole('dialog', {}, { timeout: 4000 });
    await userEvent.type(within(dialog).getByLabelText(/^Vehicle number/), '12');
    expect(await within(dialog).findByText('That isn’t a vehicle number, like MH12AB1234.', {}, { timeout: 4000 })).toBeInTheDocument();
    await userEvent.clear(within(dialog).getByLabelText(/^Vehicle number/));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Download JSON' }));
    const alert = await within(dialog).findByRole('alert', {}, { timeout: 8000 });
    expect(within(alert).getByText('The customer’s PIN code is missing or not 6 digits.')).toBeInTheDocument();
    expect(within(alert).getByText(/Line 2 \(Laptop bags\) needs an HSN/)).toBeInTheDocument();
    expect(within(alert).getByRole('link', { name: 'Fix' })).toHaveAttribute('href', '/contacts/c-1');
  });
});
