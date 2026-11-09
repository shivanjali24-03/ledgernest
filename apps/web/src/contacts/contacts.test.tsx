import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import AppProviders from '../AppProviders';
import { resetDemoCurrencies } from '../currencies/demoCurrenciesApi';
import { routes } from '../routes';
import { resetDemoContacts } from './demoContactsApi';

function renderApp(path = '/contacts') {
  sessionStorage.setItem('ledgernest.demo', 'admin@ledgernest.demo');
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <AppProviders client={null}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return router;
}
const previewAs = (role: string) => userEvent.selectOptions(screen.getByLabelText('Preview the app as a role'), role);
const row = async (name: string) => (await screen.findByRole('link', { name }, { timeout: 5000 })).closest('li')!;

beforeEach(() => {
  resetDemoContacts();
  resetDemoCurrencies();
  sessionStorage.clear();
});

describe('customers and vendors', () => {
  it('lists the sample customers and vendors with their roles, places and terms', async () => {
    renderApp();
    const kumar = await row('Kumar Logistics');
    expect(within(kumar).getByText('Customer')).toBeInTheDocument();
    expect(within(kumar).getByText(/Pune, Maharashtra/)).toBeInTheDocument();
    expect(within(kumar).getByText('Net 15')).toBeInTheDocument();
    const gulf = await row('Gulf Traders LLC');
    expect(within(gulf).getByText('Vendor')).toBeInTheDocument();
    expect(within(gulf).getByText('AED')).toBeInTheDocument();
    expect(within(await row('Amazon Web Services')).getByText('On receipt')).toBeInTheDocument();
  });

  it('filters vendors and searches by GSTIN', async () => {
    renderApp();
    await row('Kumar Logistics');
    await userEvent.click(screen.getByRole('radio', { name: 'Vendors' }));
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Kumar Logistics' })).not.toBeInTheDocument());
    expect(screen.getByRole('link', { name: 'Sharma Office Supplies' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'All' }));
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search name, email or tax ID' }), '29AAQ');
    await waitFor(() => expect(screen.getAllByRole('listitem').filter((li) => li.querySelector('code'))).toHaveLength(1));
    expect(screen.getByRole('link', { name: 'Bluewave Clinics' })).toBeInTheDocument();
  });

  it('adds a customer, filling the state from the GSTIN and refusing an invalid one', async () => {
    renderApp();
    await row('Kumar Logistics');
    await userEvent.click(screen.getByRole('button', { name: 'Add contact' }));
    const dialog = await screen.findByRole('dialog', { name: 'New contact' }, { timeout: 5000 });
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Tamil Textiles');
    await userEvent.type(within(dialog).getByLabelText('GSTIN'), '33AAPFU0939F1ZX');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add contact' }));
    expect(await within(dialog).findByText('This GSTIN isn’t valid: check the 15 characters.', {}, { timeout: 5000 })).toBeInTheDocument();
    // A valid Tamil Nadu GSTIN: the state follows
    const { gstinCheckChar } = await import('@ledgernest/shared');
    await userEvent.clear(within(dialog).getByLabelText('GSTIN'));
    await userEvent.type(within(dialog).getByLabelText('GSTIN'), `33AAPFU0939F1Z${gstinCheckChar('33AAPFU0939F1Z')}`);
    expect(within(dialog).getByLabelText('State')).toHaveValue('Tamil Nadu');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add contact' }));
    expect(await screen.findByText('Tamil Textiles added', {}, { timeout: 5000 })).toBeInTheDocument();
    expect(within(await row('Tamil Textiles')).getByText(/Tamil Nadu/)).toBeInTheDocument();
  });

  it('archives and restores a contact', async () => {
    renderApp();
    await userEvent.click(within(await row('Sharma Office Supplies')).getByRole('button', { name: 'Actions for Sharma Office Supplies' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Archive' }));
    expect(await screen.findByText('Sharma Office Supplies archived', {}, { timeout: 5000 })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Sharma Office Supplies' })).not.toBeInTheDocument());
    await userEvent.click(screen.getByLabelText('Show archived'));
    await userEvent.click(within(await row('Sharma Office Supplies')).getByRole('button', { name: 'Actions for Sharma Office Supplies' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Restore' }));
    expect(await screen.findByText('Sharma Office Supplies restored', {}, { timeout: 5000 })).toBeInTheDocument();
  });

  it('is hidden from Viewers, and read-only for Auditors', async () => {
    renderApp('/');
    await previewAs('viewer');
    expect(screen.queryByRole('link', { name: 'Customers & vendors' })).not.toBeInTheDocument();
    await previewAs('auditor');
    await userEvent.click(await screen.findByRole('link', { name: 'Customers & vendors' }));
    await row('Kumar Logistics');
    expect(screen.queryByRole('button', { name: 'Add contact' })).not.toBeInTheDocument();
    // Auditors read reports: the menu only takes them to the statement
    await waitFor(() => {
      if (!screen.queryByRole('menu')) fireEvent.click(screen.getByRole('button', { name: 'Actions for Kumar Logistics' }));
      expect(screen.getByRole('menuitem', { name: 'Statement of account' })).toBeInTheDocument();
    });
    expect(screen.queryByRole('menuitem', { name: 'Edit' })).not.toBeInTheDocument();
  });

  it("opens a customer's statement of account from their row", async () => {
    const router = renderApp();
    await userEvent.click(within(await row('Kumar Logistics')).getByRole('button', { name: 'Actions for Kumar Logistics' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Statement of account' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/reports'));
    expect(router.state.location.search).toMatch(/tab=statement&contact=/);
    expect(await screen.findByRole('link', { name: /^INV\/.*\/0001$/ }, { timeout: 6000 })).toBeInTheDocument();
  });

  it("opens a customer's page: details, balance, recent invoices and quotes, and a new invoice for them", async () => {
    const router = renderApp();
    await userEvent.click(await screen.findByRole('link', { name: 'Kumar Logistics' }, { timeout: 5000 }));
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/contacts\/[0-9a-f-]{36}$/));
    expect(await screen.findByRole('heading', { name: 'Kumar Logistics' }, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByText(/^27AAKCK4821R1Z/)).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: /^INV\/.*\/0001$/ }, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByText('No quotes for this customer yet')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'New invoice' }));
    await waitFor(() => expect(router.state.location.search).toMatch(/^\?contact=/));
    await waitFor(() => expect((screen.getByLabelText('Customer') as HTMLSelectElement).selectedOptions[0]!.textContent).toBe('Kumar Logistics'), { timeout: 5000 });
  });
});
