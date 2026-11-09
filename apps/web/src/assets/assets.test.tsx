import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { depreciationFor, fiscalYearOf, fiscalYearSpan, todayIn } from '@ledgernest/shared';
import AppProviders from '../AppProviders';
import { resetDemoAccounts } from '../accounts/demoAccountsApi';
import { resetDemoJournals } from '../journals/demoJournalsApi';
import { resetDemoPeriods } from '../periods/demoPeriodsApi';
import { routes } from '../routes';
import { openDialog } from '../test/openDialog';
import { resetDemoAssets } from './demoAssetsApi';

function renderApp(path = '/fixed-assets') {
  sessionStorage.setItem('ledgernest.demo', 'admin@ledgernest.demo');
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <AppProviders client={null}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return router;
}
const inr = (minor: number) => new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(minor / 100);

beforeEach(() => {
  for (const reset of [resetDemoAssets, resetDemoJournals, resetDemoAccounts, resetDemoPeriods]) reset();
  sessionStorage.clear();
});

describe('fixed assets', () => {
  it('runs depreciation to last month’s end, then undoes it', async () => {
    const today = todayIn('Asia/Kolkata');
    const yearStart = fiscalYearSpan(fiscalYearOf(today, 4), 4).startDate;
    const lastMonthEnd = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, 0)).toISOString().slice(0, 10);
    const expected = depreciationFor({ method: 'straight_line', cost: 21_600_000, residual: 0, accumulated: 0, usefulLifeMonths: 36, wdvRatePpm: null }, yearStart, lastMonthEnd);
    renderApp();
    const register = await screen.findByRole('table', { name: 'Register' }, { timeout: 4000 });
    expect(within(register).getByText('Dell Latitude laptops (3)').closest('tr')!).toHaveTextContent('2,16,000.00');
    const dialog = await openDialog('Run depreciation', /^Charge each asset from the day after/);
    if (!expected) return; // the first month of a financial year: nothing has worn down yet
    const post = await within(dialog).findByRole('button', { name: `Post ₹${inr(expected)}` }, { timeout: 4000 });
    await userEvent.click(post);
    expect(await screen.findByText(/of depreciation posted to/, {}, { timeout: 4000 })).toBeInTheDocument();
    await waitFor(() => expect(within(screen.getByRole('table', { name: 'Register' })).getByText('Dell Latitude laptops (3)').closest('tr')!).toHaveTextContent(inr(21_600_000 - expected)), { timeout: 4000 });
    // The undo button appears once the run's summary has re-rendered
    await userEvent.click(await screen.findByRole('button', { name: /^Undo the run to / }, { timeout: 4000 }));
    await waitFor(() => expect(screen.getByText('No depreciation charged yet.')).toBeInTheDocument(), { timeout: 4000 });
  }, 30_000);

  it('adds an asset with its accounts worked out, and is read-only for Viewers', async () => {
    renderApp();
    const dialog = await openDialog('Add asset', 'Add a fixed asset');
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Conference table');
    await userEvent.type(within(dialog).getByLabelText('Cost (INR)'), '48000');
    await userEvent.clear(within(dialog).getByLabelText('Useful life (months)'));
    await userEvent.type(within(dialog).getByLabelText('Useful life (months)'), '96');
    await waitFor(() => expect(within(dialog).getByLabelText('Depreciation expense account')).toHaveDisplayValue('5700 · Depreciation'), { timeout: 4000 });
    expect(within(dialog).getByLabelText('Accumulated depreciation account')).toHaveDisplayValue('1790 · Accumulated depreciation');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add asset' }));
    expect(await screen.findByText('FA-0002 Conference table added', {}, { timeout: 4000 })).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Preview the app as a role'), 'viewer');
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Add asset' })).not.toBeInTheDocument());
  }, 30_000);
});
