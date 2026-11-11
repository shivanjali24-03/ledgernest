import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { gstinCheckChar } from '@ledgernest/shared';
import AppProviders from '../AppProviders';
import { routes } from '../routes';
import { openDialog } from '../test/openDialog';
import { resetDemoGstRegistrations } from './api';

const gstin = (first14: string) => `${first14}${gstinCheckChar(first14)}`;

function renderApp(path: string) {
  sessionStorage.setItem('ledgernest.demo', 'admin@ledgernest.demo');
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <AppProviders client={null}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
}

beforeEach(() => {
  resetDemoGstRegistrations();
  sessionStorage.clear();
});

describe('GST registrations', () => {
  it('adds a GSTIN in another state under the same PAN, refuses one under another, and offers it on invoices', async () => {
    renderApp('/settings');
    await screen.findByRole('heading', { name: 'GST registrations' }, { timeout: 10_000 });
    let dialog = await openDialog('Add GSTIN', 'Another GSTIN');
    await userEvent.type(within(dialog).getByLabelText('GSTIN'), gstin('24AABCU9603R1Z'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save GSTIN' }));
    expect(await screen.findByText(/under another PAN/, {}, { timeout: 4000 })).toBeInTheDocument();
    dialog = screen.getByRole('dialog', { name: 'Another GSTIN' });
    await userEvent.clear(within(dialog).getByLabelText('GSTIN'));
    await userEvent.type(within(dialog).getByLabelText('GSTIN'), gstin('24AAPFN1234C1Z'));
    await userEvent.type(within(dialog).getByLabelText('Trade name there (if different)'), 'Nest Gujarat');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save GSTIN' }));
    expect(await screen.findByText(`${gstin('24AAPFN1234C1Z')} added`, {}, { timeout: 4000 })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/Gujarat · Nest Gujarat/)).toBeInTheDocument(), { timeout: 4000 });

    document.body.innerHTML = '';
    renderApp('/invoices/new');
    const select = (await screen.findByLabelText('Under GSTIN', {}, { timeout: 8000 })) as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual(['27AAPFN1234C1Z5 (own)', `${gstin('24AAPFN1234C1Z')} · Gujarat · Nest Gujarat`]);
  }, 40_000);
});
