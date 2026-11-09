import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import AppProviders from '../AppProviders';
import { routes } from '../routes';
import { openDialog } from '../test/openDialog';
import { resetDemoIntegrations } from './demoIntegrationsApi';

function renderApp(path = '/integrations') {
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
  resetDemoIntegrations();
  sessionStorage.clear();
});

describe('integrations', () => {
  it('makes an API key, shows it once, and revokes it', async () => {
    renderApp();
    expect(await screen.findByText('No API keys yet', {}, { timeout: 4000 })).toBeInTheDocument();
    const dialog = await openDialog('New API key', /^Name it after what will use it/);
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Online shop');
    await userEvent.click(within(dialog).getByLabelText('Create and edit invoices'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Make the key' }));
    const shown = (await screen.findByText('This is the only time it’s shown. Keep it somewhere safe, like a password.', {}, { timeout: 4000 })).closest('[role="dialog"]') as HTMLElement;
    expect((within(shown).getByLabelText('API key') as HTMLInputElement).value).toMatch(/^lnk_/);
    await userEvent.click(within(shown).getByRole('button', { name: 'Done' }));
    const row = (await screen.findByText('Online shop')).closest('li')!;
    expect(row).toHaveTextContent('Create and edit invoices');
    await userEvent.click(within(row).getByRole('button', { name: 'Revoke Online shop' }));
    const confirm = (await screen.findByText(/Whatever uses it stops working at once/)).closest('[role="dialog"]') as HTMLElement;
    await userEvent.click(within(confirm).getByRole('button', { name: 'Revoke' }));
    await waitFor(() => expect(screen.getByText('Online shop').closest('li')!).toHaveTextContent('Revoked'), { timeout: 4000 });
  }, 30_000);

  it('adds a webhook, shows its secret, and records a test event', async () => {
    renderApp();
    const dialog = await openDialog('Add webhook', /^The address LedgerNest should post to/);
    const url = within(dialog).getByLabelText('Address (https://)');
    await userEvent.clear(url);
    await userEvent.type(url, 'https://erp.example.com/hooks/ledgernest');
    await userEvent.click(within(dialog).getByLabelText('Payment received'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add webhook' }));
    const secret = (await screen.findByText('Copy the signing secret', {}, { timeout: 4000 })).closest('[role="dialog"]') as HTMLElement;
    expect((within(secret).getByLabelText('Signing secret') as HTMLInputElement).value).toMatch(/^whsec_/);
    await userEvent.click(within(secret).getByRole('button', { name: 'Done' }));
    const row = (await screen.findByText('https://erp.example.com/hooks/ledgernest')).closest('li')!;
    expect(row).toHaveTextContent('Invoice issued · Payment received');
    await userEvent.click(within(row).getByRole('button', { name: /^Actions for / }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Send a test event' }));
    expect(await screen.findByText('The test event was delivered', {}, { timeout: 4000 })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('https://erp.example.com/hooks/ledgernest').closest('li')!).toHaveTextContent(/Last delivery delivered/), { timeout: 4000 });
  }, 30_000);
});
