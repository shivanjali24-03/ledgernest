import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import AppProviders from '../AppProviders';
import { resetDemoAccounts } from '../accounts/demoAccountsApi';
import { resetDemoContacts } from '../contacts/demoContactsApi';
import { resetDemoCurrencies } from '../currencies/demoCurrenciesApi';
import { resetDemoJournals } from '../journals/demoJournalsApi';
import { resetDemoPeriods } from '../periods/demoPeriodsApi';
import { routes } from '../routes';
import { resetDemoTaxes } from '../taxes/demoTaxesApi';
import { openDialog } from '../test/openDialog';
import { resetDemoBanking } from './demoBankingApi';

function renderApp(path = '/banking') {
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
const choose = async (scope: HTMLElement, label: string, text: string) => {
  const select = within(scope).getByLabelText(label) as HTMLSelectElement;
  await waitFor(() => expect([...select.options].some((o) => o.textContent === text)).toBe(true), { timeout: 4000 });
  await userEvent.selectOptions(select, [...select.options].find((o) => o.textContent === text)!.value);
};

beforeEach(() => {
  for (const reset of [resetDemoBanking, resetDemoJournals, resetDemoAccounts, resetDemoPeriods, resetDemoTaxes, resetDemoContacts, resetDemoCurrencies]) reset();
  sessionStorage.clear();
});

describe('banking', () => {
  it('shows each account with its balance, and a statement of what moved', async () => {
    renderApp();
    const accounts = await screen.findByRole('list', { name: 'Bank and cash accounts' }, { timeout: 4000 });
    const hdfc = within(accounts).getByRole('button', { name: /HDFC Bank current account/ });
    expect(hdfc).toHaveAttribute('aria-pressed', 'true');
    expect(within(accounts).getByRole('button', { name: /Wise USD account/ })).toHaveTextContent('USD');
    // Headings over sub-accounts aren't accounts to bank with
    expect(within(accounts).queryByRole('button', { name: /^1100 Bank accounts/ })).not.toBeInTheDocument();
    expect(await screen.findByText('HDFC Bank current account: statement', {}, { timeout: 4000 })).toBeInTheDocument();
  });

  it('spends money with GST, lists it, and voids it', async () => {
    renderApp();
    await screen.findByRole('list', { name: 'Bank and cash accounts' }, { timeout: 4000 });
    const dialog = await openDialog('Spend money', /^Money out that isn.t a bill/);
    await userEvent.type(within(dialog).getByLabelText('Description'), 'Bank charges, April');
    await choose(dialog, 'Account for line 1', '5900 · Bank charges');
    await userEvent.type(within(dialog).getByLabelText('Amount on line 1'), '500');
    await choose(dialog, 'Tax on line 1', 'GST 18%');
    await waitFor(() => expect(within(dialog).getByRole('status', { name: 'Totals' })).toHaveTextContent('INR 590.00'), { timeout: 4000 });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record spending' }));
    expect(await screen.findByText('Spent INR 590.00', {}, { timeout: 4000 })).toBeInTheDocument();
    const recorded = (await screen.findByText('Bank charges, April', { selector: 'span.block.truncate' }, { timeout: 4000 })).closest('li')!;
    expect(recorded).toHaveTextContent('−₹590.00');
    await userEvent.click(within(recorded).getByRole('button', { name: /^Actions for / }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Void' }));
    const confirm = (await screen.findByText(/^Its entry is reversed today/, {}, { timeout: 3000 })).closest('[role="dialog"]') as HTMLElement;
    await userEvent.click(within(confirm).getByRole('button', { name: 'Void' }));
    await waitFor(() => expect(screen.getByText('Bank charges, April', { selector: 'span.block.truncate' }).closest('li')!).toHaveTextContent('Void'), { timeout: 4000 });
  }, 30_000);

  it('moves cash to the petty cash box', async () => {
    renderApp();
    await screen.findByRole('list', { name: 'Bank and cash accounts' }, { timeout: 4000 });
    const dialog = await openDialog('Transfer', 'Transfer between accounts');
    await choose(dialog, 'To', '1200.01 · Petty cash – Pune office');
    await userEvent.type(within(dialog).getByLabelText('Amount sent (INR)'), '5000');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record transfer' }));
    expect(await screen.findByText('Moved from HDFC Bank current account to Petty cash – Pune office', {}, { timeout: 4000 })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('HDFC Bank current account → Petty cash – Pune office')).toBeInTheDocument(), { timeout: 4000 });
  }, 30_000);

  it('is read-only for Auditors', async () => {
    renderApp();
    await screen.findByRole('button', { name: 'Spend money' }, { timeout: 4000 });
    await previewAs('auditor');
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Spend money' })).not.toBeInTheDocument());
    expect(await screen.findByRole('list', { name: 'Bank and cash accounts' }, { timeout: 4000 })).toBeInTheDocument();
  });
});
