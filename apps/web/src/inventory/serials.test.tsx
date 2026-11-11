import { vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import AppProviders from '../AppProviders';
import { resetDemoAccounts, sampleId } from '../accounts/demoAccountsApi';
import { routes } from '../routes';
import { resetDemoBills } from '../bills/demoBillsApi';
import { createDemoItemsApi, resetDemoItems } from '../items/demoItemsApi';
import type { SerialHistory } from './types';

const history: SerialHistory[] = [
  {
    itemId: 'i1',
    item: 'Phone X',
    serialNo: '490154203237518',
    status: 'sold',
    movements: [
      { id: 'm1', date: '2026-06-01', kind: 'bill', document: { id: 'b1', number: 'BILL/2026-27/0001' }, contact: 'Phone Distributors', reason: null },
      { id: 'm2', date: '2026-06-10', kind: 'invoice', document: { id: 'v1', number: 'INV/2026-27/0004' }, contact: 'Ravi Mobiles', reason: null },
    ],
  },
];
const serial = vi.fn(async (s: string) => (s === '490154203237518' ? history : []));
vi.mock('./demoInventoryApi', async (load) => {
  const real = await load<typeof import('./demoInventoryApi')>();
  return { ...real, createDemoInventoryApi: (...a: Parameters<typeof real.createDemoInventoryApi>) => ({ ...real.createDemoInventoryApi(...a), serial }) };
});

function renderApp(path: string) {
  sessionStorage.setItem('ledgernest.demo', 'admin@ledgernest.demo');
  render(
    <AppProviders client={null}>
      <RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />
    </AppProviders>,
  );
}

beforeEach(() => {
  for (const reset of [resetDemoItems, resetDemoAccounts, resetDemoBills]) reset();
  sessionStorage.clear();
});

describe('serial numbers', () => {
  it('traces a serial number: where it was bought, who it was sold to', async () => {
    renderApp('/inventory');
    await userEvent.type(await screen.findByLabelText('Find a serial number', {}, { timeout: 10_000 }), '490154203237518');
    await userEvent.click(screen.getByRole('button', { name: 'Find' }));
    const unit = await screen.findByRole('region', { name: '490154203237518 · Phone X' });
    expect(within(unit).getByText('Sold')).toBeInTheDocument();
    const steps = within(unit).getAllByRole('listitem');
    expect(steps[0]).toHaveTextContent(/BILL\/2026-27\/0001.*Phone Distributors/);
    expect(steps[1]).toHaveTextContent(/INV\/2026-27\/0004.*Ravi Mobiles/);
    await userEvent.clear(screen.getByLabelText('Find a serial number'));
    await userEvent.type(screen.getByLabelText('Find a serial number'), 'NOPE-1');
    await userEvent.click(screen.getByRole('button', { name: 'Find' }));
    expect(await screen.findByText('No unit with serial number NOPE-1.')).toBeInTheDocument();
  }, 30_000);

  it('asks a bill line of serial-numbered goods for one serial per unit', async () => {
    const item = await createDemoItemsApi(() => true).create({ name: 'Phone X', kind: 'goods', unit: 'NOS', trackStock: true, trackSerials: true, inventoryAccountId: sampleId('1600'), cogsAccountId: sampleId('5050') });
    renderApp('/bills/new');
    await screen.findByRole('heading', { name: 'New bill' }, { timeout: 10_000 });
    await waitFor(() => expect([...(screen.getByLabelText('Item on line 1') as HTMLSelectElement).options].map((o) => o.value)).toContain(item.id));
    await userEvent.selectOptions(screen.getByLabelText('Item on line 1'), item.id);
    await userEvent.clear(screen.getByLabelText('Quantity on line 1'));
    await userEvent.type(screen.getByLabelText('Quantity on line 1'), '2');
    const serials = screen.getByLabelText('Serial numbers for line 1');
    await userEvent.type(serials, 'IMEI-A');
    expect(screen.getByText('1 of 2 serials')).toBeInTheDocument();
    await userEvent.type(serials, '{enter}IMEI-B');
    expect(screen.getByText('2 of 2 serials')).toBeInTheDocument();
    expect(serials).not.toHaveClass('border-expense');
  }, 30_000);
});
