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
    // About ₹24 lakh in the bank never runs short
    expect(await within(attention).findByRole('link', { name: /^Cash in 13 weeks\s*Stays above zero, ending at ₹/ }, { timeout: 4000 })).toHaveAttribute('href', '/reports?tab=forecast');
    // India's due dates: GSTR-3B for a month, with what it would put in cash, linking to that month's return
    const due = await screen.findByRole('region', { name: 'Due dates' }, { timeout: 4000 });
    const gstr3b = within(due).getAllByRole('link', { name: /GSTR-3B for / })[0]!;
    expect(gstr3b).toHaveTextContent(/days? (left|late)|Due today/);
    expect(gstr3b.getAttribute('href')).toMatch(/^\/reports\?tab=gst&from=\d{4}-\d{2}-01&to=\d{4}-\d{2}-\d{2}$/);
    const draft = within(attention).getByRole('link', { name: /1 draft entries not posted/ });
    await userEvent.click(draft);
    await waitFor(() => expect(router.state.location.pathname).toBe('/journals'));
  });
});
