import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { todayIn, toBase } from '@ledgernest/shared';
import AppProviders from '../AppProviders';
import { resetDemoAccounts } from '../accounts/demoAccountsApi';
import { resetDemoJournals } from '../journals/demoJournalsApi';
import { resetDemoPeriods } from '../periods/demoPeriodsApi';
import { routes } from '../routes';
import { resetDemoTaxes } from '../taxes/demoTaxesApi';
import { demoRateOn, resetDemoCurrencies } from './demoCurrenciesApi';

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
const pick = (n: number, label: RegExp) => {
  const select = screen.getByLabelText(`Line ${n} account`) as HTMLSelectElement;
  return userEvent.selectOptions(select, [...select.options].find((o) => label.test(o.textContent ?? ''))!.value);
};
const ready = async () => {
  await screen.findByRole('heading', { name: 'New journal entry' });
  await waitFor(() => expect((screen.getByLabelText('Line 1 account') as HTMLSelectElement).options.length).toBeGreaterThan(10));
};
/** Writes and posts a two-line entry: a foreign line at a typed rate against a second line */
async function postEntry(memo: string, first: { account: RegExp; debit: string; rate: string }, second: { account: RegExp; credit: string; rate?: string }) {
  renderApp('/journals/new');
  await ready();
  await userEvent.type(screen.getByLabelText('Memo'), memo);
  await pick(1, first.account);
  await userEvent.type(screen.getByLabelText('Line 1 debit'), first.debit);
  await userEvent.type(await screen.findByLabelText('Line 1 rate for USD'), first.rate);
  await pick(2, second.account);
  await userEvent.type(screen.getByLabelText('Line 2 credit'), second.credit);
  if (second.rate) await userEvent.type(await screen.findByLabelText('Line 2 rate for USD'), second.rate);
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Balanced'));
  await userEvent.click(screen.getByRole('button', { name: 'Post' }));
  return screen.findByText(/^Posted as JV\//, {}, { timeout: 4000 });
}

beforeEach(() => {
  for (const reset of [resetDemoJournals, resetDemoAccounts, resetDemoPeriods, resetDemoTaxes, resetDemoCurrencies]) reset();
  sessionStorage.clear();
});

describe('foreign-currency entries', () => {
  it('enters a USD invoice in dollars, shows the rupee amount, and keeps both', async () => {
    await postEntry('Invoice to Northwind Inc.', { account: /Receivables – export clients/, debit: '1000', rate: '90' }, { account: /Export clients/, credit: '90000' });
    const usd = await screen.findByText('USD 1,000.00 at 90', {}, { timeout: 4000 });
    expect(usd.closest('tr')!).toHaveTextContent('90,000.00');
  });

  it("uses the day's rate when none is typed, and says when there is none", async () => {
    renderApp('/journals/new');
    await ready();
    await pick(1, /Receivables – export clients/);
    await userEvent.type(screen.getByLabelText('Line 1 debit'), '100');
    const rate = demoRateOn('USD', todayIn('Asia/Kolkata'))!;
    await waitFor(() => expect(screen.getByLabelText('Line 1 rate for USD')).toHaveAttribute('placeholder', rate));
    const base = toBase(10_000, rate, 2, 2);
    const row = screen.getByTestId('fx-row');
    await waitFor(() => expect(row).toHaveTextContent(new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2 }).format(base / 100)));
    // A day before any rate
    await userEvent.clear(screen.getByLabelText('Date'));
    await userEvent.type(screen.getByLabelText('Date'), '2020-01-01');
    expect(await screen.findByText(/No USD rate on or before 2020-01-01/)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('A foreign-currency line has no exchange rate for this date.');
  });

  it('realises the exchange gain when part of the receivable is collected', async () => {
    await postEntry('Invoice to Northwind Inc.', { account: /Receivables – export clients/, debit: '1000', rate: '90' }, { account: /Export clients/, credit: '90000' });
    await screen.findByText('USD 1,000.00 at 90', {}, { timeout: 4000 });
    document.body.innerHTML = '';
    // USD 400 booked at 90, collected at 93: ₹1,200 gained
    await postEntry('Part payment from Northwind', { account: /Wise USD account/, debit: '400', rate: '93' }, { account: /Receivables – export clients/, credit: '400', rate: '93' });
    const diff = await screen.findAllByText('Exchange difference on line 2', {}, { timeout: 4000 });
    expect(diff).toHaveLength(2);
    expect(diff[1]!.closest('tr')!).toHaveTextContent('Realised exchange gain or loss');
    expect(diff[1]!.closest('tr')!).toHaveTextContent('1,200.00');
  }, 20_000);

  it('revalues foreign balances from the Currencies page, and the ledger shows dollars', async () => {
    await postEntry('Invoice to Northwind Inc.', { account: /Receivables – export clients/, debit: '1000', rate: '90' }, { account: /Export clients/, credit: '90000' });
    await screen.findByText('USD 1,000.00 at 90', {}, { timeout: 4000 });
    document.body.innerHTML = '';
    renderApp('/currencies');
    await userEvent.click(await screen.findByRole('button', { name: 'Revalue balances' }));
    const dialog = await screen.findByRole('dialog', { name: 'Revalue foreign-currency balances' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Revalue' }));
    const rate = demoRateOn('USD', todayIn('Asia/Kolkata'))!;
    const after = toBase(100_000, rate, 2, 2);
    const row = (await within(dialog).findByRole('rowheader', { name: /Receivables – export clients/ }, { timeout: 4000 })).closest('tr')!;
    expect(row).toHaveTextContent(`USD 1,000.00 @ ${rate}`);
    expect(row).toHaveTextContent(new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2 }).format(after / 100));
    expect(within(dialog).getByRole('link', { name: /^JV\// })).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Done' }));

    document.body.innerHTML = '';
    renderApp('/reports?tab=ledger');
    const select = (await screen.findByRole('combobox', { name: 'Account' }, { timeout: 4000 })) as HTMLSelectElement;
    await waitFor(() => expect(select.options.length).toBeGreaterThan(10));
    await userEvent.selectOptions(select, [...select.options].find((o) => /Receivables – export clients/.test(o.textContent ?? ''))!.value);
    expect(await screen.findByRole('columnheader', { name: 'Balance (USD)' }, { timeout: 4000 })).toBeInTheDocument();
    expect(await screen.findByText('USD 1,000.00')).toBeInTheDocument();
  }, 20_000);
});
