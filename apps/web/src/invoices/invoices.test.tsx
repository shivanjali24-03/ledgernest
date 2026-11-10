import { vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import AppProviders from '../AppProviders';
import { resetDemoAccounts } from '../accounts/demoAccountsApi';
import { resetDemoContacts } from '../contacts/demoContactsApi';
import { resetDemoCurrencies } from '../currencies/demoCurrenciesApi';
import { resetDemoItems } from '../items/demoItemsApi';
import { resetDemoJournals } from '../journals/demoJournalsApi';
import { resetDemoPeriods } from '../periods/demoPeriodsApi';
import { routes } from '../routes';
import { resetDemoTaxes } from '../taxes/demoTaxesApi';
import { resetDemoInvoices } from './demoInvoicesApi';

function renderApp(path = '/invoices') {
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
const totals = () => screen.getByRole('status', { name: 'Totals' });

beforeEach(() => {
  for (const reset of [resetDemoInvoices, resetDemoJournals, resetDemoAccounts, resetDemoPeriods, resetDemoTaxes, resetDemoContacts, resetDemoItems, resetDemoCurrencies]) reset();
  sessionStorage.clear();
});

describe('invoices', () => {
  it('lists the month’s invoice and a draft, with what is outstanding', async () => {
    renderApp();
    const issued = (await screen.findByRole('link', { name: /^INV\/.*\/0001$/ }, { timeout: 4000 })).closest('tr')!;
    expect(within(issued).getByText('Kumar Logistics')).toBeInTheDocument();
    expect(within(issued).getAllByText('₹1,18,000.00')).toHaveLength(2);
    expect(screen.getByRole('link', { name: 'Draft' }).closest('tr')!).toHaveTextContent('Bluewave Clinics');
    expect(screen.getByText('Outstanding').closest('div')!).toHaveTextContent('₹1,18,000.00');
  });

  it('issues the draft to a customer in Karnataka with IGST, ready to print', async () => {
    renderApp();
    await userEvent.click(await screen.findByRole('link', { name: 'Draft' }, { timeout: 4000 }));
    await screen.findByRole('heading', { name: 'Draft invoice' });
    // 24 hours at ₹2,500 and a year's maintenance less 10%: ₹1,68,000, with IGST because Bluewave is in another state
    await waitFor(() => expect(totals()).toHaveTextContent('IGST 18%'));
    expect(totals()).toHaveTextContent('1,68,000.00');
    expect(totals()).toHaveTextContent('30,240.00');
    expect(totals()).toHaveTextContent('INR 1,98,240.00');
    expect(screen.getByText('Another state: IGST')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Issue' }));
    expect(await screen.findByText(/^Issued as INV\//, {}, { timeout: 4000 })).toBeInTheDocument();
    const doc = await screen.findByRole('article', {}, { timeout: 4000 });
    expect(within(doc).getByText('Tax invoice')).toBeInTheDocument();
    expect(within(doc).getByText('Place of supply: Karnataka (29)')).toBeInTheDocument();
    expect(within(doc).getByText('HSN/SAC 998314')).toBeInTheDocument();
    expect(within(doc).getByText('₹1,98,240.00')).toBeInTheDocument();
    expect(screen.getByText('Posted as').parentElement!.querySelector('a')!.textContent).toMatch(/^JV\//);
    expect(screen.getByRole('button', { name: 'Print or save as PDF' })).toBeInTheDocument();
  }, 20_000);

  it('fills a line from an item and charges CGST + SGST within Maharashtra', async () => {
    renderApp('/invoices/new');
    const customer = (await screen.findByLabelText('Customer')) as HTMLSelectElement;
    await waitFor(() => expect(customer.options.length).toBeGreaterThan(2));
    await userEvent.selectOptions(customer, [...customer.options].find((o) => o.textContent === 'Kumar Logistics')!.value);
    const item = screen.getByLabelText('Item on line 1') as HTMLSelectElement;
    await waitFor(() => expect(item.options.length).toBeGreaterThan(2));
    await userEvent.selectOptions(item, [...item.options].find((o) => o.textContent === 'Software development')!.value);
    expect(screen.getByLabelText('Description on line 1')).toHaveValue('Software development');
    expect(screen.getByLabelText('Price on line 1')).toHaveValue('2,500.00');
    await userEvent.clear(screen.getByLabelText('Quantity on line 1'));
    await userEvent.type(screen.getByLabelText('Quantity on line 1'), '8');
    await waitFor(() => expect(totals()).toHaveTextContent('CGST 9%'));
    expect(totals()).toHaveTextContent('SGST 9%');
    expect(totals()).toHaveTextContent('INR 23,600.00');
    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByText('Draft saved', {}, { timeout: 4000 })).toBeInTheDocument();
  });

  it('voids an unpaid invoice', { timeout: 20_000 }, async () => {
    renderApp();
    await userEvent.click(await screen.findByRole('link', { name: /^INV\/.*\/0001$/ }, { timeout: 4000 }));
    // Wait for the invoice itself, so the header (and its Void button) has settled
    await screen.findByRole('article', {}, { timeout: 4000 });
    await screen.findByRole('button', { name: 'Record payment' });
    // Plain clicks, retried until they take: open the dialog (only while it's closed, as a second click would land
    // outside it) and confirm in the same step, as the header re-renders while the invoice's details load
    await waitFor(
      () => {
        if (!screen.queryByText(/^Its entry is reversed today/)) fireEvent.click(screen.getByRole('button', { name: 'Void' }));
        const dialog = screen.getByText(/^Its entry is reversed today/).closest('[role="dialog"]') as HTMLElement;
        expect(dialog).toHaveTextContent(/^Void INV\//);
        fireEvent.click(within(dialog).getByRole('button', { name: 'Void' }));
      },
      { timeout: 6000 },
    );
    // The invoice records its reversal (more lasting than the toast, which can come and go under load)
    await waitFor(() => expect(screen.getByText(/Posted as/)).toHaveTextContent(/Voided by JV\//), { timeout: 8000 });
  });

  it('sends a payment reminder, and remembers it', { timeout: 20_000 }, async () => {
    renderApp();
    await userEvent.click(await screen.findByRole('link', { name: /^INV\/.*\/0001$/ }, { timeout: 4000 }));
    await screen.findByRole('article', {}, { timeout: 4000 });
    await screen.findByRole('button', { name: 'Record payment' }, { timeout: 4000 });
    // Open the dialog and send in one step, retried, as the header re-renders while the invoice loads
    let sent = false;
    await waitFor(
      () => {
        if (sent) return;
        if (!screen.queryByRole('dialog')) fireEvent.click(screen.getByRole('button', { name: 'Send reminder' }));
        const dialog = screen.getByRole('dialog', { name: /^Payment reminder for INV\// });
        expect(within(dialog).getByLabelText('Send to')).toHaveValue('accounts@kumarlogistics.in');
        expect(dialog).toHaveTextContent('1,18,000.00');
        fireEvent.click(within(dialog).getByRole('button', { name: 'Send reminder' }));
        sent = true;
      },
      { timeout: 8000 },
    );
    await waitFor(() => expect(screen.getByText(/Posted as/)).toHaveTextContent(/Reminders sent: 1, last on/), { timeout: 8000 });
  });

  it('duplicates an issued invoice into a new draft dated today', { timeout: 20_000 }, async () => {
    const router = renderApp();
    await userEvent.click(await screen.findByRole('link', { name: /^INV\/.*\/0001$/ }, { timeout: 4000 }));
    await screen.findByRole('article', {}, { timeout: 4000 });
    await waitFor(
      () => {
        if (!router.state.location.search.includes('copy=')) fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }));
        expect(router.state.location.search).toMatch(/^\?copy=/);
      },
      { timeout: 6000 },
    );
    await waitFor(() => expect(screen.getByLabelText('Description on line 1')).toHaveValue('Software development, sprint 14'), { timeout: 4000 });
    await waitFor(() => expect((screen.getByLabelText('Customer') as HTMLSelectElement).selectedOptions[0]!.textContent).toBe('Kumar Logistics'), { timeout: 4000 });
    expect(screen.getByLabelText('Reference')).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/invoices\/[0-9a-f-]{36}$/), { timeout: 6000 });
  });

  it('emails an issued invoice to the customer', { timeout: 20_000 }, async () => {
    renderApp();
    await userEvent.click(await screen.findByRole('link', { name: /^INV\/.*\/0001$/ }, { timeout: 4000 }));
    await screen.findByRole('article', {}, { timeout: 4000 });
    await screen.findByRole('button', { name: 'Email' }, { timeout: 4000 });
    // Open the dialog and send in one step, retried, as the header re-renders while the invoice loads
    let sent = false;
    await waitFor(
      () => {
        if (sent) return;
        if (!screen.queryByRole('dialog')) fireEvent.click(screen.getByRole('button', { name: 'Email' }));
        const dialog = screen.getByRole('dialog', { name: /^Email INV\/.* to the customer$/ });
        expect(within(dialog).getByLabelText('Send to')).toHaveValue('accounts@kumarlogistics.in');
        fireEvent.click(within(dialog).getByRole('button', { name: 'Send' }));
        sent = true;
      },
      { timeout: 8000 },
    );
    await waitFor(() => expect(screen.getByText('In the demo nothing is really sent; it would go to accounts@kumarlogistics.in')).toBeInTheDocument(), { timeout: 4000 });
  });

  it('downloads the list as CSV, with the filter in use', async () => {
    let saved: Blob | undefined;
    Object.assign(URL, { createObjectURL: vi.fn((b: Blob) => ((saved = b), 'blob:csv')), revokeObjectURL: vi.fn() });
    renderApp();
    await screen.findByRole('link', { name: /^INV\/.*\/0001$/ }, { timeout: 4000 });
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    await waitFor(() => expect(saved).toBeDefined(), { timeout: 4000 });
    const text = await saved!.text();
    expect(text.replace(/^\uFEFF/, '').split('\r\n')[0]).toBe('"number","state","issue_date","due_date","customer","reference","currency","total","paid","balance"');
    expect(text).toMatch(/"INV\/[^"]+\/0001","[a-z_]+","[\d-]+","[\d-]+","Kumar Logistics","PO-4471","INR","1180\d\d\.00"/);
  });

  it('downloads an issued invoice as PDF', { timeout: 20_000 }, async () => {
    let saved: Blob | undefined;
    Object.assign(URL, { createObjectURL: vi.fn((b: Blob) => ((saved = b), 'blob:pdf')), revokeObjectURL: vi.fn() });
    renderApp();
    await userEvent.click(await screen.findByRole('link', { name: /^INV\/.*\/0001$/ }, { timeout: 4000 }));
    await screen.findByRole('article', {}, { timeout: 4000 });
    await waitFor(
      () => {
        if (!saved) fireEvent.click(screen.getByRole('button', { name: 'Download PDF' }));
        expect(saved).toBeDefined();
      },
      { timeout: 8000 },
    );
    const text = new TextDecoder('latin1').decode(await saved!.arrayBuffer());
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toMatch(/\(Tax invoice INV\/[^)]+\/0001\) Tj/);
  });

  it('shows a pay-by-UPI QR code for what is owed once the UPI ID is set, and puts it in the PDF', { timeout: 20_000 }, async () => {
    let saved: Blob | undefined;
    Object.assign(URL, { createObjectURL: vi.fn((b: Blob) => ((saved = b), 'blob:pdf')), revokeObjectURL: vi.fn() });
    localStorage.removeItem('ledgernest.demo.settings');
    renderApp('/settings');
    const upi = await screen.findByLabelText('UPI ID', {}, { timeout: 4000 });
    await userEvent.type(upi, 'nope');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Enter a UPI ID like yourname@okhdfcbank.')).toBeInTheDocument();
    await userEvent.clear(upi);
    await userEvent.type(upi, 'nestdemo@okhdfcbank');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(JSON.parse(localStorage.getItem('ledgernest.demo.settings')!).settings.upiId).toBe('nestdemo@okhdfcbank'));
    cleanup();
    renderApp();
    await userEvent.click(await screen.findByRole('link', { name: /^INV\/.*\/0001$/ }, { timeout: 4000 }));
    const card = await screen.findByTestId('invoice-upi', {}, { timeout: 4000 });
    expect(within(card).getByRole('img', { name: 'QR code to pay ₹1,18,000.00 to nestdemo@okhdfcbank by UPI' })).toBeInTheDocument();
    expect(within(card).getByRole('link', { name: 'Pay with a UPI app' }).getAttribute('href')).toMatch(/^upi:\/\/pay\?pa=nestdemo%40okhdfcbank&pn=Nest%20Demo%20Private%20Limited&am=118000\.00&cu=INR&tn=Invoice%20INV%2F/);
    await waitFor(
      () => {
        if (!saved) fireEvent.click(screen.getByRole('button', { name: 'Download PDF' }));
        expect(saved).toBeDefined();
      },
      { timeout: 8000 },
    );
    const text = new TextDecoder('latin1').decode(await saved!.arrayBuffer());
    expect(text).toContain('(Rs 118000.00 to nestdemo@okhdfcbank) Tj');
    localStorage.removeItem('ledgernest.demo.settings');
  });

  it('is read-only for Auditors', async () => {
    renderApp();
    await screen.findByRole('link', { name: /^INV\// }, { timeout: 4000 });
    await previewAs('auditor');
    await waitFor(() => expect(screen.queryByRole('button', { name: 'New invoice' })).not.toBeInTheDocument());
  });
});
