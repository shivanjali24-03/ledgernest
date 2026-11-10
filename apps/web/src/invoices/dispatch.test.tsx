import { render, screen } from '@testing-library/react';
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
});
