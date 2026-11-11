import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import AppProviders from '../AppProviders';
import { routes } from '../routes';
import { resetDemoInvoices } from '../invoices/demoInvoicesApi';
import { resetDemoSettings } from '../settings/demoSettingsApi';
import { resetDemoNumbering } from './demoNumberingApi';

function renderApp(path = '/settings') {
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
  resetDemoSettings();
  resetDemoInvoices();
  resetDemoNumbering();
  sessionStorage.clear();
});

describe('number series', () => {
  it('lists the default series and adds one with a prefix, previewing its numbers and refusing ones GST won’t take', async () => {
    renderApp();
    await screen.findByRole('heading', { name: 'Number series' }, { timeout: 10_000 });
    // Found afresh each time: the settings page can remount while it loads under a busy machine
    expect(await screen.findByText(/^INV\/\d{4}-\d{2}\/0001$/, {}, { timeout: 10_000 })).toBeInTheDocument();
    expect(screen.getByText(/^CN\/\d{4}-\d{2}\/0001$/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Add series' }));
    await screen.findByRole('dialog', { name: 'New number series' }, { timeout: 10_000 });
    const dialog = () => within(screen.getByRole('dialog', { name: 'New number series' }));
    await userEvent.type(dialog().getByLabelText('Name'), 'Exports');
    await userEvent.type(dialog().getByLabelText('Prefix'), 'EXPORT-INVOICE/');
    expect(await dialog().findByText(/longer than the 16 characters/, {}, { timeout: 4000 })).toBeInTheDocument();
    expect(dialog().getByRole('button', { name: 'Save series' })).toBeDisabled();
    await userEvent.clear(dialog().getByLabelText('Prefix'));
    await userEvent.type(dialog().getByLabelText('Prefix'), 'EXP-');
    await userEvent.clear(dialog().getByLabelText('Digits'));
    await userEvent.type(dialog().getByLabelText('Digits'), '3');
    await userEvent.clear(dialog().getByLabelText('Start at'));
    await userEvent.type(dialog().getByLabelText('Start at'), '101');
    expect(await dialog().findByText('EXP-101', {}, { timeout: 4000 })).toBeInTheDocument();
    await waitFor(() => expect(dialog().getByRole('button', { name: 'Save series' })).toBeEnabled());
    await userEvent.click(dialog().getByRole('button', { name: 'Save series' }));
    expect(await screen.findByText('Number series saved', {}, { timeout: 10_000 })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Exports')).toBeInTheDocument(), { timeout: 10_000 });
  }, 30_000);

  it('offers the series on a new invoice once there is more than one, and numbers from the one chosen', async () => {
    const { createDemoNumberingApi } = await import('./demoNumberingApi');
    const created = await createDemoNumberingApi(() => true).create({ type: 'invoice', name: 'Exports', prefix: 'EXP-', digits: 3, startNumber: 101 });
    renderApp('/invoices/new');
    const select = await screen.findByLabelText('Number series', {}, { timeout: 10_000 });
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual([expect.stringMatching(/^Tax invoices · INV\//), 'Exports · EXP-101']);
    await userEvent.selectOptions(select, created.id);
    expect(select).toHaveValue(created.id);
    cleanup();
  }, 30_000);
});
