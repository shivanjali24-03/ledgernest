import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import AppProviders from '../AppProviders';
import { resetDemoAccounts } from '../accounts/demoAccountsApi';
import { resetDemoBills } from '../bills/demoBillsApi';
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
});
