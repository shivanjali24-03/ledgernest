import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
import { resetDemoBills } from './demoBillsApi';
import { resetDemoRecurringBills } from '../recurring-bills/demoRecurringBillsApi';

function renderApp(path = '/bills') {
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
const choose = async (label: string, text: string) => {
  const select = screen.getByLabelText(label) as HTMLSelectElement;
  await waitFor(() => expect([...select.options].some((o) => o.textContent === text)).toBe(true));
  await userEvent.selectOptions(select, [...select.options].find((o) => o.textContent === text)!.value);
};

beforeEach(() => {
  for (const reset of [resetDemoRecurringBills, resetDemoBills, resetDemoJournals, resetDemoAccounts, resetDemoPeriods, resetDemoTaxes, resetDemoContacts, resetDemoItems, resetDemoCurrencies]) reset();
  sessionStorage.clear();
});

describe('bills', () => {
  it('lists the month’s rent bill to pay and a draft in US dollars', async () => {
    renderApp();
    const rent = (await screen.findByRole('link', { name: /^BILL\/.*\/0001$/ }, { timeout: 4000 })).closest('tr')!;
    // ₹45,000 rent with CGST + SGST at 9% each
    expect(rent).toHaveTextContent('Sharma Office Supplies');
    expect(rent).toHaveTextContent('SOS/887');
    expect(within(rent).getAllByText('₹53,100.00')).toHaveLength(2);
    expect(screen.getByRole('link', { name: 'Draft' }).closest('tr')!).toHaveTextContent('Amazon Web Services');
    expect(screen.getByText('To pay', { selector: 'dt' }).closest('div')!).toHaveTextContent('₹53,100.00');
  });

  it('records a bill: input GST worked out per line, and an account for each', async () => {
    renderApp('/bills/new');
    await screen.findByRole('heading', { name: 'New bill' });
    await choose('Vendor', 'Sharma Office Supplies');
    await userEvent.type(screen.getByLabelText('Vendor’s bill number'), 'SOS/912');
    await userEvent.type(screen.getByLabelText('Description on line 1'), 'Printer paper and toner');
    await userEvent.type(screen.getByLabelText('Price on line 1'), '6000');
    await choose('Tax on line 1', 'GST 18%');
    await waitFor(() => expect(totals()).toHaveTextContent('CGST 9%'));
    expect(totals()).toHaveTextContent('₹7,080.00');
    // Without an account it can't be recorded
    expect(screen.getByRole('button', { name: 'Record bill' })).toBeDisabled();
    await choose('Account for line 1', '5300 · Office rent');
    await userEvent.click(screen.getByRole('button', { name: 'Record bill' }));
    expect(await screen.findByText(/^Recorded as BILL\/.*\/0002$/, {}, { timeout: 4000 })).toBeInTheDocument();
    const doc = await screen.findByRole('article', {}, { timeout: 4000 });
    expect(doc).toHaveTextContent('SOS/912');
    expect(doc).toHaveTextContent('5300 · Office rent');
    expect(doc).toHaveTextContent('₹7,080.00');
    await waitFor(() => expect(screen.getByText(/Posted as/).querySelector('a')?.textContent ?? screen.getByText(/Posted as/).parentElement!.querySelector('a')!.textContent).toMatch(/^JV\//));
  }, 20_000);

  it('asks before recording the same vendor bill number twice', async () => {
    renderApp('/bills/new');
    await screen.findByRole('heading', { name: 'New bill' });
    await choose('Vendor', 'Sharma Office Supplies');
    // Already recorded in the demo as SOS/887, typed a little differently
    await userEvent.type(screen.getByLabelText('Vendor’s bill number'), 'sos 0887');
    await userEvent.type(screen.getByLabelText('Description on line 1'), 'Office rent');
    await userEvent.type(screen.getByLabelText('Price on line 1'), '45000');
    await choose('Account for line 1', '5300 · Office rent');
    await userEvent.click(screen.getByRole('button', { name: 'Record bill' }));
    const dialog = await screen.findByRole('dialog', { name: 'Record this bill again?' }, { timeout: 6000 });
    expect(dialog).toHaveTextContent(/The vendor’s bill sos 0887 is recorded already as BILL\/.*\/0001/);
    // The draft was saved; its page warns too
    expect(await screen.findByText('This may be a bill you’ve entered already:', {}, { timeout: 6000 })).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record anyway' }));
    expect(await screen.findByText(/^Recorded as BILL\/.*\/0002$/, {}, { timeout: 6000 })).toBeInTheDocument();
    // One bill, recorded: no second draft left behind by the retry
    const { demoStoredBillViews } = await import('./demoBillsApi');
    expect(demoStoredBillViews().filter((b) => b.vendorReference === 'sos 0887').map((b) => b.status)).toEqual(['open']);
  }, 30_000);

  it('keeps the date on the vendor’s bill apart from the day it’s entered, with terms running from it', async () => {
    renderApp('/bills/new');
    await screen.findByRole('heading', { name: 'New bill' });
    await choose('Vendor', 'Sharma Office Supplies');
    fireEvent.change(screen.getByLabelText('Bill date'), { target: { value: '2026-10-24' } });
    fireEvent.change(screen.getByLabelText('Vendor’s bill date'), { target: { value: '2026-10-21' } });
    // Sharma gives 7 days, from their own date
    expect(screen.getByLabelText('Due date')).toHaveValue('2026-10-28');
    await userEvent.type(screen.getByLabelText('Vendor’s bill number'), 'SOS/950');
    await userEvent.type(screen.getByLabelText('Description on line 1'), 'Toner');
    await userEvent.type(screen.getByLabelText('Price on line 1'), '1000');
    await choose('Account for line 1', '5300 · Office rent');
    await userEvent.click(screen.getByRole('button', { name: 'Record bill' }));
    await screen.findByRole('article', {}, { timeout: 6000 });
    // The page can re-render once recorded: look again each time
    await waitFor(() => expect(within(screen.getByRole('article')).getByText('Vendor’s bill date')).toBeInTheDocument());
    const { demoStoredBillViews } = await import('./demoBillsApi');
    expect(demoStoredBillViews().find((b) => b.vendorReference === 'SOS/950')).toMatchObject({ vendorBillDate: '2026-10-21', billDate: '2026-10-24', dueDate: '2026-10-28' });
  }, 30_000);

  it('voids an unpaid bill', { timeout: 20_000 }, async () => {
    renderApp();
    await userEvent.click(await screen.findByRole('link', { name: /^BILL\/.*\/0001$/ }, { timeout: 4000 }));
    await screen.findByRole('article', {}, { timeout: 4000 });
    await waitFor(
      () => {
        if (!screen.queryByText(/^Its entry is reversed/)) fireEvent.click(screen.getByRole('button', { name: 'Void bill' }));
        const dialog = screen.getByText(/^Its entry is reversed/).closest('[role="dialog"]') as HTMLElement;
        fireEvent.click(within(dialog).getByRole('button', { name: 'Void bill' }));
      },
      { timeout: 6000 },
    );
    await waitFor(() => expect(screen.getByText(/Posted as/)).toHaveTextContent(/Voided by JV\//), { timeout: 8000 });
  });

  it('makes the rent recurring, then makes the bills as they fall due', { timeout: 30_000 }, async () => {
    const router = renderApp();
    await userEvent.click(await screen.findByRole('link', { name: /^BILL\/.*\/0001$/ }, { timeout: 4000 }));
    await screen.findByRole('article', {}, { timeout: 4000 });
    // Open the dialog and create in one step, retried, as the header re-renders while the bill loads
    let created = false;
    await waitFor(
      () => {
        if (created) return;
        if (!screen.queryByRole('dialog')) fireEvent.click(screen.getByRole('button', { name: 'Make recurring' }));
        const dialog = screen.getByRole('dialog', { name: 'Make this bill recurring' });
        expect((within(dialog).getByLabelText('Name') as HTMLInputElement).value).toMatch(/^Sharma Office Supplies · /);
        fireEvent.click(within(dialog).getByRole('button', { name: 'Create schedule' }));
        created = true;
      },
      { timeout: 8000 },
    );
    expect(await screen.findByText(/ scheduled$/, {}, { timeout: 4000 })).toBeInTheDocument();
    await router.navigate('/recurring-bills');
    // Found afresh each try: the page can remount as it loads
    await waitFor(() => expect(screen.getByText('Sharma Office Supplies', { selector: 'span[dir="auto"]' })).toBeInTheDocument(), { timeout: 6000 });
    await screen.findByRole('button', { name: 'Run now' }, { timeout: 4000 });
    // Pressed until the schedule lists the bill it made: a press can land while the page re-renders, and running
    // twice on one day makes nothing more (the list is more lasting than the toast, which can come and go)
    await waitFor(
      () => {
        if (!screen.queryByText('Made:')) {
          const run = screen.getByRole('button', { name: 'Run now' });
          if (!run.hasAttribute('disabled')) fireEvent.click(run);
        }
        expect(screen.getByText('Made:')).toBeInTheDocument();
      },
      { timeout: 12_000, interval: 400 },
    );
  });

  it('opens with the filter from the address, as the dashboard links it', async () => {
    renderApp('/bills?state=draft');
    expect(await screen.findByRole('radio', { name: 'Drafts' }, { timeout: 4000 })).toBeChecked();
  });

  it('is read-only for Auditors', async () => {
    renderApp();
    await screen.findByRole('link', { name: /^BILL\// }, { timeout: 4000 });
    await previewAs('auditor');
    await waitFor(() => expect(screen.queryByRole('button', { name: 'New bill' })).not.toBeInTheDocument());
  });

  it('pays GST itself under reverse charge: none to the vendor, a self invoice when they aren’t registered', async () => {
    const { createDemoBillsApi } = await import('./demoBillsApi');
    const { demoContactRows } = await import('../contacts/demoContactsApi');
    const { demoTaxState } = await import('../taxes/demoTaxesApi');
    const { sampleId } = await import('../accounts/demoAccountsApi');
    const api = createDemoBillsApi(() => true);
    const gst18 = demoTaxState().groups.find((g) => g.name === 'GST 18%')!.id;
    const line = { description: 'Design tool subscription', quantity: '1', unitPrice: 100_00, taxGroupId: gst18, accountId: sampleId('5300') };
    const { createDemoContactsApi } = await import('../contacts/demoContactsApi');
    const lawyer = await createDemoContactsApi(() => true).create({ name: 'Adv. R. Kulkarni', isCustomer: false, isVendor: true, billingAddress: { line1: null, line2: null, city: 'Pune', region: 'Maharashtra', postalCode: null, country: 'IN' } });
    const today = new Date().toISOString().slice(0, 10);
    const d = await api.create({ contactId: lawyer.id, billDate: today, reverseCharge: true, vendorReference: 'RK-1', lines: [line] });
    // The vendor charges none; we pay CGST + SGST ourselves
    expect(d).toMatchObject({ reverseCharge: true, taxTotal: 0, total: 100_00 });
    expect(d.lines[0]!.taxGroup).toBeNull();
    expect(d.lines[0]!.rcmTaxGroup?.name).toBe('GST 18%');
    expect(d.reverseChargeTax).toEqual([
      { name: 'CGST 9%', amount: 9_00 },
      { name: 'SGST 9%', amount: 9_00 },
    ]);
    const rec = await api.record(d.id);
    expect(rec.selfInvoiceNumber).toMatch(/^SI\/\d{4}-\d{2}\/0001$/);
    const pdf = await api.selfInvoice(d.id);
    expect(pdf.filename).toMatch(/^self-invoice-si-/);
    const sharma = demoContactRows().find((c) => c.name === 'Sharma Office Supplies')!;
    const local = await api.record((await api.create({ contactId: sharma.id, billDate: today, reverseCharge: true, vendorReference: 'SOS-RCM', lines: [line] })).id);
    // A registered vendor issues its own invoice
    expect(local.selfInvoiceNumber).toBeNull();
    expect(local.reverseChargeTax).toEqual([
      { name: 'CGST 9%', amount: 9_00 },
      { name: 'SGST 9%', amount: 9_00 },
    ]);
  }, 30_000);

  it('shows the GST paid under reverse charge apart from the total', async () => {
    renderApp('/bills/new');
    await screen.findByRole('heading', { name: 'New bill' });
    await choose('Vendor', 'Sharma Office Supplies');
    await userEvent.type(screen.getByLabelText('Description on line 1'), 'Transport');
    await userEvent.type(screen.getByLabelText('Price on line 1'), '1000');
    await choose('Tax on line 1', 'GST 18%');
    await userEvent.click(screen.getByRole('checkbox', { name: /We pay GST/ }));
    await waitFor(() => expect(totals()).toHaveTextContent('GST we pay under reverse charge'));
    expect(totals()).toHaveTextContent('₹1,000.00');
    expect(totals()).not.toHaveTextContent('CGST 9%');
  }, 20_000);

  it('books GST it can’t claim as cost: a blocked item, or a line marked ineligible', async () => {
    const { createDemoBillsApi } = await import('./demoBillsApi');
    const { demoContactRows } = await import('../contacts/demoContactsApi');
    const { demoTaxState } = await import('../taxes/demoTaxesApi');
    const { sampleId } = await import('../accounts/demoAccountsApi');
    const { createDemoJournalsApi } = await import('../journals/demoJournalsApi');
    const api = createDemoBillsApi(() => true);
    const gst18 = demoTaxState().groups.find((g) => g.name === 'GST 18%')!.id;
    const sharma = demoContactRows().find((c) => c.name === 'Sharma Office Supplies')!;
    const today = new Date().toISOString().slice(0, 10);
    const d = await api.create({ contactId: sharma.id, billDate: today, vendorReference: 'SOS-GIFT', lines: [{ description: 'Diwali gifts', quantity: '1', unitPrice: 1_000_00, taxGroupId: gst18, accountId: sampleId('5300'), itc: 'ineligible' }] });
    expect(d.lines[0]!.itc).toBe('ineligible');
    expect(d.total).toBe(1_180_00);
    const rec = await api.record(d.id);
    const entry = await createDemoJournalsApi(() => true).get(rec.journalEntry!.id);
    // One cost line with the GST in it, against the vendor: no input credit
    expect(entry.lines.filter((l) => l.debit > 0).map((l) => l.debit)).toEqual([1_180_00]);
  }, 30_000);

  it('asks about input credit on a taxed line', async () => {
    renderApp('/bills/new');
    await screen.findByRole('heading', { name: 'New bill' });
    await choose('Vendor', 'Sharma Office Supplies');
    await userEvent.type(screen.getByLabelText('Description on line 1'), 'Gifts');
    await userEvent.type(screen.getByLabelText('Price on line 1'), '1000');
    await choose('Tax on line 1', 'GST 18%');
    await userEvent.selectOptions(await screen.findByLabelText('Input tax credit on line 1'), 'blocked');
    expect(screen.getByLabelText('Input tax credit on line 1')).toHaveValue('blocked');
  }, 20_000);

  it('records a bill of entry: customs is owed the duties and IGST, not the goods’ value', async () => {
    const { createDemoBillsApi } = await import('./demoBillsApi');
    const { createDemoContactsApi } = await import('../contacts/demoContactsApi');
    const { demoTaxState } = await import('../taxes/demoTaxesApi');
    const { sampleId } = await import('../accounts/demoAccountsApi');
    const { createDemoJournalsApi } = await import('../journals/demoJournalsApi');
    const customs = await createDemoContactsApi(() => true).create({ name: 'Commissioner of Customs', isCustomer: false, isVendor: true });
    const gst18 = demoTaxState().groups.find((g) => g.name === 'GST 18%')!.id;
    const api = createDemoBillsApi(() => true);
    const today = new Date().toISOString().slice(0, 10);
    const d = await api.create({ contactId: customs.id, billDate: today, vendorReference: 'BE 7654321', billOfEntry: { number: '7654321', date: today, portCode: 'INNSA1' }, lines: [{ description: 'Value for IGST', quantity: '1', unitPrice: 1_10_000_00, taxGroupId: gst18, accountId: sampleId('5300') }, { description: 'Basic customs duty', quantity: '1', unitPrice: 10_000_00, taxGroupId: null, accountId: sampleId('5300') }] });
    expect(d.lines[0]!.taxGroup?.name).toBe('IGST 18%');
    expect(d).toMatchObject({ subtotal: 10_000_00, taxTotal: 19_800_00, total: 29_800_00 });
    const rec = await api.record(d.id);
    const entry = await createDemoJournalsApi(() => true).get(rec.journalEntry!.id);
    expect(entry.lines.reduce((s, l) => s + l.debit, 0)).toBe(entry.lines.reduce((s, l) => s + l.credit, 0));
  }, 30_000);
});
