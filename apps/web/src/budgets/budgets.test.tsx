import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import AppProviders from '../AppProviders';
import { resetDemoAccounts } from '../accounts/demoAccountsApi';
import { resetDemoJournals } from '../journals/demoJournalsApi';
import { resetDemoPeriods } from '../periods/demoPeriodsApi';
import { routes } from '../routes';
import { openDialog } from '../test/openDialog';
import { resetDemoBudgets } from './demoBudgetsApi';

function renderApp(path = '/budgets') {
  sessionStorage.setItem('ledgernest.demo', 'admin@ledgernest.demo');
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <AppProviders client={null}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return router;
}

beforeEach(() => {
  for (const reset of [resetDemoBudgets, resetDemoJournals, resetDemoAccounts, resetDemoPeriods]) reset();
  sessionStorage.clear();
});

describe('budgets', () => {
  it('starts a blank budget, spreads a year’s total over the months, and compares it with actuals', async () => {
    renderApp();
    expect(await screen.findByText('No budgets yet', {}, { timeout: 4000 })).toBeInTheDocument();
    const dialog = await openDialog('New budget', /^A plan for a financial year/);
    await waitFor(() => expect((within(dialog).getByLabelText('Financial year') as HTMLSelectElement).value).not.toBe(''), { timeout: 4000 });
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Lean plan');
    await userEvent.selectOptions(within(dialog).getByLabelText('Start from'), 'empty');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create budget' }));
    expect(await screen.findByText('Lean plan created', {}, { timeout: 4000 })).toBeInTheDocument();

    const total = (await screen.findAllByLabelText(/^4\d{3} · .*, year total$/, {}, { timeout: 4000 }))[0]!;
    const account = total.getAttribute('aria-label')!.replace(/, year total$/, '');
    await userEvent.type(total, '120000');
    fireEvent.blur(total);
    const cells = await screen.findAllByLabelText(new RegExp(`^${account.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}, `));
    await waitFor(() => expect(cells[0]).toHaveValue('10,000.00'));
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Lean plan saved', {}, { timeout: 4000 })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: 'Budget vs actual' }));
    const row = (await screen.findByText(account.split(' · ')[1]!, { selector: 'th[scope="row"]' }, { timeout: 4000 })).closest('tr')!;
    expect(row).toHaveTextContent(/\d/);
    expect(screen.getByRole('columnheader', { name: 'Variance' })).toBeInTheDocument();
  }, 30_000);

  it('is read-only for Viewers', async () => {
    renderApp();
    const dialog = await openDialog('New budget', /^A plan for a financial year/);
    await waitFor(() => expect((within(dialog).getByLabelText('Financial year') as HTMLSelectElement).value).not.toBe(''), { timeout: 4000 });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create budget' }));
    await screen.findAllByLabelText(/, year total$/, {}, { timeout: 4000 });
    await userEvent.selectOptions(screen.getByLabelText('Preview the app as a role'), 'viewer');
    await waitFor(() => expect(screen.queryByRole('button', { name: 'New budget' })).not.toBeInTheDocument());
    expect(screen.queryAllByLabelText(/, year total$/)).toHaveLength(0);
  }, 30_000);
});
