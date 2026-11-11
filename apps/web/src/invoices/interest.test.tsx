import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { accruedInterest, todayIn } from '@ledgernest/shared';
import AppProviders from '../AppProviders';
import { resetDemoAccounts, sampleId } from '../accounts/demoAccountsApi';
import { demoContactRows, resetDemoContacts } from '../contacts/demoContactsApi';
import { routes } from '../routes';
import { createDemoSettingsApi, resetDemoSettings } from '../settings/demoSettingsApi';
import { createDemoInvoicesApi, resetDemoInvoices } from './demoInvoicesApi';

function renderApp(path: string) {
  sessionStorage.setItem('ledgernest.demo', 'admin@ledgernest.demo');
  render(
    <AppProviders client={null}>
      <RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />
    </AppProviders>,
  );
}
const daysAgo = (n: number) => {
  const d = new Date(`${todayIn('Asia/Kolkata')}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};

beforeEach(() => {
  for (const reset of [resetDemoSettings, resetDemoInvoices, resetDemoContacts, resetDemoAccounts]) reset();
  sessionStorage.clear();
});

describe('interest on late payment', () => {
  it('sets the organisation’s rate in Settings, in basis points', async () => {
    renderApp('/settings');
    const rate = await screen.findByLabelText('Interest, % a year', {}, { timeout: 10_000 });
    await userEvent.type(rate, '18');
    await userEvent.clear(screen.getByLabelText('Days of grace'));
    await userEvent.type(screen.getByLabelText('Days of grace'), '7');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Settings saved', {}, { timeout: 10_000 })).toBeInTheDocument();
    const s = await createDemoSettingsApi(() => true).get();
    expect(s).toMatchObject({ interestRateBp: 1800, interestGraceDays: 7 });
  }, 30_000);

  it('prints the terms on an invoice issued after, and shows what’s accrued since the due date', async () => {
    await createDemoSettingsApi(() => true).update({ interestRateBp: 1800, interestMethod: 'simple', interestGraceDays: 0 });
    const kumar = demoContactRows().find((c) => c.name === 'Kumar Logistics')!;
    const api = createDemoInvoicesApi(() => true);
    const d = await api.create({ contactId: kumar.id, issueDate: daysAgo(40), dueDate: daysAgo(30), lines: [{ description: 'Freight', quantity: '1', unitPrice: 1_00_000_00, accountId: sampleId('4100.01') }] });
    const inv = await api.issue(d.id);
    expect(inv.interest).toMatchObject({ rateBp: 1800, method: 'simple' });
    const expected = accruedInterest({ rateBp: 1800, method: 'simple', graceDays: 0 }, { total: inv.total, dueDate: inv.dueDate }, [], todayIn('Asia/Kolkata'));
    renderApp(`/invoices/${inv.id}`);
    const note = await screen.findByText(/30 days late: interest so far/, {}, { timeout: 10_000 });
    expect(note.textContent).toContain(`₹${(expected.interest / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`);
    expect(within(await screen.findByRole('article')).getByTestId('invoice-interest-terms')).toHaveTextContent('Interest at 18% a year (simple)');
  }, 30_000);
});
