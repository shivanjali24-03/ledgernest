import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import AppProviders from '../AppProviders';
import { resetDemoAccounts } from '../accounts/demoAccountsApi';
import { resetDemoBills } from '../bills/demoBillsApi';
import { resetDemoContacts } from '../contacts/demoContactsApi';
import { resetDemoCurrencies } from '../currencies/demoCurrenciesApi';
import { resetDemoInvoices } from '../invoices/demoInvoicesApi';
import { resetDemoItems } from '../items/demoItemsApi';
import { resetDemoJournals } from '../journals/demoJournalsApi';
import { resetDemoPeriods } from '../periods/demoPeriodsApi';
import { routes } from '../routes';
import { openDialog } from '../test/openDialog';
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
  for (const reset of [resetDemoPayments, resetDemoBills, resetDemoInvoices, resetDemoJournals, resetDemoAccounts, resetDemoPeriods, resetDemoTaxes, resetDemoContacts, resetDemoItems, resetDemoCurrencies]) reset();
  sessionStorage.clear();
});

describe('receipts', () => {
  it('records a payment from the invoice, which is then paid', async () => {
    renderApp('/invoices');
    await userEvent.click(await screen.findByRole('link', { name: /^INV\/.*\/0001$/ }, { timeout: 4000 }));
    await screen.findByRole('article', {}, { timeout: 4000 });
    const dialog = await openDialog('Record payment', 'Record a receipt');
    await waitFor(() => expect(within(dialog).getByLabelText('Amount (INR)')).toHaveValue('1,18,000.00'));
    expect(within(dialog).getByLabelText(/^Apply to INV\//)).toHaveValue('1,18,000.00');
    expect(within(dialog).getByRole('status')).toHaveTextContent('All of it is applied');
    await userEvent.type(within(dialog).getByLabelText('Reference'), 'UTR 402918');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record receipt' }));
    expect(await screen.findByText(/^Recorded as RCT\/.*\/0001$/, {}, { timeout: 4000 })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/Posted as/)).toHaveTextContent(/Paid by RCT\//), { timeout: 4000 });
    expect(screen.queryByRole('button', { name: 'Record payment' })).not.toBeInTheDocument();
  }, 20_000);

  it('records how it was paid: a cheque’s number, date and bank', async () => {
    renderApp('/invoices');
    await userEvent.click(await screen.findByRole('link', { name: /^INV\/.*\/0001$/ }, { timeout: 4000 }));
    await screen.findByRole('article', {}, { timeout: 4000 });
    const dialog = await openDialog('Record payment', 'Record a receipt');
    await waitFor(() => expect(within(dialog).getByLabelText('Amount (INR)')).toHaveValue('1,18,000.00'));
    await userEvent.selectOptions(within(dialog).getByLabelText('Paid by'), 'cheque');
    await userEvent.type(within(dialog).getByLabelText('Cheque or DD number'), '004512');
    await userEvent.type(within(dialog).getByLabelText('Drawn on (bank)'), 'HDFC Bank');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record receipt' }));
    expect(await screen.findByText(/^Recorded as RCT\/.*\/0001$/, {}, { timeout: 4000 })).toBeInTheDocument();
    const { createDemoPaymentsApi } = await import('./demoPaymentsApi');
    const list = await createDemoPaymentsApi(() => true).list({ page: 1, pageSize: 10 });
    expect(list.items[0]).toMatchObject({ mode: 'cheque', instrumentNo: '004512', drawnOn: 'HDFC Bank' });
  }, 20_000);

  it('records a receipt where the customer kept TDS back: the invoice is paid in full and the TDS is to claim back', async () => {
    renderApp('/invoices');
    await userEvent.click(await screen.findByRole('link', { name: /^INV\/.*\/0001$/ }, { timeout: 4000 }));
    await screen.findByRole('article', {}, { timeout: 4000 });
    const dialog = await openDialog('Record payment', 'Record a receipt');
    await waitFor(() => expect(within(dialog).getByLabelText('Amount (INR)')).toHaveValue('1,18,000.00'));
    // Kumar paid ₹1,08,000 and kept back 10% of the ₹1,00,000 under 194J
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Customer deducted TDS' }));
    await userEvent.selectOptions(within(dialog).getByLabelText('TDS section'), '194J');
    expect(within(dialog).getByLabelText('TDS on (INR)')).toHaveAttribute('placeholder', '1,00,000.00');
    expect(within(dialog).getByLabelText('TDS the customer kept back (INR)')).toHaveValue('10,000.00');
    expect(within(dialog).getByLabelText('Claim back on account')).toHaveDisplayValue('1500 · TDS receivable');
    expect(within(dialog).getByText(/^INR 1,08,000\.00 reaches the bank; INR 10,000\.00 is TDS the customer pays/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record receipt' }));
    expect(await screen.findByText(/^Recorded as RCT\/.*\/0001$/, {}, { timeout: 4000 })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Record payment' })).not.toBeInTheDocument(), { timeout: 4000 });

    document.body.innerHTML = '';
    renderApp('/reports?tab=tds&side=receivable');
    const bySection = await screen.findByRole('table', { name: 'By section' }, { timeout: 4000 });
    expect(within(bySection).getByText(/^194J/).closest('tr')!).toHaveTextContent(/1,00,000\.00.*10,000\.00/);
    expect(screen.getByRole('table', { name: 'Payments' })).toHaveTextContent('Kumar Logistics');
  }, 30_000);

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
    const kumar = (await screen.findByRole('link', { name: 'Kumar Logistics' }, { timeout: 4000 })).closest('li')!;
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

describe('vendor payments', () => {
  it('pays the rent bill from the bill, which is then paid, and lists it as money out', async () => {
    renderApp('/bills');
    await userEvent.click(await screen.findByRole('link', { name: /^BILL\/.*\/0001$/ }, { timeout: 4000 }));
    await screen.findByRole('article', {}, { timeout: 4000 });
    const dialog = await openDialog('Pay bill', 'Pay a vendor');
    await waitFor(() => expect(within(dialog).getByLabelText('Amount (INR)')).toHaveValue('53,100.00'));
    expect(within(dialog).getByLabelText(/^Apply to BILL\//)).toHaveValue('53,100.00');
    expect(within(dialog).getByText('SOS/887')).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText('Reference'), 'NEFT 88123');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record payment' }));
    expect(await screen.findByText(/^Recorded as PAY\/.*\/0001$/, {}, { timeout: 4000 })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/Posted as/)).toHaveTextContent(/Paid by PAY\//), { timeout: 4000 });
    expect(screen.queryByRole('button', { name: 'Pay bill' })).not.toBeInTheDocument();

    document.body.innerHTML = '';
    renderApp('/payments');
    const row = (await screen.findByText('Sharma Office Supplies', { selector: 'span.font-medium' }, { timeout: 4000 })).closest('li')!;
    expect(row).toHaveTextContent('−₹53,100.00');
    expect(row).toHaveTextContent(/Paid BILL\//);
    await userEvent.click(screen.getByRole('radio', { name: 'Received' }));
    await waitFor(() => expect(screen.queryByText('Sharma Office Supplies', { selector: 'span.font-medium' })).not.toBeInTheDocument());
  }, 30_000);

  it('keeps TDS back from a vendor payment: the bill is settled in full, the bank pays less, and the TDS report shows it', async () => {
    renderApp('/bills');
    await userEvent.click(await screen.findByRole('link', { name: /^BILL\/.*\/0001$/ }, { timeout: 4000 }));
    await screen.findByRole('article', {}, { timeout: 4000 });
    const dialog = await openDialog('Pay bill', 'Pay a vendor');
    await waitFor(() => expect(within(dialog).getByLabelText('Amount (INR)')).toHaveValue('53,100.00'));
    // Rent: TDS under 194I at 10% of the ₹45,000 before GST
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Deduct TDS' }));
    await userEvent.selectOptions(within(dialog).getByLabelText('TDS section'), '194I');
    expect(within(dialog).getByLabelText('Rate (%)')).toHaveValue('10');
    expect(within(dialog).getByLabelText('TDS on (INR)')).toHaveAttribute('placeholder', '45,000.00');
    expect(within(dialog).getByLabelText('TDS kept back (INR)')).toHaveValue('4,500.00');
    expect(within(dialog).getByLabelText('Owed on account')).toHaveDisplayValue('2300 · TDS payable');
    expect(within(dialog).getByText(/^The bank pays INR 48,600\.00; INR 4,500\.00 is owed to the government as TDS\./)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record payment' }));
    expect(await screen.findByText(/^Recorded as PAY\/.*\/0001$/, {}, { timeout: 4000 })).toBeInTheDocument();
    // Settled in full: nothing left to pay on the bill
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Pay bill' })).not.toBeInTheDocument(), { timeout: 4000 });

    document.body.innerHTML = '';
    renderApp('/payments');
    await waitFor(() => expect(screen.getByTestId('payment-tds')).toHaveTextContent('TDS 194I: ₹4,500.00 kept back · bank paid ₹48,600.00'), { timeout: 4000 });

    document.body.innerHTML = '';
    renderApp('/reports?tab=tds');
    const bySection = await screen.findByRole('table', { name: 'By section' }, { timeout: 4000 });
    expect(within(bySection).getByText(/^194I/).closest('tr')!).toHaveTextContent(/45,000\.00.*4,500\.00/);
    // Sharma's GSTIN carries the PAN
    expect(screen.getByRole('table', { name: 'Payments' })).toHaveTextContent('ABZPS6519M');
  }, 30_000);

  it('shows what is owed to a vendor on their contact', async () => {
    renderApp('/bills');
    await screen.findByRole('link', { name: /^BILL\// }, { timeout: 4000 });
    document.body.innerHTML = '';
    renderApp('/contacts');
    const sharma = (await screen.findByRole('link', { name: 'Sharma Office Supplies' }, { timeout: 4000 })).closest('li')!;
    await waitFor(() => expect(sharma).toHaveTextContent('We owe ₹53,100.00'));
  }, 20_000);

  it('gives a vendor a payment advice for what was paid', { timeout: 20_000 }, async () => {
    const { createDemoPaymentsApi } = await import('./demoPaymentsApi');
    const { sampleId } = await import('../accounts/demoAccountsApi');
    const { todayIn } = await import('@ledgernest/shared');
    const { demoContactRows } = await import('../contacts/demoContactsApi');
    const sharma = demoContactRows().find((c) => c.name === 'Sharma Office Supplies')!;
    const p = await createDemoPaymentsApi(() => true).pay({ contactId: sharma.id, date: todayIn('Asia/Kolkata'), bankAccountId: sampleId('1100.01'), amount: 10_000_00, allocations: [], reference: 'UTR 77120' });
    let saved: Blob | undefined;
    Object.assign(URL, { createObjectURL: vi.fn((b: Blob) => ((saved = b), 'blob:pdf')), revokeObjectURL: vi.fn() });
    renderApp('/payments');
    await waitFor(
      () => {
        if (!screen.queryByRole('menu')) fireEvent.click(screen.getByRole('button', { name: `Actions for ${p.number}` }));
        expect(screen.getByRole('menuitem', { name: 'Download payment advice' })).toBeInTheDocument();
      },
      { timeout: 6000 },
    );
    expect(screen.getByRole('menuitem', { name: 'Email payment advice' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Download payment advice' }));
    await waitFor(() => expect(saved).toBeDefined(), { timeout: 4000 });
    const text = new TextDecoder('latin1').decode(await saved!.arrayBuffer());
    expect(text).toContain(`(Payment advice ${p.number}) Tj`);
    expect(text).toContain('(Paid in advance) Tj');

    // And a message to send on WhatsApp
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    // Open the menu and pick the item in one retried step: the menu may still be closing from the download
    await waitFor(
      () => {
        const item = screen.queryByRole('menuitem', { name: 'Send on WhatsApp' });
        if (item) fireEvent.click(item);
        else if (!screen.queryByRole('menu')) fireEvent.click(screen.getByRole('button', { name: `Actions for ${p.number}` }));
        expect(open).toHaveBeenCalled();
      },
      { timeout: 6000 },
    );
    const url = String(open.mock.calls.at(-1)?.[0]);
    expect(decodeURIComponent(url.split('text=')[1]!)).toMatch(/^Dear Sharma Office Supplies, we have paid ₹10,000\.00 to your bank on .* \(ref UTR 77120\) against your account\./);
    open.mockRestore();
  });

  it('emails a customer a receipt for what they paid', { timeout: 20_000 }, async () => {
    // An advance from Kumar into the HDFC account, today
    const { createDemoPaymentsApi } = await import('./demoPaymentsApi');
    const { sampleId } = await import('../accounts/demoAccountsApi');
    const { todayIn } = await import('@ledgernest/shared');
    const r = await createDemoPaymentsApi(() => true).receive({ contactId: 'c0000000-0000-4000-8000-000000000001', date: todayIn('Asia/Kolkata'), bankAccountId: sampleId('1100.01'), amount: 50_000_00, allocations: [] });
    renderApp('/payments');
    await waitFor(
      () => {
        if (!screen.queryByRole('menu')) fireEvent.click(screen.getByRole('button', { name: `Actions for ${r.number}` }));
        expect(screen.getByRole('menuitem', { name: 'Email receipt' })).toBeInTheDocument();
      },
      { timeout: 6000 },
    );
    fireEvent.click(screen.getByRole('menuitem', { name: 'Email receipt' }));
    const dialog = await screen.findByRole('dialog', { name: `Email receipt ${r.number}` });
    // Blank: their email on file
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('In the demo nothing is really sent; it would go to accounts@kumarlogistics.in', {}, { timeout: 4000 })).toBeInTheDocument();
  });

  it('tracks a micro supplier’s bills against the 45-day rule, from the Udyam details on the vendor', async () => {
    renderApp('/contacts?type=vendor');
    await userEvent.click(await screen.findByRole('link', { name: 'Sharma Office Supplies' }, { timeout: 4000 }));
    const dialog = await openDialog('Edit', 'Edit Sharma Office Supplies');
    expect(within(dialog).getByLabelText('MSME (Udyam)')).toHaveDisplayValue('Micro enterprise');
    const udyam = within(dialog).getByLabelText('Udyam registration number');
    expect(udyam).toHaveValue('UDYAM-MH-26-0012345');
    await userEvent.clear(udyam);
    await userEvent.type(udyam, 'UDYAM-12');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    expect(await within(dialog).findByText('A Udyam number looks like UDYAM-MH-26-0012345.', {}, { timeout: 4000 })).toBeInTheDocument();

    // Two months after the bill, it's past the deadline
    cleanup();
    const today = new Date().toISOString().slice(0, 8);
    const later = new Date(`${today}03T00:00:00Z`);
    later.setUTCDate(later.getUTCDate() + 60);
    renderApp(`/reports?tab=msme&asOf=${later.toISOString().slice(0, 10)}`);
    const table = await screen.findByRole('table', { name: /Bills from micro and small suppliers/ }, { timeout: 4000 });
    const row = within(table).getByText('Sharma Office Supplies').closest('tr')!;
    expect(row).toHaveTextContent('Micro enterprise');
    expect(row).toHaveTextContent('Overdue');
    expect(screen.getByText('At risk under 43B(h)')).toBeInTheDocument();
  }, 30_000);
});
