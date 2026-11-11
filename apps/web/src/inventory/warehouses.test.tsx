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
import { resetDemoStock, resetDemoWarehouses } from './demoInventoryApi';

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
  for (const reset of [resetDemoStock, resetDemoWarehouses, resetDemoItems, resetDemoJournals, resetDemoAccounts, resetDemoPeriods]) reset();
  sessionStorage.clear();
});

describe('warehouses', () => {
  it('adds a warehouse (with the main one holding the stock there was) and moves stock to it', async () => {
    renderApp();
    await screen.findByRole('table', { name: 'Stock valuation' }, { timeout: 6000 });
    // Some stock to move
    let dialog = await openDialog('Adjust stock', /^Count stock in/);
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Stock in' }));
    await userEvent.type(within(dialog).getByLabelText('Quantity'), '10');
    await userEvent.type(within(dialog).getByLabelText('Cost of one (INR)'), '1600');
    await choose(within(dialog).getByLabelText('Other account'), /Opening balance equity/);
    await userEvent.type(within(dialog).getByLabelText('Reason'), 'Opening stock');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Adjust stock' }));
    await screen.findByText('10 of Wireless keyboard and mouse set added', {}, { timeout: 4000 });

    expect(screen.getByText(/Stock is kept in one place/)).toBeInTheDocument();
    dialog = await openDialog('Add warehouse', 'New warehouse');
    expect(within(dialog).getByText(/A main warehouse comes with it/)).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Pune shop');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save warehouse' }));
    expect(await screen.findByText('Pune shop added', {}, { timeout: 4000 })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Main warehouse')).toBeInTheDocument(), { timeout: 4000 });
    expect(screen.getByText('MAIN')).toBeInTheDocument();
    expect(screen.getByText('PUNE')).toBeInTheDocument();

    dialog = await openDialog('Move stock', 'Move stock between warehouses');
    await choose(within(dialog).getByLabelText('From'), /Main warehouse/);
    await choose(within(dialog).getByLabelText('To'), /Pune shop/);
    await choose(within(dialog).getByLabelText('Item 1'), /Wireless keyboard/);
    await userEvent.type(within(dialog).getByLabelText('Quantity 1'), '4');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Move stock' }));
    expect(await screen.findByText('TR-0001 recorded', {}, { timeout: 4000 })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/Main warehouse → Pune shop/)).toBeInTheDocument(), { timeout: 4000 });
    // What each holds: four keyboards at ₹1,600 went to Pune
    await waitFor(() => expect(screen.getByText(/1 item · ₹6,400\.00/)).toBeInTheDocument(), { timeout: 4000 });
  }, 40_000);

  it('lets a new invoice say which warehouse its goods leave, once there are warehouses', async () => {
    renderApp('/invoices/new');
    await screen.findByLabelText(/^Customer/, {}, { timeout: 6000 });
    expect(screen.queryByLabelText('Warehouse')).not.toBeInTheDocument();
    document.body.innerHTML = '';
    renderApp();
    const dialog = await openDialog('Add warehouse', 'New warehouse');
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Nashik depot');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save warehouse' }));
    await screen.findByText('Nashik depot added', {}, { timeout: 4000 });
    document.body.innerHTML = '';
    renderApp('/invoices/new');
    const select = (await screen.findByLabelText('Warehouse', {}, { timeout: 6000 })) as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual(['Main warehouse (main)', 'Nashik depot (NASH)']);
  }, 40_000);
});
