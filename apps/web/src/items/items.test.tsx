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

  it('adds packed goods with a GST unit, MRP, barcode, brand and category, checking the barcode and the MRP', async () => {
    renderApp();
    await row('Software development');
    await userEvent.click(screen.getByRole('button', { name: 'Add item' }));
    const dialog = await screen.findByRole('dialog', { name: 'New product or service' });
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Assam Tea 250g');
    await userEvent.selectOptions(within(dialog).getByLabelText('Type'), 'goods');
    const unit = within(dialog).getByLabelText('Unit') as HTMLSelectElement;
    expect(unit.tagName).toBe('SELECT');
    await userEvent.selectOptions(unit, 'PAC');
    await userEvent.type(within(dialog).getByLabelText('Sale price (INR)'), '150');
    await userEvent.type(within(dialog).getByLabelText('MRP (INR)'), '140');
    await userEvent.type(within(dialog).getByLabelText('Barcode'), '8901030865278');
    await userEvent.type(within(dialog).getByLabelText('Brand'), 'Tata');
    await userEvent.type(within(dialog).getByLabelText('Category'), 'Beverages');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add item' }));
    expect(await within(dialog).findByText('The sale price is more than the MRP.')).toBeInTheDocument();
    expect(within(dialog).getByText('That barcode isn’t right: check the number on the pack.')).toBeInTheDocument();
    await userEvent.clear(within(dialog).getByLabelText('Sale price (INR)'));
    await userEvent.type(within(dialog).getByLabelText('Sale price (INR)'), '120');
    await userEvent.clear(within(dialog).getByLabelText('Barcode'));
    await userEvent.type(within(dialog).getByLabelText('Barcode'), '8901030865275');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add item' }));
    expect(await screen.findByText('Assam Tea 250g added')).toBeInTheDocument();
    const added = await row('Assam Tea 250g');
    expect(within(added).getByText(/Tata · Beverages/)).toBeInTheDocument();
    expect(within(added).getByText(/MRP ₹140.00/)).toBeInTheDocument();
    // A scanned barcode finds it
    await userEvent.type(screen.getByRole('searchbox'), '8901030865275');
    await waitFor(() => expect(screen.queryByText('Software development')).not.toBeInTheDocument());
    expect(screen.getByText('Assam Tea 250g')).toBeInTheDocument();
  }, 30_000);

  it('fills in the usual inventory and cost of sales accounts when stock is tracked', async () => {
    renderApp();
    await row('Software development');
    await userEvent.click(screen.getByRole('button', { name: 'Add item' }));
    const dialog = await screen.findByRole('dialog', { name: 'New product or service' });
    await userEvent.selectOptions(within(dialog).getByLabelText('Type'), 'goods');
    expect(within(dialog).getByLabelText('Income account (sales)')).toHaveDisplayValue('Main sales account');
    await within(dialog).findByRole('option', { name: '5050 · Cost of goods sold' });
    await userEvent.click(within(dialog).getByLabelText(/Track stock/));
    expect(within(dialog).getByLabelText('Inventory account')).toHaveDisplayValue('1600 · Stock in trade');
    expect(within(dialog).getByLabelText('Cost of sales account')).toHaveDisplayValue('5050 · Cost of goods sold');
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
