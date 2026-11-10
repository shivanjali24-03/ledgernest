import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import AppProviders from '../AppProviders';
import { resetDemoAccounts } from '../accounts/demoAccountsApi';
import { resetDemoBills } from '../bills/demoBillsApi';
import { resetDemoContacts } from '../contacts/demoContactsApi';
import { resetDemoCurrencies } from '../currencies/demoCurrenciesApi';
import { resetDemoItems } from '../items/demoItemsApi';
import { resetDemoJournals } from '../journals/demoJournalsApi';
import { resetDemoPayments } from '../payments/demoPaymentsApi';
import { resetDemoPeriods } from '../periods/demoPeriodsApi';
import { routes } from '../routes';
import { openDialog } from '../test/openDialog';
import { resetDemoTaxes } from '../taxes/demoTaxesApi';
import { resetDemoDebitNotes } from './demoDebitNotesApi';

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
  for (const reset of [resetDemoDebitNotes, resetDemoBills, resetDemoPayments, resetDemoJournals, resetDemoAccounts, resetDemoPeriods, resetDemoTaxes, resetDemoContacts, resetDemoItems, resetDemoCurrencies]) reset();
  sessionStorage.clear();
});

describe('debit notes', () => {
  it('credits a bill back with its input GST, which comes off what’s owed to the vendor, and voids it', { timeout: 30_000 }, async () => {
    renderApp('/bills');
    await userEvent.click(await screen.findByRole('link', { name: /^BILL\/.*\/0001$/ }, { timeout: 4000 }));
    await screen.findByRole('article', {}, { timeout: 4000 });
    const dialog = await openDialog('Debit note', /^Debit note for BILL\//);
    // The month's rent: ₹45,000 + 18% GST, credited in full with the supplier's own credit note number
    const qty = await within(dialog).findByLabelText('Quantity to send back for Office rent', {}, { timeout: 4000 });
    await waitFor(() => expect(qty).not.toBeDisabled());
    await userEvent.type(qty, '1');
    await userEvent.type(within(dialog).getByLabelText('Their credit note number'), 'SOS-CN-12');
    expect(within(dialog).getByRole('status', { name: 'Totals' })).toHaveTextContent(/53,100\.00/);
    expect(within(dialog).getByText('All of it comes off what the bill still has to be paid.')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Raise debit note' }));
    expect(await screen.findByText(/^Raised DN\/.*\/0001$/, {}, { timeout: 4000 })).toBeInTheDocument();
    // Nothing left to pay: the bill shows the debit note
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Pay bill' })).not.toBeInTheDocument(), { timeout: 4000 });
    await waitFor(() => expect(screen.getByRole('link', { name: /^DN\/.*\/0001$/ })).toBeInTheDocument(), { timeout: 4000 });

    cleanup();
    renderApp('/debit-notes');
    const row = (await screen.findByRole('link', { name: /^DN\/.*\/0001$/ }, { timeout: 4000 })).closest('li')!;
    expect(row).toHaveTextContent('Sharma Office Supplies');
    expect(row).toHaveTextContent('their SOS-CN-12');
    expect(row).toHaveTextContent('₹53,100.00');
    fireEvent.click(within(row).getByRole('button', { name: /^Actions for DN\// }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Void debit note' }));
    const confirm = await screen.findByRole('dialog', { name: /^Void DN\/.*\?$/ });
    await userEvent.click(within(confirm).getByRole('button', { name: 'Void debit note' }));
    expect(await screen.findByText(/^DN\/.*\/0001 voided$/, {}, { timeout: 4000 })).toBeInTheDocument();

    // The rent is owed again
    cleanup();
    renderApp('/bills');
    await userEvent.click(await screen.findByRole('link', { name: /^BILL\/.*\/0001$/ }, { timeout: 4000 }));
    expect(await screen.findByRole('button', { name: 'Pay bill' }, { timeout: 4000 })).toBeInTheDocument();
  });

  it('lists debit notes for people who can see bills, under Purchases', async () => {
    renderApp('/debit-notes');
    expect(await screen.findByRole('heading', { name: 'Debit notes' }, { timeout: 4000 })).toBeInTheDocument();
    expect(await screen.findByText('No debit notes yet', {}, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Main' })).toHaveTextContent('Debit notes');
  });
});
