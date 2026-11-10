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
    const card = document.body;
    expect(within(card).getByText(/^INV\/\d{4}-\d{2}\/0001$/)).toBeInTheDocument();
    expect(within(card).getByText(/^CN\/\d{4}-\d{2}\/0001$/)).toBeInTheDocument();
    await userEvent.click(within(card).getByRole('button', { name: 'Add series' }));
    const dialog = await screen.findByRole('dialog', { name: 'New number series' });
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Exports');
    await userEvent.type(within(dialog).getByLabelText('Prefix'), 'EXPORT-INVOICE/');
    expect(within(dialog).getByText(/longer than the 16 characters/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Save series' })).toBeDisabled();
    await userEvent.clear(within(dialog).getByLabelText('Prefix'));
    await userEvent.type(within(dialog).getByLabelText('Prefix'), 'EXP-');
    await userEvent.clear(within(dialog).getByLabelText('Digits'));
    await userEvent.type(within(dialog).getByLabelText('Digits'), '3');
    await userEvent.clear(within(dialog).getByLabelText('Start at'));
    await userEvent.type(within(dialog).getByLabelText('Start at'), '101');
    expect(within(dialog).getByText('EXP-101')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save series' }));
    expect(await screen.findByText('Number series saved')).toBeInTheDocument();
    await waitFor(() => expect(within(card).getByText('Exports')).toBeInTheDocument());
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
