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

  it('shows each customer’s interest so far beside what they owe in Collections', async () => {
    await createDemoSettingsApi(() => true).update({ interestRateBp: 1800, interestMethod: 'simple', interestGraceDays: 0 });
    const kumar = demoContactRows().find((c) => c.name === 'Kumar Logistics')!;
    const api = createDemoInvoicesApi(() => true);
    const d = await api.create({ contactId: kumar.id, issueDate: daysAgo(40), dueDate: daysAgo(30), lines: [{ description: 'Freight', quantity: '1', unitPrice: 1_00_000_00, accountId: sampleId('4100.01') }] });
    await api.issue(d.id);
    renderApp('/collections');
    expect(await screen.findByRole('columnheader', { name: 'Interest so far' }, { timeout: 10_000 })).toBeInTheDocument();
    const row = (await screen.findByRole('rowheader', { name: /Kumar Logistics/ })).closest('tr')!;
    expect(within(row).getAllByRole('cell')[1]!.textContent).toMatch(/₹[\d,]+\.\d{2}/);
  }, 30_000);

  it('raises an interest invoice for what’s accrued, and waives with a reason', async () => {
    await createDemoSettingsApi(() => true).update({ interestRateBp: 1800, interestMethod: 'simple', interestGraceDays: 0 });
    const kumar = demoContactRows().find((c) => c.name === 'Kumar Logistics')!;
    const api = createDemoInvoicesApi(() => true);
    const d = await api.create({ contactId: kumar.id, issueDate: daysAgo(40), dueDate: daysAgo(30), lines: [{ description: 'Freight', quantity: '1', unitPrice: 1_00_000_00, accountId: sampleId('4100.01') }] });
    const inv = await api.issue(d.id);
    // Some is waived first, then the rest raised
    const before = await api.interestStatus(inv.id);
    expect(before.chargeable).toBe(before.accrued);
    const after = await api.waiveInterest(inv.id, { amount: 100_00, reason: 'Goodwill' });
    expect(after).toMatchObject({ waived: 100_00, chargeable: before.accrued - 100_00 });
    renderApp(`/invoices/${inv.id}`);
    const raise = await screen.findByRole('button', { name: /Raise interest invoice for/ }, { timeout: 10_000 });
    await userEvent.click(raise);
    expect(await screen.findByText('Interest invoice drafted: look it over and issue it', {}, { timeout: 10_000 })).toBeInTheDocument();
    const status = await api.interestStatus(inv.id);
    expect(status).toMatchObject({ charged: before.accrued - 100_00, chargeable: 0 });
    expect(status.charges).toHaveLength(1);
  }, 30_000);

  it('reports interest on every invoice with it, with totals', async () => {
    await createDemoSettingsApi(() => true).update({ interestRateBp: 1800, interestMethod: 'simple', interestGraceDays: 0 });
    const kumar = demoContactRows().find((c) => c.name === 'Kumar Logistics')!;
    const api = createDemoInvoicesApi(() => true);
    const d = await api.create({ contactId: kumar.id, issueDate: daysAgo(40), dueDate: daysAgo(30), lines: [{ description: 'Freight', quantity: '1', unitPrice: 1_00_000_00, accountId: sampleId('4100.01') }] });
    const inv = await api.issue(d.id);
    renderApp('/reports?tab=interest');
    const row = (await screen.findByRole('link', { name: inv.number! }, { timeout: 10_000 })).closest('tr')!;
    expect(row).toHaveTextContent(/Kumar Logistics.*30.*18%/);
    expect(screen.getByTestId('interest-total-accrued').textContent).toBe(screen.getByTestId('interest-total-chargeable').textContent);
  }, 30_000);

  it('splits an invoice into monthly instalments, and shows where each stands once issued', async () => {
    const kumar = demoContactRows().find((c) => c.name === 'Kumar Logistics')!;
    const api = createDemoInvoicesApi(() => true);
    const plan = [
      { dueDate: daysAgo(20), amount: 50_000_00 },
      { dueDate: daysAgo(-10), amount: 50_000_00 },
    ];
    await expect(api.issue((await api.create({ contactId: kumar.id, issueDate: daysAgo(40), instalments: [plan[0]!, { ...plan[1]!, amount: 1 }], lines: [{ description: 'Freight', quantity: '1', unitPrice: 1_00_000_00, accountId: sampleId('4100.01') }] })).id)).rejects.toMatchObject({ details: { reason: 'instalments_total' } });
    const d = await api.create({ contactId: kumar.id, issueDate: daysAgo(40), instalments: plan, lines: [{ description: 'Freight', quantity: '1', unitPrice: 1_00_000_00, accountId: sampleId('4100.01') }] });
    expect(d.dueDate).toBe(plan[1]!.dueDate);
    const inv = await api.issue(d.id);
    expect(inv.state).toBe('overdue');
    renderApp(`/invoices/${inv.id}`);
    const table = await screen.findByTestId('invoice-instalments', {}, { timeout: 10_000 });
    expect(within(table).getAllByRole('row').map((r) => r.textContent)).toEqual([expect.stringMatching(/1\..*Overdue/), expect.stringMatching(/2\..*Due/)]);
  }, 30_000);

  it('offers equal monthly instalments on a new invoice, checking they add up', async () => {
    renderApp('/invoices/new');
    await screen.findByRole('heading', { name: 'New invoice' }, { timeout: 10_000 });
    await userEvent.type(screen.getByLabelText('Description on line 1'), 'Machine');
    await userEvent.type(screen.getByLabelText('Price on line 1'), '900');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Paid in instalments' }));
    expect(screen.getAllByLabelText(/Due date of instalment/)).toHaveLength(3);
    expect(screen.getByText('Adds up to the invoice total. The last one is the due date.')).toBeInTheDocument();
    const second = screen.getByLabelText('Amount of instalment 2');
    await userEvent.clear(second);
    await userEvent.type(second, '100');
    await userEvent.tab();
    expect(await screen.findByText(/The instalments add up to/)).toBeInTheDocument();
  }, 30_000);
});
