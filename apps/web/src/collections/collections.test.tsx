import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { todayIn } from '@ledgernest/shared';
import AppProviders from '../AppProviders';
import { resetDemoAccounts, sampleId } from '../accounts/demoAccountsApi';
import { demoContactRows, resetDemoContacts } from '../contacts/demoContactsApi';
import { createDemoInvoicesApi, resetDemoInvoices } from '../invoices/demoInvoicesApi';
import { resetDemoJournals } from '../journals/demoJournalsApi';
import { resetDemoPeriods } from '../periods/demoPeriodsApi';
import { routes } from '../routes';

function renderApp(path = '/collections') {
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
  for (const reset of [resetDemoInvoices, resetDemoJournals, resetDemoAccounts, resetDemoPeriods, resetDemoContacts]) reset();
  sessionStorage.clear();
});

describe('collections', () => {
  it('lists customers with overdue money and chases one on WhatsApp with their account link', { timeout: 30_000 }, async () => {
    // An invoice to Kumar from the start of the earliest open month, due at once: overdue whenever this runs
    const today = todayIn('Asia/Kolkata');
    const { createDemoPeriodsApi } = await import('../periods/demoPeriodsApi');
    const { years } = await createDemoPeriodsApi(() => true).list();
    const old = years.flatMap((y) => y.periods).filter((p) => p.status === 'open' && p.startDate < today).sort((a, b) => a.startDate.localeCompare(b.startDate))[0]!.startDate;
    const kumar = demoContactRows().find((c) => c.name === 'Kumar Logistics')!;
    const invoices = createDemoInvoicesApi(() => true);
    const d = await invoices.create({ contactId: kumar.id, issueDate: old, dueDate: old, lines: [{ description: 'Freight', quantity: '1', unitPrice: 25_000_00, accountId: sampleId('4100.01') }] });
    await invoices.issue(d.id);
    const opened: string[] = [];
    vi.spyOn(window, 'open').mockImplementation((url?: string | URL) => {
      opened.push(String(url ?? ''));
      return { location: { set href(v: string) { opened.push(v); } } } as unknown as Window;
    });

    renderApp();
    const row = (await screen.findByText('Kumar Logistics', {}, { timeout: 8000 })).closest('tr')!;
    expect(row).toHaveTextContent('₹25,000.00');
    expect(row).toHaveTextContent('Not chased yet');
    await userEvent.click(within(row).getByRole('button', { name: 'Remind Kumar Logistics on WhatsApp' }));
    await waitFor(() => expect(opened.some((u) => u.startsWith('https://wa.me/'))).toBe(true), { timeout: 6000 });
    const message = decodeURIComponent(opened.find((u) => u.startsWith('https://wa.me/'))!.split('text=')[1]!);
    expect(message).toMatch(/^Dear Kumar Logistics, ₹25,000\.00 is overdue with .* \(1 invoice, \d+ days late\)\. You can see it and pay by UPI here: http.*\/c\/[A-Za-z0-9_-]{32}$/);
    await waitFor(() => expect((screen.getByText('Kumar Logistics').closest('tr') as HTMLElement).textContent).toMatch(/Chased/), { timeout: 6000 });
  });
});
