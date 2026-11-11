import { vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import AppProviders from '../AppProviders';
import { routes } from '../routes';
import type { ExpiringStock } from './types';

const report = (days: number): ExpiringStock => ({
  asOf: '2026-11-10',
  days,
  rows: [
    { itemId: 'i1', item: 'Paracetamol 500mg', unit: 'TBS', batchId: 'b1', batchNo: 'PX-OLD', mfgDate: null, expiryDate: '2026-11-05', daysLeft: -5, expired: true, onHand: '40', value: 400_00 },
    { itemId: 'i1', item: 'Paracetamol 500mg', unit: 'TBS', batchId: 'b2', batchNo: 'PX-SOON', mfgDate: '2025-12-01', expiryDate: '2026-11-30', daysLeft: 20, expired: false, onHand: '100', value: 1_000_00 },
  ].filter((r) => r.daysLeft <= days),
  expired: { count: 1, value: 400_00 },
  expiring: { count: 1, value: 1_000_00 },
});
const expiring = vi.fn(async (days: number) => report(days));
vi.mock('./demoInventoryApi', async (load) => {
  const real = await load<typeof import('./demoInventoryApi')>();
  return { ...real, createDemoInventoryApi: (...a: Parameters<typeof real.createDemoInventoryApi>) => ({ ...real.createDemoInventoryApi(...a), expiring }) };
});

describe('expiring stock', () => {
  it('lists expired and soon-expiring batches with their value, and looks further ahead when asked', async () => {
    sessionStorage.setItem('ledgernest.demo', 'admin@ledgernest.demo');
    render(
      <AppProviders client={null}>
        <RouterProvider router={createMemoryRouter(routes, { initialEntries: ['/inventory'] })} />
      </AppProviders>,
    );
    const card = (await screen.findByRole('heading', { name: 'Expiring stock' }, { timeout: 10_000 })).closest('section')!;
    expect(within(card).getByText(/1 batches expired \(₹400.00\), 1 expiring within 90 days \(₹1,000.00\)/)).toBeInTheDocument();
    const rows = within(card).getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent(/PX-OLD.*expired 5 days ago.*40.*₹400.00/);
    expect(rows[1]).toHaveTextContent(/PX-SOON.*20 days left.*100.*₹1,000.00/);
    await userEvent.selectOptions(within(card).getByLabelText('Expiring within'), '30');
    expect(expiring).toHaveBeenLastCalledWith(30);
  }, 30_000);
});
