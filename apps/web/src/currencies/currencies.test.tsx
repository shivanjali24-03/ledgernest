import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import AppProviders from '../AppProviders';
import { resetDemoAccounts } from '../accounts/demoAccountsApi';
import { routes } from '../routes';
import { resetDemoCurrencies } from './demoCurrenciesApi';

function renderApp(path = '/currencies') {
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
const row = async (code: string) => (await screen.findByText(code, { selector: 'span.font-mono' })).closest('li')!;

beforeEach(() => {
  resetDemoCurrencies();
  resetDemoAccounts();
  sessionStorage.clear();
});

describe('currencies', () => {
  it('lists the sample company’s currencies with their latest rates', async () => {
    renderApp();
    expect(await screen.findByText(/The books are kept in INR/)).toBeInTheDocument();
    const aed = await row('AED');
    expect(within(aed).getByText('1 AED = 25.57 INR')).toBeInTheDocument();
    expect(within(aed).getByText('Typed')).toBeInTheDocument();
    expect(within(await row('USD')).getByText('ECB')).toBeInTheDocument();
  });

  it('fetches the ECB’s rates and says which currencies it doesn’t cover', async () => {
    renderApp();
    await userEvent.click(await screen.findByRole('button', { name: 'Fetch today’s rates' }));
    expect(await screen.findByText(/^Saved EUR .*, USD .* \(published .*\)\. Not covered by the European Central Bank, type these by hand: AED\.$/)).toBeInTheDocument();
  });

  it('adds a currency, types its rate, then removes it', async () => {
    renderApp();
    await userEvent.click(await screen.findByRole('button', { name: 'Add currency' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add a currency' });
    // The base currency and those already enabled aren't offered
    const select = within(dialog).getByLabelText('Currency') as HTMLSelectElement;
    expect([...select.options].some((o) => o.value === 'INR' || o.value === 'USD')).toBe(false);
    await userEvent.selectOptions(select, 'GBP');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add currency' }));
    expect(await screen.findByText('GBP added')).toBeInTheDocument();
    const gbp = await row('GBP');
    expect(within(gbp).getByText('No rate yet: add one before entering amounts in this currency.')).toBeInTheDocument();
    await userEvent.type(within(gbp).getByLabelText('1 GBP in INR'), '122.4');
    await userEvent.click(within(gbp).getByRole('button', { name: 'Save rate' }));
    await waitFor(() => expect(within(gbp).getByText('1 GBP = 122.4 INR')).toBeInTheDocument());

    await userEvent.click(within(gbp).getByRole('button', { name: 'Actions for GBP' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Remove' }));
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Remove GBP?' })).getByRole('button', { name: 'Remove' }));
    expect(await screen.findByText('GBP removed')).toBeInTheDocument();
  });

  it('keeps a currency that accounts are kept in', async () => {
    renderApp();
    await userEvent.click(within(await row('USD')).getByRole('button', { name: 'Actions for USD' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Remove' }));
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Remove USD?' })).getByRole('button', { name: 'Remove' }));
    expect(await screen.findByText('Accounts are kept in this currency, so it stays enabled.')).toBeInTheDocument();
  });

  it('lets read-only roles see rates but not change them', async () => {
    renderApp();
    await row('USD');
    await previewAs('viewer');
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Add currency' })).not.toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Fetch today’s rates' })).not.toBeInTheDocument();
    await userEvent.click(within(await row('USD')).getByRole('button', { name: 'USD rates' }));
    expect(await screen.findByRole('table', { name: 'USD rates' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save rate' })).not.toBeInTheDocument();
  });
});

describe('foreign-currency accounts', () => {
  it('shows which accounts are kept in a foreign currency, and creates one', async () => {
    renderApp('/accounts');
    const wise = (await screen.findByText('Wise USD account')).closest('li')!;
    expect(within(wise).getByText('USD')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'New account' }));
    const dialog = await screen.findByRole('dialog');
    const currency = (await within(dialog).findByLabelText('Currency')) as HTMLSelectElement;
    expect([...currency.options].map((o) => o.value)).toEqual(['', 'AED', 'EUR', 'USD']);
    await userEvent.selectOptions(currency, 'EUR');
    await userEvent.clear(within(dialog).getByLabelText('Code'));
    await userEvent.type(within(dialog).getByLabelText('Code'), '1160');
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Deutsche Bank EUR account');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create account' }));
    const created = (await screen.findByText('Deutsche Bank EUR account', {}, { timeout: 4000 })).closest('li')!;
    expect(within(created).getByText('EUR')).toBeInTheDocument();
  });
});
