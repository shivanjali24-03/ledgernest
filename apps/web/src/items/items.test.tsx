import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import AppProviders from '../AppProviders';
import { resetDemoAccounts } from '../accounts/demoAccountsApi';
import { routes } from '../routes';
import { resetDemoTaxes } from '../taxes/demoTaxesApi';
import { resetDemoItems } from './demoItemsApi';

function renderApp(path = '/items') {
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
const row = async (name: string) => (await screen.findByText(name, { selector: 'span.font-medium' })).closest('li')!;

beforeEach(() => {
  for (const reset of [resetDemoItems, resetDemoAccounts, resetDemoTaxes]) reset();
  sessionStorage.clear();
});

describe('products and services', () => {
  it('lists the sample items with price, unit, tax and SAC/HSN codes', async () => {
    renderApp();
    const dev = await row('Software development');
    expect(within(dev).getByText('₹2,500.00')).toBeInTheDocument();
    expect(within(dev).getByText('/ hrs')).toBeInTheDocument();
    expect(within(dev).getByText('GST 18%')).toBeInTheDocument();
    expect(within(dev).getByText(/SAC code 998314/)).toBeInTheDocument();
    expect(within(await row('Laptop – Dell Latitude 5440')).getByText(/HSN code 84713010/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'Goods' }));
    await waitFor(() => expect(screen.queryByText('Software development')).not.toBeInTheDocument());
  });

  it('adds a service, refusing a bad SAC code and an expense account for sales', async () => {
    renderApp();
    await row('Software development');
    await userEvent.click(screen.getByRole('button', { name: 'Add item' }));
    const dialog = await screen.findByRole('dialog', { name: 'New product or service' });
    await userEvent.type(within(dialog).getByLabelText('Name'), 'UX design workshop');
    await userEvent.type(within(dialog).getByLabelText('SAC code'), '99831');
    await userEvent.type(within(dialog).getByLabelText('Sale price (INR)'), '45,000');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add item' }));
    expect(await within(dialog).findByText('Use a 4, 6 or 8-digit code.')).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText('SAC code'), '4');
    const income = within(dialog).getByLabelText('Income account (sales)') as HTMLSelectElement;
    await waitFor(() => expect(income.options.length).toBeGreaterThan(2));
    // Only income accounts are offered for sales
    expect([...income.options].some((o) => /Office rent/.test(o.textContent ?? ''))).toBe(false);
    await userEvent.selectOptions(income, [...income.options].find((o) => /Domestic clients/.test(o.textContent ?? ''))!.value);
    await userEvent.selectOptions(within(dialog).getByLabelText('Usual tax'), [...(within(dialog).getByLabelText('Usual tax') as HTMLSelectElement).options].find((o) => o.textContent === 'GST 18%')!.value);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add item' }));
    expect(await screen.findByText('UX design workshop added')).toBeInTheDocument();
    const added = await row('UX design workshop');
    expect(within(added).getByText('₹45,000.00')).toBeInTheDocument();
  });

  it('refuses a second item with the same SKU', async () => {
    renderApp();
    await row('Software development');
    await userEvent.click(screen.getByRole('button', { name: 'Add item' }));
    const dialog = await screen.findByRole('dialog', { name: 'New product or service' });
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Another dev hour');
    await userEvent.type(within(dialog).getByLabelText('SKU'), 'dev-hr');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add item' }));
    expect(await within(dialog).findByText('Another item already has this SKU.')).toBeInTheDocument();
  });

  it('is read-only for Auditors', async () => {
    renderApp();
    await row('Software development');
    await previewAs('auditor');
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Add item' })).not.toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Actions for Software development' })).not.toBeInTheDocument();
  });
});
