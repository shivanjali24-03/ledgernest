import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import AppProviders from '../AppProviders';
import { resetDemoAccounts, sampleId } from '../accounts/demoAccountsApi';
import { routes } from '../routes';
import { createDemoItemsApi, resetDemoItems } from '../items/demoItemsApi';

function renderApp(path: string) {
  sessionStorage.setItem('ledgernest.demo', 'admin@ledgernest.demo');
  render(
    <AppProviders client={null}>
      <RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />
    </AppProviders>,
  );
}

beforeEach(() => {
  for (const reset of [resetDemoItems, resetDemoAccounts]) reset();
  sessionStorage.clear();
});

describe('opening stock and second units', () => {
  it('enters opening stock for tracked items in one go', async () => {
    renderApp('/inventory');
    await userEvent.click(await screen.findByRole('button', { name: 'Opening stock' }, { timeout: 10_000 }));
    const dialog = await screen.findByRole('dialog', { name: 'Opening stock' });
    const qty = await within(dialog).findByLabelText('Quantity of Wireless keyboard and mouse set', {}, { timeout: 10_000 });
    expect(within(dialog).getByRole('button', { name: /Save stock of 0 items/ })).toBeDisabled();
    await userEvent.type(qty, '5');
    await userEvent.type(within(dialog).getByLabelText('Cost of one Wireless keyboard and mouse set'), '1600');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save stock of 1 item' }));
    expect(await screen.findByText('Opening stock of 1 item saved', {}, { timeout: 10_000 })).toBeInTheDocument();
  }, 30_000);

  it('switches an invoice line to the item’s second unit, pricing it for that unit', async () => {
    const soap = await createDemoItemsApi(() => true).create({ name: 'Bath soap', kind: 'goods', unit: 'PCS', altUnit: 'BOX', altFactor: '12', salePrice: 25_00, incomeAccountId: sampleId('4100.01') });
    renderApp('/invoices/new');
    await screen.findByRole('heading', { name: 'New invoice' }, { timeout: 10_000 });
    await waitFor(() => expect([...(screen.getByLabelText('Item on line 1') as HTMLSelectElement).options].map((o) => o.value)).toContain(soap.id));
    await userEvent.selectOptions(screen.getByLabelText('Item on line 1'), soap.id);
    expect(screen.getByLabelText('Price on line 1')).toHaveValue('25.00');
    await userEvent.selectOptions(screen.getByLabelText('Unit on line 1'), 'alt');
    expect(screen.getByLabelText('Price on line 1')).toHaveValue('300.00');
    await userEvent.selectOptions(screen.getByLabelText('Unit on line 1'), 'main');
    expect(screen.getByLabelText('Price on line 1')).toHaveValue('25.00');
  }, 30_000);
});
