import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import AppProviders from '../AppProviders';
import { resetDemoAccounts, sampleId } from '../accounts/demoAccountsApi';
import { demoContactRows, resetDemoContacts } from '../contacts/demoContactsApi';
import { routes } from '../routes';
import { createDemoInvoicesApi, resetDemoInvoices } from './demoInvoicesApi';

function renderApp(path: string) {
  sessionStorage.setItem('ledgernest.demo', 'admin@ledgernest.demo');
  render(
    <AppProviders client={null}>
      <RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />
    </AppProviders>,
  );
}

beforeEach(() => {
  for (const reset of [resetDemoInvoices, resetDemoContacts, resetDemoAccounts]) reset();
  sessionStorage.clear();
});

describe('order and dispatch details', () => {
  it('opens the dispatch section on a new invoice', async () => {
    renderApp('/invoices/new');
    await userEvent.click(await screen.findByRole('button', { name: 'Order and dispatch details' }, { timeout: 10_000 }));
    expect(screen.getByLabelText('Vehicle no.')).toBeInTheDocument();
    expect(screen.getByLabelText('Buyer’s order no.')).toBeInTheDocument();
  }, 30_000);

  it('shows them on the invoice', async () => {
    const kumar = demoContactRows().find((c) => c.name === 'Kumar Logistics')!;
    const api = createDemoInvoicesApi(() => true);
    const d = await api.create({ contactId: kumar.id, issueDate: '2026-10-01', dispatch: { buyerOrderNo: 'PO-7781', dispatchedThrough: 'VRL Logistics', vehicleNo: 'MH12AB1234' }, lines: [{ description: 'Cement', quantity: '1', unitPrice: 100_00, accountId: sampleId('4100.01') }] });
    renderApp(`/invoices/${d.id}`);
    expect(await screen.findByLabelText('Vehicle no.', {}, { timeout: 10_000 })).toHaveValue('MH12AB1234');
  }, 30_000);

  it('ships to another address, making its state the place of supply', async () => {
    renderApp('/invoices/new');
    const customer = (await screen.findByLabelText('Customer', {}, { timeout: 10_000 })) as HTMLSelectElement;
    const kumar = demoContactRows().find((c) => c.name === 'Kumar Logistics')!;
    await waitFor(() => expect([...customer.options].map((x) => x.value)).toContain(kumar.id), { timeout: 10_000 });
    await userEvent.selectOptions(customer, kumar.id);
    expect(screen.getByLabelText('Place of supply')).toHaveValue('27');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Ship to a different address' }));
    await userEvent.type(screen.getByLabelText('PIN code'), '560034');
    await screen.findByText(/Bangalore, Karnataka/, {}, { timeout: 10_000 });
    expect(screen.getByLabelText('Place of supply')).toHaveValue('29');
    expect(screen.getByText(/bill to, ship to/)).toBeInTheDocument();
  }, 30_000);

  it('rounds the total to the rupee when the organisation asks, showing the round-off', async () => {
    const { createDemoSettingsApi, resetDemoSettings } = await import('../settings/demoSettingsApi');
    resetDemoSettings();
    await createDemoSettingsApi(() => true).update({ roundInvoiceTotals: true });
    const kumar = demoContactRows().find((c) => c.name === 'Kumar Logistics')!;
    const api = createDemoInvoicesApi(() => true);
    const d = await api.create({ contactId: kumar.id, issueDate: '2026-10-01', lines: [{ description: 'Cement', quantity: '1', unitPrice: 1_000_30, accountId: sampleId('4100.01') }] });
    expect(d).toMatchObject({ roundOff: -30, total: 1_000_00 });
    resetDemoSettings();
  });

  it('takes a discount on the whole invoice and prices with GST in them, in the draft’s totals', async () => {
    renderApp('/invoices/new');
    await userEvent.type(await screen.findByLabelText('Description on line 1', {}, { timeout: 10_000 }), 'Machine');
    await userEvent.type(screen.getByLabelText('Price on line 1'), '1000');
    await userEvent.type(screen.getByLabelText('Discount'), '10');
    const totals = screen.getByRole('status', { name: 'Totals' });
    expect(totals).toHaveTextContent('Discount (in the taxable value)');
    expect(totals).toHaveTextContent(/900\.00/);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Prices include GST' }));
    expect(screen.getByRole('status', { name: 'Totals' })).toHaveTextContent(/900\.00/);
  }, 30_000);
});
