import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import AppProviders from '../AppProviders';
import { resetDemoAccounts, sampleId } from '../accounts/demoAccountsApi';
import { routes } from '../routes';
import { resetDemoBills } from '../bills/demoBillsApi';
import { createDemoItemsApi, resetDemoItems } from '../items/demoItemsApi';

function renderApp(path: string) {
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
  for (const reset of [resetDemoItems, resetDemoAccounts, resetDemoBills]) reset();
  sessionStorage.clear();
});

describe('batches with expiry dates', () => {
  it('offers batches once an item’s stock is tracked', async () => {
    renderApp('/items');
    await screen.findByText('Software development', { selector: 'span.font-medium' }, { timeout: 10_000 });
    await userEvent.click(screen.getByRole('button', { name: 'Add item' }));
    const dialog = await screen.findByRole('dialog', { name: 'New product or service' });
    await userEvent.selectOptions(within(dialog).getByLabelText('Type'), 'goods');
    expect(within(dialog).queryByText('Keep in batches with expiry dates')).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('checkbox', { name: /Track stock/ }));
    expect(within(dialog).getByRole('checkbox', { name: /Keep in batches with expiry dates/ })).toBeInTheDocument();
  }, 30_000);

  it('asks a bill line of batched goods for its batch and dates', async () => {
    const item = await createDemoItemsApi(() => true).create({ name: 'Paracetamol 500mg', kind: 'goods', unit: 'TBS', trackStock: true, trackBatches: true, inventoryAccountId: sampleId('1600'), cogsAccountId: sampleId('5050') });
    renderApp('/bills/new');
    await screen.findByRole('heading', { name: 'New bill' }, { timeout: 10_000 });
    await waitFor(() => expect([...(screen.getByLabelText('Item on line 1') as HTMLSelectElement).options].map((o) => o.value)).toContain(item.id));
    expect(screen.queryByLabelText('Batch for line 1')).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Item on line 1'), item.id);
    const batch = screen.getByLabelText('Batch for line 1');
    expect(batch).toHaveClass('border-expense');
    await userEvent.type(batch, 'PX-1');
    expect(batch).not.toHaveClass('border-expense');
    expect(screen.getByLabelText('Expiry date for line 1')).toHaveAttribute('type', 'date');
  }, 30_000);
});
