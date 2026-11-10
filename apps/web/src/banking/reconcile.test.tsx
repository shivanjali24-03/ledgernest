import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { todayIn } from '@ledgernest/shared';
import AppProviders from '../AppProviders';
import { resetDemoAccounts, sampleId } from '../accounts/demoAccountsApi';
import { resetDemoContacts } from '../contacts/demoContactsApi';
import { resetDemoCurrencies } from '../currencies/demoCurrenciesApi';
import { resetDemoJournals } from '../journals/demoJournalsApi';
import { resetDemoPeriods } from '../periods/demoPeriodsApi';
import { routes } from '../routes';
import { resetDemoTaxes } from '../taxes/demoTaxesApi';
import { createDemoBankingApi, resetDemoBanking } from './demoBankingApi';

const HDFC = sampleId('1100.01');
const today = todayIn('Asia/Kolkata');
// The demo pays the month's rent on the 3rd (or today, early in the month)
const rentDay = `${today.slice(0, 8)}${String(Math.min(3, Number(today.slice(8)))).padStart(2, '0')}`;
const dmy = (iso: string) => `${iso.slice(8)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

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
const choose = async (scope: HTMLElement, label: string, text: string) => {
  const select = within(scope).getByLabelText(label) as HTMLSelectElement;
  await waitFor(() => expect([...select.options].some((o) => o.textContent === text)).toBe(true), { timeout: 4000 });
  await userEvent.selectOptions(select, [...select.options].find((o) => o.textContent === text)!.value);
};

beforeEach(() => {
  for (const reset of [resetDemoBanking, resetDemoJournals, resetDemoAccounts, resetDemoPeriods, resetDemoTaxes, resetDemoContacts, resetDemoCurrencies]) reset();
  sessionStorage.clear();
});

describe('reconciliation', () => {
  it('matches the suggestion, records the missing bank charge, and reconciles', async () => {
    const csv = ['Date,Narration,Withdrawal,Deposit', `${dmy(rentDay)},OFFICE RENT RENT-NOV,"85,000.00",`, `${dmy(today)},CHARGES INCL GST,118.00,`].join('\n');
    await createDemoBankingApi(() => true).importStatement({ bankAccountId: HDFC, fileName: 'hdfc.csv', content: csv });
    renderApp(`/banking/reconcile/${HDFC}`);
    expect(await screen.findByRole('heading', { name: 'Reconcile HDFC Bank current account' }, { timeout: 4000 })).toBeInTheDocument();
    expect(await screen.findByText('From the bank (2)', {}, { timeout: 4000 })).toBeInTheDocument();
    const rent = screen.getByText('OFFICE RENT RENT-NOV').closest('li')!;
    expect(within(rent).getByText('Likely match')).toBeInTheDocument();
    await userEvent.click(within(rent).getByRole('button', { name: 'Match' }));
    await waitFor(() => expect(screen.getByText('From the bank (1)')).toBeInTheDocument(), { timeout: 4000 });

    const charges = screen.getByText('CHARGES INCL GST').closest('li')!;
    await userEvent.click(within(charges).getByRole('button', { name: 'Record it' }));
    await choose(charges, 'Account for the new entry', '5900 · Bank charges');
    await choose(charges, 'Tax on the new entry', 'GST 18%');
    await userEvent.click(within(charges).getByRole('button', { name: 'Record and match' }));
    expect(await screen.findByText('Every bank line is dealt with', {}, { timeout: 10_000 })).toBeInTheDocument();
    expect(screen.getByText('Matched, not yet reconciled').closest('div')!).toHaveTextContent('OFFICE RENT RENT-NOV');

    // Enter the statement balance the bank shows: the cleared figure
    const where = screen.getByLabelText('Where the account stands');
    const cleared = within(where).getByText('The bank should show').nextElementSibling!.textContent!;
    await userEvent.type(screen.getByLabelText('Statement balance (INR)'), cleared);
    await waitFor(() => expect(within(where).getByRole('status')).toHaveTextContent('0.00'), { timeout: 4000 });
    expect(within(where).getByText('The books agree with the statement')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Reconcile' }));
    expect(await screen.findByText(/^Reconciled to /, {}, { timeout: 10_000 })).toBeInTheDocument();
    // It's in the history, and the latest can be undone
    await waitFor(() => expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument(), { timeout: 4000 });
  }, 45_000);

  it('suggests the account a line like it went to last time', async () => {
    const csv = ['Date,Narration,Withdrawal,Deposit', `${dmy(today)},CHARGES INCL GST 0525,118.00,`, `${dmy(today)},CHARGES INCL GST 0625,236.00,`].join('\n');
    const api = createDemoBankingApi(() => true);
    await api.importStatement({ bankAccountId: HDFC, fileName: 'hdfc.csv', content: csv });
    const ws = await api.reconcileWorkspace(HDFC, today);
    const first = ws.bankLines.find((l) => l.description.endsWith('0525'))!;
    await api.createFromLine({ statementLineId: first.id, accountId: sampleId('5900'), taxGroupId: null, description: null });
    renderApp(`/banking/reconcile/${HDFC}`);
    const line = (await screen.findByText('CHARGES INCL GST 0625', {}, { timeout: 4000 })).closest('li')!;
    expect(within(line).getByTestId('line-hint')).toHaveTextContent('Last time a line like this went to 5900 · Bank charges');
    await userEvent.click(within(line).getByRole('button', { name: 'Record it' }));
    expect((within(line).getByLabelText('Account for the new entry') as HTMLSelectElement).value).toBe(sampleId('5900'));
  }, 20_000);

  it('is read-only without the right to reconcile', async () => {
    const csv = ['Date,Narration,Withdrawal,Deposit', `${dmy(rentDay)},OFFICE RENT RENT-NOV,"85,000.00",`].join('\n');
    await createDemoBankingApi(() => true).importStatement({ bankAccountId: HDFC, fileName: 'hdfc.csv', content: csv });
    renderApp(`/banking/reconcile/${HDFC}`);
    await screen.findByText('From the bank (1)', {}, { timeout: 4000 });
    await userEvent.selectOptions(screen.getByLabelText('Preview the app as a role'), 'auditor');
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Match' })).not.toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Reconcile' })).not.toBeInTheDocument();
  }, 20_000);
});
