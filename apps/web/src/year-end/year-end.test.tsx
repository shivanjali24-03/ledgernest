import { render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import AppProviders from '../AppProviders';
import { resetDemoContacts } from '../contacts/demoContactsApi';
import { resetDemoInvoices } from '../invoices/demoInvoicesApi';
import { resetDemoJournals } from '../journals/demoJournalsApi';
import { resetDemoPeriods } from '../periods/demoPeriodsApi';
import { resetDemoConfirmations } from '../reports/demoConfirmations';
import { routes } from '../routes';

beforeEach(() => {
  for (const reset of [resetDemoInvoices, resetDemoJournals, resetDemoPeriods, resetDemoContacts, resetDemoConfirmations]) reset();
  sessionStorage.clear();
});

describe('year-end close', () => {
  it('walks through closing the year, each step saying where it stands and where to do it', { timeout: 30_000 }, async () => {
    sessionStorage.setItem('ledgernest.demo', 'admin@ledgernest.demo');
    render(
      <AppProviders client={null}>
        <RouterProvider router={createMemoryRouter(routes, { initialEntries: ['/year-end'] })} />
      </AppProviders>,
    );
    const list = await screen.findByRole('list', { name: 'Year-end close' }, { timeout: 8000 });
    // The GST and MSME steps join once the organisation (in India) has loaded
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(7), { timeout: 8000 });
    const steps = within(list).getAllByRole('listitem');
    expect(steps.map((s) => s.querySelector('.font-medium')!.textContent!.replace(/ \((done|needs attention|to do|checking)\)$/, ''))).toEqual([
      '1. Reconcile the bank',
      '2. Post or delete draft entries',
      '3. Get balance confirmations',
      '4. Pay MSME suppliers in time (43B(h))',
      '5. Fix GST details',
      '6. Close the months',
      '7. Keep a backup',
    ]);
    // Nothing asked yet, and the link goes to the year end
    await waitFor(() => expect(steps[2]).toHaveTextContent('Not asked yet'), { timeout: 8000 });
    expect(within(steps[2]!).getByRole('link').getAttribute('href')).toMatch(/^\/reports\?tab=confirmations&asOf=\d{4}-03-31$/);
    // The demo's last finished year is closed already; a current one would have months open
    await waitFor(() => expect(steps[5]).toHaveTextContent(/(Every month is closed|still open|Closed, with the closing entry)/), { timeout: 8000 });
    expect(screen.getByText(/of 7 done for FY/)).toBeInTheDocument();
  });
});
