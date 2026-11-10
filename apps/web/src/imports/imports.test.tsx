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
import { gstinCheckChar } from '@ledgernest/shared';

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

describe('moving from Tally', () => {
  const GSTIN = `27AAKCK4821R1Z${gstinCheckChar('27AAKCK4821R1Z')}`;
  const XML = `<ENVELOPE><BODY><IMPORTDATA><REQUESTDATA>
<TALLYMESSAGE><LEDGER NAME="Mehta Traders"><PARENT>Sundry Debtors</PARENT><PARTYGSTIN>${GSTIN}</PARTYGSTIN><LEDSTATENAME>Maharashtra</LEDSTATENAME><OPENINGBALANCE>-50,000.00</OPENINGBALANCE></LEDGER></TALLYMESSAGE>
<TALLYMESSAGE><LEDGER NAME="Gupta Packaging"><PARENT>Sundry Creditors</PARENT><OPENINGBALANCE>20,000.00</OPENINGBALANCE></LEDGER></TALLYMESSAGE>
<TALLYMESSAGE><LEDGER NAME="Petty Cash Box"><PARENT>Cash-in-Hand</PARENT><OPENINGBALANCE>-5,000.00</OPENINGBALANCE></LEDGER></TALLYMESSAGE>
<TALLYMESSAGE><LEDGER NAME="Partner Capital"><PARENT>Capital Account</PARENT><OPENINGBALANCE>35,000.00</OPENINGBALANCE></LEDGER></TALLYMESSAGE>
</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;
  // As Tally writes it: UTF-16, little-endian, with a byte-order mark
  const utf16 = (s: string) => {
    const b = new Uint8Array(2 + s.length * 2);
    b[0] = 0xff;
    b[1] = 0xfe;
    for (let i = 0; i < s.length; i++) {
      b[2 + i * 2] = s.charCodeAt(i) & 0xff;
      b[3 + i * 2] = s.charCodeAt(i) >> 8;
    }
    return b;
  };

  it('turns the List of Accounts into accounts, parties and opening balances', { timeout: 30_000 }, async () => {
    const router = renderApp();
    await userEvent.upload(await screen.findByTestId('tally-file', {}, { timeout: 6000 }), new File([utf16(XML)], 'Master.xml', { type: 'text/xml' }));
    const plan = await screen.findByRole('list', { name: 'What will be imported' }, { timeout: 6000 });
    expect(plan).toHaveTextContent('2 accounts to add');
    expect(plan).toHaveTextContent('1 customers and 1 vendors');
    expect(plan).toHaveTextContent('Opening balances: ₹55,000.00 debit, ₹55,000.00 credit');
    await userEvent.click(screen.getByRole('button', { name: 'Import from Tally' }));
    const status = await screen.findByRole('status', {}, { timeout: 8000 });
    expect(status).toHaveTextContent('Imported from Tally.');
    await userEvent.click(within(status).getByRole('link', { name: 'Review the opening balances' }));
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/journals\//));

    // The parties are contacts now
    const { demoContactRows } = await import('../contacts/demoContactsApi');
    expect(demoContactRows().find((c) => c.name === 'Mehta Traders')).toMatchObject({ isCustomer: true, taxId: GSTIN });
    expect(demoContactRows().find((c) => c.name === 'Gupta Packaging')).toMatchObject({ isVendor: true });
  });
});

describe('moving from Tally, with a mistake in the file', () => {
  it('saves nothing when a party wouldn’t import', { timeout: 30_000 }, async () => {
    const bad = `<ENVELOPE><LEDGER NAME="Bad Party"><PARENT>Sundry Debtors</PARENT><PARTYGSTIN>27AAKCK4821R1Z9</PARTYGSTIN><LEDSTATENAME>Maharashtra</LEDSTATENAME></LEDGER><LEDGER NAME="Petty Cash Box"><PARENT>Cash-in-Hand</PARENT></LEDGER></ENVELOPE>`;
    renderApp();
    await userEvent.upload(await screen.findByTestId('tally-file', {}, { timeout: 6000 }), new File([bad], 'Master.xml', { type: 'text/xml' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Import from Tally' }, { timeout: 6000 }));
    expect(await screen.findByRole('alert', {}, { timeout: 8000 })).toHaveTextContent('Contacts couldn’t be imported:Row 1: This GSTIN isn’t valid');
    const { createDemoAccountsApi } = await import('../accounts/demoAccountsApi');
    expect((await createDemoAccountsApi(() => true).list(true)).some((a) => a.name === 'Petty Cash Box')).toBe(false);
  });
});
