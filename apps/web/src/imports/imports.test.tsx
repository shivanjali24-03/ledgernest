import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import AppProviders from '../AppProviders';
import { resetDemoAccounts } from '../accounts/demoAccountsApi';
import { resetDemoContacts } from '../contacts/demoContactsApi';
import { resetDemoJournals } from '../journals/demoJournalsApi';
import { readSpreadsheet } from '../lib/readSheet';
import { xlsx } from '../lib/xlsx';
import { routes } from '../routes';

function renderApp(path = '/imports') {
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
  for (const reset of [resetDemoContacts, resetDemoAccounts, resetDemoJournals]) reset();
  sessionStorage.clear();
});

describe('reading spreadsheets', () => {
  it('reads an Excel workbook and a CSV the same way', async () => {
    const book = xlsx([{ name: 'Contacts', rows: [['Name', 'Type', 'Credit days'], ['Mehta Traders', 'Supplier', 30]] }]);
    const file = new File([await book.arrayBuffer()], 'contacts.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    expect(await readSpreadsheet(file)).toEqual([
      ['Name', 'Type', 'Credit days'],
      ['Mehta Traders', 'Supplier', '30'],
    ]);
    expect(await readSpreadsheet(new File(['﻿Name;Type\nMehta Traders;Supplier\n'], 'c.csv', { type: 'text/csv' }))).toEqual([
      ['Name', 'Type'],
      ['Mehta Traders', 'Supplier'],
    ]);
  });
});

describe('imports', () => {
  it('matches the columns, finds the rows that need fixing, then imports contacts', async () => {
    renderApp();
    await userEvent.click(await screen.findByRole('radio', { name: 'Contacts' }, { timeout: 4000 }));
    const csv = 'Party Name,Type,E-mail,Credit Days\nMehta Traders,Supplier,accounts@mehta.example,30\nKumar Logistics,Customer,,15\nOdd One,friend,,\n';
    await userEvent.upload(screen.getByTestId('import-file'), new File([csv], 'parties.csv', { type: 'text/csv' }));
    expect(await screen.findByText('parties.csv: 3 rows', {}, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getByLabelText('Name *')).toHaveDisplayValue('Party Name');
    expect(screen.getByLabelText('Payment terms (days)')).toHaveDisplayValue('Credit Days');
    await userEvent.click(screen.getByRole('button', { name: 'Check 3 rows' }));
    const status = await screen.findByRole('status', {}, { timeout: 4000 });
    expect(status).toHaveTextContent('2 of 3 rows need fixing');
    expect(screen.getByText(/isn’t customer, vendor or both/)).toBeInTheDocument();
    expect(screen.getByText(/Another contact already has this name/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import 3 rows' })).toBeDisabled();

    await userEvent.upload(screen.getByTestId('import-file'), new File(['Party Name,Type\nMehta Traders,Supplier\nNew Client Co,customer\n'], 'parties.csv', { type: 'text/csv' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Check 2 rows' }, { timeout: 4000 }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('All 2 rows are right'), { timeout: 4000 });
    await userEvent.click(screen.getByRole('button', { name: 'Import 2 rows' }));
    await waitFor(() => expect(screen.getAllByText('2 rows imported').length).toBeGreaterThan(0), { timeout: 6000 });

    document.body.innerHTML = '';
    renderApp('/contacts');
    expect(await screen.findByRole('link', { name: 'Mehta Traders' }, { timeout: 4000 })).toBeInTheDocument();
    expect(within(screen.getByRole('link', { name: 'Mehta Traders' }).closest('li')!).getByText('Vendor')).toBeInTheDocument();
  }, 40_000);
});
