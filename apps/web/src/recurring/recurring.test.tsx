import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import AppProviders from '../AppProviders';
import { resetDemoAccounts } from '../accounts/demoAccountsApi';
import { resetDemoContacts } from '../contacts/demoContactsApi';
import { resetDemoCurrencies } from '../currencies/demoCurrenciesApi';
import { resetDemoInvoices } from '../invoices/demoInvoicesApi';
import { resetDemoItems } from '../items/demoItemsApi';
import { resetDemoJournals } from '../journals/demoJournalsApi';
import { resetDemoPeriods } from '../periods/demoPeriodsApi';
import { routes } from '../routes';
import { openDialog } from '../test/openDialog';
import { resetDemoTaxes } from '../taxes/demoTaxesApi';
import { resetDemoRecurring } from './demoRecurringApi';

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
const previewAs = (role: string) => userEvent.selectOptions(screen.getByLabelText('Preview the app as a role'), role);

beforeEach(() => {
  for (const reset of [resetDemoRecurring, resetDemoInvoices, resetDemoJournals, resetDemoAccounts, resetDemoPeriods, resetDemoTaxes, resetDemoContacts, resetDemoItems, resetDemoCurrencies]) reset();
  sessionStorage.clear();
});

describe('recurring invoices', () => {
  it('makes an invoice recurring, shows what is coming, and raises it on a run', async () => {
    renderApp('/invoices');
    await userEvent.click(await screen.findByRole('link', { name: /^INV\/.*\/0001$/ }, { timeout: 4000 }));
    await screen.findByRole('article', {}, { timeout: 4000 });
    const dialog = await openDialog('Make recurring', 'New recurring schedule');
    expect(within(dialog).getByLabelText('Name')).toHaveValue('Kumar Logistics · Software development, sprint 14');
    expect(within(dialog).getByText('Each invoice goes to Kumar Logistics, with the template’s lines.')).toBeInTheDocument();
    await userEvent.selectOptions(within(dialog).getByLabelText('Ends'), 'count');
    await userEvent.clear(within(dialog).getByLabelText('Number of invoices'));
    await userEvent.type(within(dialog).getByLabelText('Number of invoices'), '6');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create schedule' }));
    expect(await screen.findByText('Kumar Logistics · Software development, sprint 14 scheduled', {}, { timeout: 4000 })).toBeInTheDocument();

    document.body.innerHTML = '';
    renderApp('/recurring');
    const row = (await screen.findByText('Kumar Logistics · Software development, sprint 14', { selector: 'span.font-medium' }, { timeout: 4000 })).closest('li')!;
    expect(row).toHaveTextContent('Monthly');
    expect(row).toHaveTextContent('0 of 6 raised');
    // Starting today, the first one is coming up now, at the template's ₹1,18,000
    await waitFor(() => expect(screen.getByText('Coming up').closest('div')!).toHaveTextContent('₹1,18,000.00'));
    await userEvent.click(screen.getByRole('button', { name: 'Run now' }));
    expect(await screen.findByText('Run complete: 1 raised', {}, { timeout: 4000 })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Kumar Logistics · Software development, sprint 14', { selector: 'span.font-medium' }).closest('li')!).toHaveTextContent('1 of 6 raised'));
    expect(within(screen.getByText('Kumar Logistics · Software development, sprint 14', { selector: 'span.font-medium' }).closest('li')!).getByRole('link', { name: 'Draft' })).toBeInTheDocument();
  }, 30_000);

  it('pauses a schedule, and is read-only for Auditors', async () => {
    renderApp('/recurring');
    await userEvent.click(await screen.findByRole('button', { name: 'New schedule' }, { timeout: 4000 }));
    const dialog = (await screen.findByText('New recurring schedule')).closest('[role="dialog"]') as HTMLElement;
    const template = within(dialog).getByLabelText('Template invoice') as HTMLSelectElement;
    await waitFor(() => expect(template.options.length).toBeGreaterThan(1), { timeout: 4000 });
    await userEvent.selectOptions(template, [...template.options].find((o) => o.textContent?.includes('Kumar Logistics'))!.value);
    await waitFor(() => expect(within(dialog).getByLabelText('Name')).toHaveValue('Kumar Logistics · Software development, sprint 14'), { timeout: 4000 });
    await userEvent.selectOptions(within(dialog).getByLabelText('Repeats'), 'quarterly');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create schedule' }));
    const row = (await screen.findByText('Kumar Logistics · Software development, sprint 14', { selector: 'span.font-medium' }, { timeout: 4000 })).closest('li')!;
    expect(row).toHaveTextContent('Quarterly');
    await userEvent.click(within(row).getByRole('button', { name: /^Actions for / }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Pause' }));
    await waitFor(() => expect(screen.getByText('Kumar Logistics · Software development, sprint 14', { selector: 'span.font-medium' }).closest('li')!).toHaveTextContent('Paused'), { timeout: 4000 });
    await previewAs('auditor');
    await waitFor(() => expect(screen.queryByRole('button', { name: 'New schedule' })).not.toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Run now' })).not.toBeInTheDocument();
  }, 30_000);
});
