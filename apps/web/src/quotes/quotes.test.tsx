import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import AppProviders from '../AppProviders';
import { resetDemoAccounts, sampleId } from '../accounts/demoAccountsApi';
import { resetDemoContacts } from '../contacts/demoContactsApi';
import { resetDemoCurrencies } from '../currencies/demoCurrenciesApi';
import { resetDemoInvoices } from '../invoices/demoInvoicesApi';
import { resetDemoItems } from '../items/demoItemsApi';
import { resetDemoJournals } from '../journals/demoJournalsApi';
import { resetDemoPeriods } from '../periods/demoPeriodsApi';
import { routes } from '../routes';
import { openDialog } from '../test/openDialog';
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

  it('opens with the filter from the address, as the dashboard links it', async () => {
    renderApp('/quotes?state=accepted');
    expect(await screen.findByText('No quotes match', {}, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Accepted' })).toBeChecked();
  });

  it('duplicates a quote into a new one', { timeout: 20_000 }, async () => {
    const router = renderApp();
    await userEvent.click(await screen.findByRole('link', { name: 'QT-0001' }, { timeout: 4000 }));
    // Under More (the page may still be settling: open the menu until the item shows)
    await waitFor(
      () => {
        if (!screen.queryByRole('menuitem', { name: 'Duplicate' })) fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
        expect(screen.getByRole('menuitem', { name: 'Duplicate' })).toBeInTheDocument();
      },
      { timeout: 6000 },
    );
    fireEvent.click(screen.getByRole('menuitem', { name: 'Duplicate' }));
    await waitFor(() => expect(router.state.location.search).toMatch(/^\?copy=/), { timeout: 6000 });
    await waitFor(() => expect(screen.getByLabelText('Description on line 1')).toHaveValue('Patient booking app: design and build'), { timeout: 4000 });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('QT-0002 saved', {}, { timeout: 4000 })).toBeInTheDocument();
  });

  it('is read-only for Auditors', async () => {
    renderApp();
    await previewAs('auditor');
    expect(await screen.findByRole('link', { name: 'QT-0001' }, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New quote' })).not.toBeInTheDocument();
  });

  it('shares a quote as a link the customer accepts, and shows who accepted it', { timeout: 30_000 }, async () => {
    renderApp();
    await userEvent.click(await screen.findByRole('link', { name: 'QT-0001' }, { timeout: 6000 }));
    await screen.findByRole('button', { name: 'Share' }, { timeout: 6000 });
    const dialog = await openDialog('Share', 'Share quote QT-0001');
    expect(await within(dialog).findByTestId('quote-message', {}, { timeout: 4000 })).toHaveTextContent(/Dear Bluewave Clinics, here is quote QT-0001 from .* for ₹/);
    const token = (JSON.parse(localStorage.getItem('ledgernest.demo.quotes')!) as { shareToken?: string }[]).find((q) => q.shareToken)!.shareToken!;

    cleanup();
    sessionStorage.clear();
    const router = createMemoryRouter(routes, { initialEntries: [`/q/${token}`] });
    render(
      <AppProviders client={null}>
        <RouterProvider router={router} />
      </AppProviders>,
    );
    expect(await screen.findByRole('heading', { name: 'Quote QT-0001' }, { timeout: 6000 })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Accept quote' }));
    await userEvent.type(screen.getByLabelText('Your name'), 'Dr. Meera Iyer');
    await userEvent.type(screen.getByLabelText('Note (optional)'), 'Go ahead from next week.');
    await userEvent.click(screen.getByRole('button', { name: 'Accept' }));
    expect(await screen.findByRole('status', {}, { timeout: 4000 })).toHaveTextContent('Accepted by Dr. Meera Iyer.');

    cleanup();
    renderApp();
    await userEvent.click(await screen.findByRole('link', { name: 'QT-0001' }, { timeout: 6000 }));
    // Slow machines: wait for the quote itself, then its note (re-queried, as the page can remount)
    await screen.findByRole('heading', { name: /QT-0001/ }, { timeout: 10_000 });
    await waitFor(() => expect(screen.getByText('Accepted by Dr. Meera Iyer from the quote link.')).toBeInTheDocument(), { timeout: 10_000 });
    expect(screen.getByText('“Go ahead from next week.”')).toBeInTheDocument();
  });

  it('makes a sales order from a quote, numbered on its own, and lists them apart', async () => {
    const { createDemoQuotesApi } = await import('./demoQuotesApi');
    const api = createDemoQuotesApi(() => true);
    const first = (await api.list({ page: 1, pageSize: 10 })).items[0]!;
    renderApp(`/quotes/${first.id}`);
    await userEvent.click(await screen.findByRole('button', { name: 'More actions' }, { timeout: 6000 }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Make a sales order' }));
    expect(await screen.findByText('SO-0001 drafted from it', {}, { timeout: 6000 })).toBeInTheDocument();
    const orders = await api.list({ kind: 'sales_order', page: 1, pageSize: 10 });
    expect(orders.items.map((q) => [q.number, q.reference])).toEqual([['SO-0001', first.number]]);
    const pi = await api.copy(first.id, 'proforma');
    expect(pi.number).toBe('PI-0001');
    expect((await api.pdf(pi.id)).filename).toBe('proforma-pi-0001.pdf');
  }, 30_000);

  it('drafts a delivery challan, asking why the goods move', async () => {
    renderApp('/quotes/new?kind=delivery_challan');
    await userEvent.selectOptions(await screen.findByLabelText('Why the goods are moving', {}, { timeout: 10_000 }), 'job_work');
    const { createDemoQuotesApi } = await import('./demoQuotesApi');
    const api = createDemoQuotesApi(() => true);
    const first = (await api.list({ page: 1, pageSize: 10 })).items[0]!;
    await expect(api.create({ contactId: first.contact.id, kind: 'delivery_challan', quoteDate: '2026-10-01', expiryDate: '2026-10-01', lines: [{ description: 'Dies for machining', quantity: '5', unitPrice: 1_000_00, accountId: sampleId('4100.01') }] })).rejects.toMatchObject({ details: { fields: [expect.objectContaining({ path: ['purpose'] })] } });
    const dc = await api.create({ contactId: first.contact.id, kind: 'delivery_challan', purpose: 'job_work', quoteDate: '2026-10-01', expiryDate: '2026-10-01', lines: [{ description: 'Dies for machining', quantity: '5', unitPrice: 1_000_00, accountId: sampleId('4100.01') }] });
    expect(dc).toMatchObject({ number: 'DC-0001', purpose: 'job_work' });
    expect((await api.pdf(dc.id)).filename).toBe('delivery-challan-dc-0001.pdf');
  }, 30_000);
});
