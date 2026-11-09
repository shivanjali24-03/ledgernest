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
import { resetDemoPayments } from '../payments/demoPaymentsApi';
import { resetDemoPeriods } from '../periods/demoPeriodsApi';
import { routes } from '../routes';
import { resetDemoTaxes } from '../taxes/demoTaxesApi';
import { resetDemoCreditNotes } from './demoCreditNotesApi';

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

beforeEach(() => {
  for (const reset of [resetDemoCreditNotes, resetDemoPayments, resetDemoInvoices, resetDemoJournals, resetDemoAccounts, resetDemoPeriods, resetDemoTaxes, resetDemoContacts, resetDemoItems, resetDemoCurrencies]) reset();
  sessionStorage.clear();
});

describe('credit notes', () => {
  it('credits part of an invoice with its GST, which comes off what the customer owes, and voids it', async () => {
    renderApp('/invoices');
    await userEvent.click(await screen.findByRole('link', { name: /^INV\/.*\/0001$/ }, { timeout: 4000 }));
    await screen.findByRole('article', {}, { timeout: 4000 });
    await waitFor(
      () => {
        if (!screen.queryByText(/^Credit note for INV\//)) fireEvent.click(screen.getByRole('button', { name: 'Credit note' }));
        expect(screen.getByText(/^Credit note for INV\//)).toBeInTheDocument();
      },
      { timeout: 4000 },
    );
    const dialog = screen.getByText(/^Credit note for INV\//).closest('[role="dialog"]') as HTMLElement;
    const qty = within(dialog).getByLabelText('Quantity to credit for Software development, sprint 14');
    await waitFor(() => expect(qty).toBeEnabled(), { timeout: 4000 });
    await userEvent.type(qty, '4');
    await userEvent.type(within(dialog).getByLabelText('Reason'), 'Four hours not delivered');
    // 4 hours at ₹2,500 and 18% GST
    const totals = within(dialog).getByRole('status', { name: 'Totals' });
    await waitFor(() => expect(totals).toHaveTextContent('INR 11,800.00'), { timeout: 4000 });
    expect(totals).toHaveTextContent('1,800.00');
    expect(within(dialog).getByText('All of it comes off what the invoice still has to be paid.')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Issue credit note' }));
    expect(await screen.findByText(/^Issued CN\/.*\/0001$/, {}, { timeout: 4000 })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/Posted as/)).toHaveTextContent(/Credited by CN\//), { timeout: 4000 });

    document.body.innerHTML = '';
    renderApp('/contacts');
    const kumar = (await screen.findByRole('button', { name: 'Kumar Logistics' }, { timeout: 4000 })).closest('li')!;
    await waitFor(() => expect(kumar).toHaveTextContent('Owes ₹1,06,200.00'));

    document.body.innerHTML = '';
    renderApp('/credit-notes');
    const row = (await screen.findByRole('link', { name: /^CN\/.*\/0001$/ }, { timeout: 4000 })).closest('li')!;
    expect(row).toHaveTextContent('₹11,800.00');
    expect(row).toHaveTextContent('Four hours not delivered');
    expect(row).toHaveTextContent(/₹11,800.00 on INV\//);
    await userEvent.click(within(row).getByRole('button', { name: /^Actions for CN\// }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Void credit note' }));
    const confirm = (await screen.findByText(/invoices it went onto are owed again/, {}, { timeout: 3000 })).closest('[role="dialog"]') as HTMLElement;
    await userEvent.click(within(confirm).getByRole('button', { name: 'Void credit note' }));
    expect(await screen.findByText(/^CN\/.* voided$/, {}, { timeout: 4000 })).toBeInTheDocument();
  }, 30_000);

  it('refuses more than is left on a line', async () => {
    renderApp('/invoices');
    await userEvent.click(await screen.findByRole('link', { name: /^INV\/.*\/0001$/ }, { timeout: 4000 }));
    await screen.findByRole('article', {}, { timeout: 4000 });
    await waitFor(
      () => {
        if (!screen.queryByText(/^Credit note for INV\//)) fireEvent.click(screen.getByRole('button', { name: 'Credit note' }));
        expect(screen.getByText(/^Credit note for INV\//)).toBeInTheDocument();
      },
      { timeout: 4000 },
    );
    const dialog = screen.getByText(/^Credit note for INV\//).closest('[role="dialog"]') as HTMLElement;
    const qty = within(dialog).getByLabelText('Quantity to credit for Software development, sprint 14');
    await waitFor(() => expect(qty).toBeEnabled(), { timeout: 4000 });
    await userEvent.type(qty, '41');
    expect(within(dialog).getByRole('button', { name: 'Issue credit note' })).toBeDisabled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Credit everything left' }));
    expect(qty).toHaveValue('40');
    await waitFor(() => expect(within(dialog).getByRole('status', { name: 'Totals' })).toHaveTextContent('INR 1,18,000.00'), { timeout: 4000 });
  }, 20_000);
});
