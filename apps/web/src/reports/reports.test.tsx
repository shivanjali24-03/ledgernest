import { gstinCheckChar } from '@ledgernest/shared';
import { vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import AppProviders from '../AppProviders';
import { resetDemoAccounts } from '../accounts/demoAccountsApi';
import { demoBillViews, resetDemoBills } from '../bills/demoBillsApi';
import { resetDemoInvoices } from '../invoices/demoInvoicesApi';
import { resetDemoPayments } from '../payments/demoPaymentsApi';
import { resetDemoJournals } from '../journals/demoJournalsApi';
import { resetDemoPeriods } from '../periods/demoPeriodsApi';
import { routes } from '../routes';

function renderApp(path = '/reports') {
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
  resetDemoJournals();
  resetDemoAccounts();
  resetDemoPeriods();
  resetDemoInvoices();
  resetDemoBills();
  resetDemoPayments();
  sessionStorage.clear();
});

describe('reports', () => {
  it('shows a balanced trial balance from posted entries only', async () => {
    renderApp();
    expect(await screen.findByText('Debits equal credits', {}, { timeout: 4000 })).toBeInTheDocument();
    const receivable = (await screen.findByText('Accounts receivable')).closest('tr')!;
    // The draft receipt isn't posted, so the invoice is still owed in full
    expect(within(receivable).getAllByRole('cell')[0]).toHaveTextContent('1,18,000.00');
    // The AWS bill was reversed and re-posted: only the corrected amount remains
    const cloud = screen.getByText('Cloud hosting').closest('tr')!;
    expect(within(cloud).getAllByRole('cell')[0]).toHaveTextContent('38,200.00');
  });

  it("opens an account's ledger with a running balance, and links to each entry", async () => {
    const router = renderApp();
    await userEvent.click(await screen.findByRole('button', { name: /HDFC Bank current account/ }, { timeout: 4000 }));
    await waitFor(() => expect(router.state.location.search).toContain('tab=ledger'));
    const rent = (await screen.findByText('Office rent', {}, { timeout: 4000 })).closest('tr')!;
    expect(within(rent).getAllByRole('cell')[4]).toHaveTextContent('85,000.00');
    // 25,00,000 of capital came in first, then the rent went out
    expect(within(rent).getAllByRole('cell')[5]).toHaveTextContent('24,15,000.00');
    expect(within(rent).getByRole('link', { name: /^JV\// })).toBeInTheDocument();
  });

  it('lets Viewers read reports but not export them', async () => {
    renderApp();
    await screen.findByText('Debits equal credits', {}, { timeout: 4000 });
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeInTheDocument();
    await previewAs('viewer');
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Export CSV' })).not.toBeInTheDocument());
    expect(await screen.findByRole('heading', { name: 'Reports' })).toBeInTheDocument();
  });

  it('ages what customers owe, with each invoice on demand, and what we owe vendors', async () => {
    renderApp('/reports?tab=aging');
    const kumar = (await screen.findByRole('button', { name: /Kumar Logistics/ }, { timeout: 4000 })).closest('tr')!;
    expect(within(kumar).getAllByRole('cell').at(-1)).toHaveTextContent('1,18,000.00');
    expect(screen.getByText('Owed to us, net').closest('div')!).toHaveTextContent('₹1,18,000.00');
    await userEvent.click(within(kumar).getByRole('button', { name: /Kumar Logistics/ }));
    expect(screen.getByRole('link', { name: /^INV\/.*\/0001$/ })).toBeInTheDocument();
    // Before the invoice was issued, nobody owed anything
    fireEvent.change(screen.getByLabelText('As of'), { target: { value: '2020-01-01' } });
    expect(await screen.findByText('Nobody owes anything on this day', {}, { timeout: 4000 })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'We owe' }));
    expect(await screen.findByText('Nothing owed to vendors on this day', {}, { timeout: 4000 })).toBeInTheDocument();
  }, 20_000);

  it('makes a customer’s statement of account, and downloads it', async () => {
    const router = renderApp('/reports?tab=statement');
    expect(await screen.findByText('Choose a contact', { selector: 'h3, p, div' }, { timeout: 4000 })).toBeInTheDocument();
    const contact = screen.getByLabelText('Contact');
    await waitFor(() => expect(within(contact).getByRole('option', { name: 'Kumar Logistics' })).toBeInTheDocument(), { timeout: 4000 });
    await userEvent.selectOptions(contact, within(contact).getByRole('option', { name: 'Kumar Logistics' }));
    await waitFor(() => expect(router.state.location.search).toContain('contact='));
    const invoice = (await screen.findByRole('link', { name: /^INV\/.*\/0001$/ }, { timeout: 4000 })).closest('tr')!;
    expect(invoice).toHaveTextContent('Invoice');
    expect(within(invoice).getAllByRole('cell').at(-1)).toHaveTextContent('1,18,000.00');
    expect(screen.getByText(/^Balance carried down on/).closest('tr')!).toHaveTextContent('1,18,000.00');
    expect(screen.getByRole('button', { name: 'Download PDF' })).toBeInTheDocument();
    // Emailing it: the contact's address is filled in
    await userEvent.click(screen.getByRole('button', { name: 'Email' }));
    const dialog = await screen.findByRole('dialog', { name: 'Email the statement to Kumar Logistics' });
    expect(within(dialog).getByLabelText('Send to')).toHaveValue('accounts@kumarlogistics.in');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('In the demo nothing is really sent; it would go to accounts@kumarlogistics.in', {}, { timeout: 4000 })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    // Vendors list the vendors instead
    await userEvent.click(screen.getByRole('radio', { name: 'Vendors' }));
    await waitFor(() => expect(within(screen.getByLabelText('Contact')).getByRole('option', { name: 'Sharma Office Supplies' })).toBeInTheDocument(), { timeout: 4000 });
    expect(within(screen.getByLabelText('Contact')).queryByRole('option', { name: 'Kumar Logistics' })).not.toBeInTheDocument();
  }, 20_000);

  it('sums sales by customer and by item, and purchases by vendor', async () => {
    renderApp('/reports?tab=sales&from=2020-01-01');
    const table = await screen.findByRole('table', { name: 'Sales' }, { timeout: 4000 });
    // Kumar's invoice: ₹1,00,000 plus 18% GST
    const kumar = within(table).getByText('Kumar Logistics').closest('tr')!;
    expect(kumar).toHaveTextContent('1,18,000.00');
    await userEvent.click(screen.getByRole('radio', { name: 'Item' }));
    await waitFor(() => expect(within(screen.getByRole('table', { name: 'Sales' })).getByText('Software development')).toBeInTheDocument(), { timeout: 4000 });
    // The sample company's only bill is a draft: nothing recorded yet
    await userEvent.click(screen.getByRole('radio', { name: 'Purchases' }));
    expect(await screen.findByText('No purchases in these dates', {}, { timeout: 4000 })).toBeInTheDocument();
  }, 20_000);

  it('shows the profit and loss with its sub-totals, and a balance sheet that balances', async () => {
    renderApp('/reports?tab=pnl');
    const table = await screen.findByRole('table', { name: 'Profit and loss' }, { timeout: 4000 });
    // ₹1,00,000 of sales less ₹38,200 hosting is ₹61,800 gross; less rent and salaries, a loss
    expect(within(table).getByText('Gross profit').closest('tr')!).toHaveTextContent('61,800.00');
    expect(within(table).getByText('Net loss').closest('tr')!).toHaveTextContent(/4,43,200\.00/);
    // The reversed AWS bill and its reversal leave only the corrected one
    expect(within(table).getByRole('button', { name: /Cloud hosting/ }).closest('tr')!).toHaveTextContent('38,200.00');
    await userEvent.click(within(table).getByRole('button', { name: /Office rent/ }));
    expect(await screen.findByRole('tab', { name: 'General ledger', selected: true })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: 'Balance sheet' }));
    expect(await screen.findByText('Assets equal liabilities and equity', {}, { timeout: 4000 })).toBeInTheDocument();
    const bs = screen.getByRole('table', { name: 'Balance sheet' });
    expect(within(bs).getByText('Total assets').closest('tr')!).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('Compare with another date'));
    await waitFor(() => expect(within(screen.getByRole('table', { name: 'Balance sheet' })).getAllByRole('columnheader')).toHaveLength(4), { timeout: 4000 });
  }, 20_000);

  it('shows where the cash came from and went, both ways', async () => {
    renderApp('/reports?tab=cash-flow');
    const table = await screen.findByRole('table', { name: 'Cash flow' }, { timeout: 4000 });
    // The owners' capital came in and the rent went out: financing in, operating out
    const closing = within(table).getByText('Cash at the end').closest('tr')!.textContent!;
    expect(within(table).getByText('Cash from financing activities').closest('tr')!).toHaveTextContent('25,00,000.00');
    await userEvent.click(screen.getByRole('radio', { name: 'By what it was for' }));
    const direct = await screen.findByRole('table', { name: 'Cash flow' });
    await waitFor(() => expect(within(direct).getByText('Paid to vendors and for expenses').closest('tr')!).toHaveTextContent('85,000.00'));
    expect(within(direct).getByText('Cash at the end').closest('tr')!.textContent).toBe(closing);
  });

  it('shows GSTR-3B with the tax to pay, and GSTR-1 by buyer', async () => {
    renderApp('/reports?tab=gst');
    const outward = await screen.findByRole('table', { name: '3.1 Outward supplies' }, { timeout: 4000 });
    // The month's ₹1,00,000 sale within Maharashtra: ₹9,000 each of CGST and SGST, nothing to set off
    expect(within(outward).getByText('(a) Taxable outward supplies').closest('tr')!).toHaveTextContent(/1,00,000\.00.*9,000\.00.*9,000\.00/);
    expect(within(screen.getByRole('table', { name: '6.1 Payment of tax' })).getByText('Tax to pay in cash').closest('tr')!).toHaveTextContent('18,000.00');
    await userEvent.click(screen.getByRole('radio', { name: 'GSTR-1' }));
    const b2b = await screen.findByRole('table', { name: '4A B2B invoices' }, { timeout: 4000 });
    expect(within(b2b).getByText('Kumar Logistics').closest('tr')!).toHaveTextContent(/INV\/.*18%.*1,00,000\.00/);
    expect(screen.getByText(/^13 Documents issued/)).toBeInTheDocument();
  });

  it('matches GSTR-2B from the portal with the bills, and downloads the result', { timeout: 20_000 }, async () => {
    const today = new Date().toISOString().slice(0, 10);
    const billDay = `${today.slice(0, 8)}${String(Math.min(3, Number(today.slice(8)))).padStart(2, '0')}`;
    const dmy = (d: string) => d.split('-').reverse().join('-');
    const sharma = `27ABZPS6519M1Z${gstinCheckChar('27ABZPS6519M1Z')}`;
    const file = new File(
      [
        JSON.stringify({
          data: {
            gstin: '27AAPFN1234C1Z5',
            rtnprd: `${today.slice(5, 7)}${today.slice(0, 4)}`,
            docdata: {
              b2b: [
                {
                  ctin: sharma,
                  trdnm: 'SHARMA OFFICE SUPPLIES',
                  inv: [
                    // The month's rent bill, number written differently
                    { inum: 'SOS-887', dt: dmy(billDay), val: 53100, rev: 'N', itcavl: 'Y', items: [{ txval: 45000, igst: 0, cgst: 4050, sgst: 4050, cess: 0 }] },
                    // Filed by Sharma but never booked
                    { inum: 'SOS/901', dt: dmy(billDay), val: 1180, rev: 'N', itcavl: 'Y', items: [{ txval: 1000, igst: 0, cgst: 90, sgst: 90, cess: 0 }] },
                  ],
                },
              ],
            },
          },
        }),
      ],
      'gstr2b.json',
      { type: 'application/json' },
    );
    let saved: Blob | undefined;
    Object.assign(URL, { createObjectURL: vi.fn((b: Blob) => ((saved = b), 'blob:csv')), revokeObjectURL: vi.fn() });
    renderApp(`/reports?tab=gst&return=gstr-2b&from=${today.slice(0, 8)}01&to=${today}`);
    expect(await screen.findByText('Check your input tax credit before you file', {}, { timeout: 4000 })).toBeInTheDocument();
    await userEvent.upload(screen.getByLabelText('GSTR-2B JSON file'), new File(['nope'], 'x.json', { type: 'application/json' }));
    expect(await screen.findByText(/That file isn’t JSON/, {}, { timeout: 4000 })).toBeInTheDocument();
    await userEvent.upload(screen.getByLabelText('GSTR-2B JSON file'), file);
    const tiles = await screen.findByRole('group', { name: 'Summary' }, { timeout: 4000 });
    expect(within(tiles).getByRole('button', { name: /^Matched\s*1/ })).toBeInTheDocument();
    expect(within(tiles).getByRole('button', { name: /^Not in your books\s*1/ })).toBeInTheDocument();
    expect(screen.getByText('Every bill with GST in these dates was filed by its supplier.')).toBeInTheDocument();
    // Only what's missing from the books
    await userEvent.click(within(tiles).getByRole('button', { name: /^Not in your books/ }));
    const table = screen.getByRole('table', { name: 'GSTR-2B against the books' });
    expect(within(table).getAllByRole('row')).toHaveLength(2);
    expect(within(table).getByText('SOS/901')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Download CSV' }));
    const text = await saved!.text();
    expect(text).toContain('"Matched"');
    expect(text).toContain('"SOS-887"');
  });

  it('forecasts cash for 13 weeks from unpaid invoices and bills, week by week', { timeout: 20_000 }, async () => {
    // The month's rent bill, recorded as opening Bills would
    await demoBillViews();
    renderApp('/reports?tab=forecast');
    const table = await screen.findByRole('table', { name: 'Cash forecast by week' }, { timeout: 6000 });
    expect(within(table).getAllByRole('row')).toHaveLength(14);
    // Kumar's invoice comes in and the month's rent goes out
    expect(screen.getByText('Coming in, 13 weeks').closest('div')!.parentElement!).toHaveTextContent('₹1,18,000.00');
    expect(screen.getByText('Going out, 13 weeks').closest('div')!.parentElement!).toHaveTextContent('-₹53,100.00');
    // Open the weeks that hold something, and find the invoice in one of them
    for (const b of within(table).getAllByRole('button', { expanded: false })) fireEvent.click(b);
    expect(await within(table).findByRole('link', { name: /^INV\/.*\/0001$/ })).toHaveAttribute('href', expect.stringMatching(/^\/invoices\//));
    expect(within(table).getByRole('link', { name: 'SOS/887' })).toHaveAttribute('href', expect.stringMatching(/^\/bills\//));
  });

  it('downloads a report as Excel, and prints it with the organisation at the top', async () => {
    const saved: { name: string; type: string }[] = [];
    const create = vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => (saved.push({ name: '', type: (b as Blob).type }), 'blob:x'));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      saved[saved.length - 1]!.name = this.download;
    });
    renderApp('/reports?tab=pnl');
    await screen.findByRole('table', { name: 'Profit and loss' }, { timeout: 4000 });
    await userEvent.click(screen.getByRole('button', { name: 'Excel' }));
    await waitFor(() => expect(saved.at(-1)).toMatchObject({ type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', name: expect.stringMatching(/^profit-and-loss-.*\.xlsx$/) }));
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    await userEvent.click(screen.getByRole('button', { name: 'Print or PDF' }));
    expect(print).toHaveBeenCalled();
    expect(screen.getByText('Nest Demo Pvt. Ltd.', { selector: 'p' })).toBeInTheDocument();
    for (const m of [create, click, print]) m.mockRestore();
  });
});
