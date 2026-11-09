import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import AppProviders from '../AppProviders';
import { resetDemoAccounts } from '../accounts/demoAccountsApi';
import { resetDemoItems } from '../items/demoItemsApi';
import { resetDemoJournals } from '../journals/demoJournalsApi';
import { resetDemoPeriods } from '../periods/demoPeriodsApi';
import { routes } from '../routes';
import { openDialog } from '../test/openDialog';
import { resetDemoStock } from './demoInventoryApi';

function renderApp(path = '/inventory') {
  sessionStorage.setItem('ledgernest.demo', 'admin@ledgernest.demo');
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <AppProviders client={null}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return router;
}
const choose = async (select: HTMLElement, text: RegExp) => userEvent.selectOptions(select, [...(select as HTMLSelectElement).options].find((o) => text.test(o.textContent ?? ''))!.value);

beforeEach(() => {
  for (const reset of [resetDemoStock, resetDemoItems, resetDemoJournals, resetDemoAccounts, resetDemoPeriods]) reset();
  sessionStorage.clear();
});

describe('inventory', () => {
  it('counts opening stock in, writes some off at average cost, agrees with the books, and undoes it', async () => {
    renderApp();
    const table = await screen.findByRole('table', { name: 'Stock valuation' }, { timeout: 6000 });
    expect(within(table).getByRole('button', { name: 'Wireless keyboard and mouse set' })).toBeInTheDocument();

    let dialog = await openDialog('Adjust stock', /^Count stock in/);
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Stock in' }));
    await userEvent.type(within(dialog).getByLabelText('Quantity'), '10');
    await userEvent.type(within(dialog).getByLabelText('Cost of one (INR)'), '1600');
    await choose(within(dialog).getByLabelText('Other account'), /Opening balance equity/);
    await userEvent.type(within(dialog).getByLabelText('Reason'), 'Opening stock');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Adjust stock' }));
    expect(await screen.findByText('10 of Wireless keyboard and mouse set added', {}, { timeout: 4000 })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('table', { name: 'Stock valuation' })).toHaveTextContent('16,000.00'), { timeout: 4000 });

    dialog = await openDialog('Adjust stock', /^Count stock in/);
    await userEvent.type(within(dialog).getByLabelText('Quantity'), '2');
    await userEvent.type(within(dialog).getByLabelText('Reason'), 'Damaged in the warehouse');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Adjust stock' }));
    expect(await screen.findByText('2 of Wireless keyboard and mouse set written off', {}, { timeout: 4000 })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('table', { name: 'Stock valuation' })).toHaveTextContent('12,800.00'), { timeout: 4000 });
    expect(await screen.findByText(/Stock in trade: stock ₹12,800.00 agrees with the books/, {}, { timeout: 4000 })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Wireless keyboard and mouse set' }));
    const movements = await screen.findByRole('region', { name: 'Movements of Wireless keyboard and mouse set' }, { timeout: 4000 });
    await waitFor(() => expect(within(movements).getByText(/Adjustment: Damaged in the warehouse/)).toBeInTheDocument(), { timeout: 4000 });
    await userEvent.click(within(movements).getAllByRole('button', { name: /^Undo the adjustment of / }).at(-1)!);
    await waitFor(() => expect(screen.getByRole('table', { name: 'Stock valuation' })).toHaveTextContent('16,000.00'), { timeout: 6000 });
  }, 40_000);

  it('refuses to invoice more than is in stock', async () => {
    renderApp('/invoices/new');
    const item = (await screen.findByLabelText('Item on line 1', {}, { timeout: 6000 })) as HTMLSelectElement;
    await waitFor(() => expect(item.options.length).toBeGreaterThan(3), { timeout: 4000 });
    await waitFor(() => expect((screen.getByLabelText('Customer') as HTMLSelectElement).options.length).toBeGreaterThan(1), { timeout: 4000 });
    await choose(screen.getByLabelText('Customer'), /Kumar Logistics/);
    await choose(item, /Wireless keyboard/);
    await userEvent.click(screen.getByRole('button', { name: 'Issue' }));
    expect(await screen.findByText('Not enough in stock: only 0 on hand.', {}, { timeout: 6000 })).toBeInTheDocument();
  }, 30_000);
});

describe('goods returned on a credit note (demo)', () => {
  it('come back into stock at the cost they left at, and go out again if the credit note is voided', async () => {
    const { createDemoInventoryApi, demoStockOf } = await import('./demoInventoryApi');
    const { createDemoInvoicesApi } = await import('../invoices/demoInvoicesApi');
    const { createDemoCreditNotesApi } = await import('../credit-notes/demoCreditNotesApi');
    const { demoContactRows } = await import('../contacts/demoContactsApi');
    const { demoItemRows } = await import('../items/demoItemsApi');
    const { sampleId } = await import('../accounts/demoAccountsApi');
    const set = demoItemRows().find((i) => i.trackStock)!;
    await createDemoInventoryApi(() => true).adjust({ itemId: set.id, date: new Date().toISOString().slice(0, 10), direction: 'in', quantity: '10', unitCost: 160_000, accountId: sampleId('3990'), reason: 'Opening stock' });
    const invoices = createDemoInvoicesApi(() => true);
    const kumar = demoContactRows().find((c) => c.name === 'Kumar Logistics')!;
    const today = new Date().toISOString().slice(0, 10);
    const draft = await invoices.create({ contactId: kumar.id, issueDate: today, lines: [{ itemId: set.id, description: set.name, quantity: '3', unitPrice: 250_000, taxGroupId: null, accountId: null, discount: 0 }] });
    const issued = await invoices.issue(draft.id);
    expect(demoStockOf(set.id)).toEqual({ quantity: 70_000n, value: 1_120_000n });
    const notes = createDemoCreditNotesApi(() => true, () => true);
    const note = await notes.create({ invoiceId: issued.id, date: today, reason: 'One came back', returnsStock: true, lines: [{ invoiceLineId: issued.lines[0]!.id, quantity: '1' }] });
    expect(demoStockOf(set.id)).toEqual({ quantity: 80_000n, value: 1_280_000n });
    await notes.void(note.id);
    expect(demoStockOf(set.id)).toEqual({ quantity: 70_000n, value: 1_120_000n });
  }, 30_000);
});
