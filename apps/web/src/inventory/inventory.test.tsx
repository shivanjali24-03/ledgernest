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
