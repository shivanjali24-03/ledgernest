import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import AppProviders from '../AppProviders';
import { resetDemoAccounts } from '../accounts/demoAccountsApi';
import { resetDemoInvoices } from '../invoices/demoInvoicesApi';
import { resetDemoJournals } from '../journals/demoJournalsApi';
import { resetDemoPeriods } from '../periods/demoPeriodsApi';
import { routes } from '../routes';

function renderApp(path = '/') {
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
  for (const reset of [resetDemoJournals, resetDemoAccounts, resetDemoPeriods, resetDemoInvoices]) reset();
  sessionStorage.clear();
});

describe('dashboard', () => {
  it('shows the books’ key figures, profit by month and what needs attention', async () => {
    const router = renderApp();
    const figures = await screen.findByRole('region', { name: 'Key figures' }, { timeout: 4000 });
    // ₹25,00,000 of capital less ₹85,000 rent in the bank: about ₹24 lakh
    expect(within(figures).getByRole('article', { name: 'Cash & bank' })).toHaveTextContent(/24/);
    expect(within(figures).getByRole('article', { name: 'Receivables' })).toHaveTextContent(/1\.18|1,18/);
    expect(screen.getByRole('table', { name: 'Profit by month' }).querySelectorAll('tr')).toHaveLength(12);
    const attention = screen.getByRole('region', { name: 'Needs attention' });
    const draft = within(attention).getByRole('link', { name: /1 draft entries not posted/ });
    await userEvent.click(draft);
    await waitFor(() => expect(router.state.location.pathname).toBe('/journals'));
  });
});
