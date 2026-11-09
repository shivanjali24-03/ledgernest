import { render, screen, waitFor, within } from '@testing-library/react';
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
const row = async (name: string) => (await screen.findByRole('button', { name })).closest('li')!;

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
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Kumar Logistics' })).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Sharma Office Supplies' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'All' }));
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search name, email or tax ID' }), '29AAQ');
    await waitFor(() => expect(screen.getAllByRole('listitem').filter((li) => li.querySelector('code'))).toHaveLength(1));
    expect(screen.getByRole('button', { name: 'Bluewave Clinics' })).toBeInTheDocument();
  });

  it('adds a customer, filling the state from the GSTIN and refusing an invalid one', async () => {
    renderApp();
    await row('Kumar Logistics');
    await userEvent.click(screen.getByRole('button', { name: 'Add contact' }));
    const dialog = await screen.findByRole('dialog', { name: 'New contact' });
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Tamil Textiles');
    await userEvent.type(within(dialog).getByLabelText('GSTIN'), '33AAPFU0939F1ZX');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add contact' }));
    expect(await within(dialog).findByText('This GSTIN isn’t valid: check the 15 characters.')).toBeInTheDocument();
    // A valid Tamil Nadu GSTIN: the state follows
    const { gstinCheckChar } = await import('@ledgernest/shared');
    await userEvent.clear(within(dialog).getByLabelText('GSTIN'));
    await userEvent.type(within(dialog).getByLabelText('GSTIN'), `33AAPFU0939F1Z${gstinCheckChar('33AAPFU0939F1Z')}`);
    expect(within(dialog).getByLabelText('State')).toHaveValue('Tamil Nadu');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add contact' }));
    expect(await screen.findByText('Tamil Textiles added')).toBeInTheDocument();
    expect(within(await row('Tamil Textiles')).getByText(/Tamil Nadu/)).toBeInTheDocument();
  });

  it('archives and restores a contact', async () => {
    renderApp();
    await userEvent.click(within(await row('Sharma Office Supplies')).getByRole('button', { name: 'Actions for Sharma Office Supplies' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Archive' }));
    expect(await screen.findByText('Sharma Office Supplies archived')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Sharma Office Supplies' })).not.toBeInTheDocument());
    await userEvent.click(screen.getByLabelText('Show archived'));
    await userEvent.click(within(await row('Sharma Office Supplies')).getByRole('button', { name: 'Actions for Sharma Office Supplies' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Restore' }));
    expect(await screen.findByText('Sharma Office Supplies restored')).toBeInTheDocument();
  });

  it('is hidden from Viewers, and read-only for Auditors', async () => {
    renderApp('/');
    await previewAs('viewer');
    expect(screen.queryByRole('link', { name: 'Customers & vendors' })).not.toBeInTheDocument();
    await previewAs('auditor');
    await userEvent.click(await screen.findByRole('link', { name: 'Customers & vendors' }));
    await row('Kumar Logistics');
    expect(screen.queryByRole('button', { name: 'Add contact' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Actions for Kumar Logistics' })).not.toBeInTheDocument();
  });
});
