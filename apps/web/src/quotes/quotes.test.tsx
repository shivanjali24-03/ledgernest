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
import { resetDemoQuotes } from './demoQuotesApi';

function renderApp(path = '/quotes') {
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
  for (const reset of [resetDemoQuotes, resetDemoInvoices, resetDemoJournals, resetDemoAccounts, resetDemoPeriods, resetDemoTaxes, resetDemoContacts, resetDemoItems, resetDemoCurrencies]) reset();
  sessionStorage.clear();
});

describe('quotes', () => {
  it('lists the sample quote, and drafts a new one with GST worked out', { timeout: 20_000 }, async () => {
    const router = renderApp();
    const row = (await screen.findByRole('link', { name: 'QT-0001' }, { timeout: 4000 })).closest('tr')!;
    expect(row).toHaveTextContent('Bluewave Clinics');
    expect(row).toHaveTextContent('Sent');
    await userEvent.click(screen.getByRole('button', { name: 'New quote' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/quotes/new'));
    // The form can mount twice while the page loads: always look the select up again
    const customer = () => screen.getByLabelText('Customer') as HTMLSelectElement;
    await waitFor(() => expect(customer().options.length).toBeGreaterThan(2), { timeout: 4000 });
    await userEvent.selectOptions(customer(), [...customer().options].find((o) => o.textContent === 'Kumar Logistics')!.value);
    const item = screen.getByLabelText('Item on line 1') as HTMLSelectElement;
    await waitFor(() => expect(item.options.length).toBeGreaterThan(2));
    await userEvent.selectOptions(item, [...item.options].find((o) => o.textContent === 'Software development')!.value);
    fireEvent.change(screen.getByLabelText('Quantity on line 1'), { target: { value: '10' } });
    // 10 hours at ₹2,500 plus 18% GST within Maharashtra
    await waitFor(() => expect(screen.getByRole('status', { name: 'Totals' })).toHaveTextContent('29,500.00'));
    expect((screen.getByLabelText('Valid until') as HTMLInputElement).value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await userEvent.click(screen.getByRole('button', { name: 'Save and mark sent' }));
    expect(await screen.findByText('QT-0002 saved and marked sent', {}, { timeout: 4000 })).toBeInTheDocument();
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/quotes\/[0-9a-f-]{36}$/));
  });

  it('marks a quote accepted and turns it into a draft invoice', { timeout: 20_000 }, async () => {
    const router = renderApp();
    await userEvent.click(await screen.findByRole('link', { name: 'QT-0001' }, { timeout: 4000 }));
    await screen.findByRole('button', { name: 'Mark accepted' }, { timeout: 4000 });
    await waitFor(
      () => {
        if (!screen.queryByText('QT-0001 marked accepted')) fireEvent.click(screen.getByRole('button', { name: 'Mark accepted' }));
        expect(screen.getByText('QT-0001 marked accepted')).toBeInTheDocument();
      },
      { timeout: 6000 },
    );
    // Settled now: read-only, with its totals
    await waitFor(() => expect(screen.getByRole('status', { name: 'Totals' })).toHaveTextContent('Total'));
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Turn into invoice' }));
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/invoices\/[0-9a-f-]{36}$/), { timeout: 6000 });
    await waitFor(() => expect(screen.getByDisplayValue('Patient booking app: design and build')).toBeInTheDocument(), { timeout: 4000 });
    await waitFor(() => expect(screen.getByLabelText('Reference')).toHaveValue('Clinic app, phase 1'));
  });

  it('emails a quote to the customer', { timeout: 20_000 }, async () => {
    renderApp();
    await userEvent.click(await screen.findByRole('link', { name: 'QT-0001' }, { timeout: 4000 }));
    await screen.findByRole('button', { name: 'Email' }, { timeout: 4000 });
    // Open the dialog and send in one step, retried, as the header re-renders while the quote loads
    let sent = false;
    await waitFor(
      () => {
        if (sent) return;
        if (!screen.queryByRole('dialog')) fireEvent.click(screen.getByRole('button', { name: 'Email' }));
        const dialog = screen.getByRole('dialog', { name: 'Email QT-0001 to the customer' });
        expect(within(dialog).getByRole('textbox', { name: 'Send to' })).toHaveValue('finance@bluewave.health');
        fireEvent.click(within(dialog).getByRole('button', { name: 'Send' }));
        sent = true;
      },
      { timeout: 8000 },
    );
    await waitFor(() => expect(screen.getByText('In the demo nothing is really sent; it would go to finance@bluewave.health')).toBeInTheDocument(), { timeout: 4000 });
  });

  it('is read-only for Auditors', async () => {
    renderApp();
    await previewAs('auditor');
    expect(await screen.findByRole('link', { name: 'QT-0001' }, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New quote' })).not.toBeInTheDocument();
  });
});
