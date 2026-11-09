import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import AppProviders from '../AppProviders';
import { resetDemoAccounts } from '../accounts/demoAccountsApi';
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
});
