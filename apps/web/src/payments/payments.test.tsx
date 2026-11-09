import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import AppProviders from '../AppProviders';
import { resetDemoAccounts } from '../accounts/demoAccountsApi';
import { resetDemoContacts } from '../contacts/demoContactsApi';
import { resetDemoCurrencies } from '../currencies/demoCurrenciesApi';
import { resetDemoInvoices } from '../invoices/demoInvoicesApi';
import { resetDemoItems } from '../items/demoItemsApi';
import { resetDemoJournals } from '../journals/demoJournalsApi';
import { resetDemoPeriods } from '../periods/demoPeriodsApi';
import { routes } from '../routes';
import { resetDemoTaxes } from '../taxes/demoTaxesApi';
import { resetDemoPayments } from './demoPaymentsApi';

function renderApp(path: string) {
  sessionStorage.setItem('ledgernest.demo', 'admin@ledgernest.demo');
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <AppProviders client={null}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return router;
}
const previewAs = (role: string) => userEvent.selectOptions(screen.getByLabelText('Preview the app as a role'), role);

beforeEach(() => {
  for (const reset of [resetDemoPayments, resetDemoInvoices, resetDemoJournals, resetDemoAccounts, resetDemoPeriods, resetDemoTaxes, resetDemoContacts, resetDemoItems, resetDemoCurrencies]) reset();
  sessionStorage.clear();
});

describe('receipts', () => {
  it('records a payment from the invoice, which is then paid', async () => {
    renderApp('/invoices');
    await userEvent.click(await screen.findByRole('link', { name: /^INV\/.*\/0001$/ }, { timeout: 4000 }));
    await screen.findByRole('article', {}, { timeout: 4000 });
    // A plain click, retried until the dialog opens: the header re-renders as the invoice's details load
    await waitFor(
      () => {
        // Only while it's closed: a second click would land outside the open dialog and close it
        if (!screen.queryByText('Record a receipt')) fireEvent.click(screen.getByRole('button', { name: 'Record payment' }));
        expect(screen.getByText('Record a receipt')).toBeInTheDocument();
      },
      { timeout: 4000 },
    );
    const dialog = screen.getByText('Record a receipt').closest('[role="dialog"]') as HTMLElement;
    await waitFor(() => expect(within(dialog).getByLabelText('Amount (INR)')).toHaveValue('1,18,000.00'));
    expect(within(dialog).getByLabelText(/^Apply to INV\//)).toHaveValue('1,18,000.00');
    expect(within(dialog).getByRole('status')).toHaveTextContent('All of it is applied');
    await userEvent.type(within(dialog).getByLabelText('Reference'), 'UTR 402918');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record receipt' }));
    expect(await screen.findByText(/^Recorded as RCT\/.*\/0001$/, {}, { timeout: 4000 })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/Posted as/)).toHaveTextContent(/Paid by RCT\//), { timeout: 4000 });
    expect(screen.queryByRole('button', { name: 'Record payment' })).not.toBeInTheDocument();
  }, 20_000);

  it('records part of what a customer owes, shows their balance, and voids it', async () => {
    renderApp('/payments');
    fireEvent.click(await screen.findByRole('button', { name: 'Record receipt' }));
    const dialog = (await screen.findByText('Record a receipt', {}, { timeout: 4000 })).closest('[role="dialog"]') as HTMLElement;
    const customer = within(dialog).getByLabelText('Customer') as HTMLSelectElement;
    await waitFor(() => expect(customer.options.length).toBeGreaterThan(2));
    await userEvent.selectOptions(customer, [...customer.options].find((o) => o.textContent === 'Kumar Logistics')!.value);
    await userEvent.type(within(dialog).getByLabelText('Amount (INR)'), '50000');
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Oldest first' }, { timeout: 4000 }));
    expect(within(dialog).getByLabelText(/^Apply to INV\//)).toHaveValue('50,000.00');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record receipt' }));
    const row = (await screen.findByText('Kumar Logistics', { selector: 'span.font-medium' }, { timeout: 4000 })).closest('li')!;
    expect(row).toHaveTextContent('₹50,000.00');
    expect(row).toHaveTextContent(/Paid INV\//);

    document.body.innerHTML = '';
    renderApp('/contacts');
    const kumar = (await screen.findByRole('button', { name: 'Kumar Logistics' }, { timeout: 4000 })).closest('li')!;
    await waitFor(() => expect(kumar).toHaveTextContent('Owes ₹68,000.00'));

    document.body.innerHTML = '';
    renderApp('/payments');
    await userEvent.click(await screen.findByRole('button', { name: /^Actions for RCT\// }, { timeout: 4000 }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Void receipt' }));
    const confirm = (await screen.findByText(/invoices it paid are open again/, {}, { timeout: 3000 })).closest('[role="dialog"]') as HTMLElement;
    await userEvent.click(within(confirm).getByRole('button', { name: 'Void receipt' }));
    expect(await screen.findByText(/^RCT\/.* voided$/, {}, { timeout: 4000 })).toBeInTheDocument();
  }, 30_000);

  it('is read-only for Auditors', async () => {
    renderApp('/payments');
    await screen.findByRole('heading', { name: 'Payments' });
    await previewAs('auditor');
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Record receipt' })).not.toBeInTheDocument());
  });
});
