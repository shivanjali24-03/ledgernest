import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import AppProviders from '../AppProviders';
import { resetDemoAccounts } from '../accounts/demoAccountsApi';
import { resetDemoJournals } from '../journals/demoJournalsApi';
import { resetDemoPeriods } from '../periods/demoPeriodsApi';
import { routes } from '../routes';
import { resetDemoGstSlabs } from './demoGstSlabs';
import { resetDemoTaxes } from './demoTaxesApi';

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
const pick = (n: number, label: RegExp) => {
  const select = screen.getByLabelText(`Line ${n} account`) as HTMLSelectElement;
  const option = [...select.options].find((o) => label.test(o.textContent ?? ''))!;
  return userEvent.selectOptions(select, option.value);
};
const pickTax = (n: number, name: string) => {
  const select = screen.getByLabelText(`Line ${n} tax`) as HTMLSelectElement;
  return userEvent.selectOptions(select, [...select.options].find((o) => o.textContent === name)!.value);
};
const ready = async () => {
  await screen.findByRole('heading', { name: 'New journal entry' });
  await waitFor(() => expect((screen.getByLabelText('Line 1 account') as HTMLSelectElement).options.length).toBeGreaterThan(10));
  await waitFor(() => expect((screen.getByLabelText('Line 1 tax') as HTMLSelectElement).options.length).toBeGreaterThan(5));
};

beforeEach(() => {
  resetDemoJournals();
  resetDemoAccounts();
  resetDemoPeriods();
  resetDemoTaxes();
  resetDemoGstSlabs();
  sessionStorage.clear();
});

describe('tax on journal lines', () => {
  it('adds CGST and SGST to a sale as you type, then posts them as their own lines', async () => {
    renderApp('/journals/new');
    await ready();
    await userEvent.type(screen.getByLabelText('Memo'), 'Invoice INV-2001');
    await pick(1, /HDFC Bank current/);
    await userEvent.type(screen.getByLabelText('Line 1 debit'), '1180');
    await pick(2, /Domestic clients/);
    await userEvent.type(screen.getByLabelText('Line 2 credit'), '1000');
    expect(screen.getByRole('status')).toHaveTextContent('Out by ₹180.00');
    await pickTax(2, 'GST 18%');
    const preview = screen.getAllByTestId('tax-preview');
    expect(preview.map((r) => r.textContent)).toEqual(['↳ CGST 9%90.00', '↳ SGST 9%90.00']);
    expect(screen.getByRole('status')).toHaveTextContent('Balanced');

    await userEvent.click(screen.getByRole('button', { name: 'Post' }));
    // Saving and posting chain several demo calls
    expect(await screen.findByText('CGST 9% on line 2', {}, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getByText('SGST 9% on line 2')).toBeInTheDocument();
    const cgst = screen.getByText('CGST 9% on line 2').closest('tr')!;
    expect(within(cgst).getByText('CGST output')).toBeInTheDocument();
    expect(within(cgst).getByText('90.00')).toBeInTheDocument();
    expect(screen.getByText('GST 18%')).toBeInTheDocument();
  });

  it('backs the tax out of an amount that includes it, and claims input credit on a purchase', async () => {
    renderApp('/journals/new');
    await ready();
    await pick(1, /Office rent/);
    await userEvent.type(screen.getByLabelText('Line 1 debit'), '1180');
    await pickTax(1, 'GST 18%');
    await userEvent.click(screen.getByLabelText('Amount includes tax'));
    await pick(2, /HDFC Bank current/);
    await userEvent.type(screen.getByLabelText('Line 2 credit'), '1180');
    expect(screen.getByText('Net amount').closest('tr')!).toHaveTextContent('1,000.00');
    expect(screen.getByRole('status')).toHaveTextContent('Balanced');
    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByText('Draft saved', {}, { timeout: 4000 })).toBeInTheDocument();
    // The draft reopens as it was entered: the gross amount, with the box ticked
    await screen.findByRole('heading', { name: 'Draft entry' });
    expect(await screen.findByLabelText('Amount includes tax', {}, { timeout: 4000 })).toBeChecked();
    expect(screen.getByLabelText('Line 1 debit')).toHaveValue('1,180.00');
    await userEvent.click(screen.getByRole('button', { name: 'Post' }));
    const cgst = (await screen.findByText('CGST 9% on line 1', {}, { timeout: 4000 })).closest('tr')!;
    expect(within(cgst).getByText('CGST input')).toBeInTheDocument();
    expect(screen.getByText('GST 18%, tax included')).toBeInTheDocument();
  });

  it('summarises the period’s tax in Reports, with the sample sale’s GST', async () => {
    renderApp('/reports?tab=tax');
    const byGroup = await screen.findByRole('table', { name: 'By tax group' });
    const row = within(byGroup).getByRole('rowheader', { name: 'GST 18%' }).closest('tr')!;
    expect(row).toHaveTextContent('1,00,000.00');
    expect(row).toHaveTextContent('18,000.00');
    const byRate = screen.getByRole('table', { name: 'By tax' });
    expect(within(byRate).getByRole('rowheader', { name: 'CGST 9%' }).closest('tr')!).toHaveTextContent('9,000.00');
    expect(screen.getByText('Net tax payable')).toBeInTheDocument();
    expect(screen.getAllByText('₹18,000.00').length).toBeGreaterThan(0);
  });
});
