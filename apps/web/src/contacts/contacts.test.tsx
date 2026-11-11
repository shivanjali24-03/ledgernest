import { vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

  it('fills an Indian address from the PIN code: the state, then the city and area to pick', async () => {
    renderApp();
    await row('Kumar Logistics');
    await userEvent.click(screen.getByRole('button', { name: 'Add contact' }));
    const dialog = await screen.findByRole('dialog', { name: 'New contact' }, { timeout: 5000 });
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Baner Traders');
    const billing = within(dialog).getAllByRole('group')[0]!;
    await userEvent.type(within(billing).getByLabelText('PIN code'), '411045');
    await waitFor(() => expect(within(billing).getByLabelText('State')).toHaveValue('Maharashtra'), { timeout: 5000 });
    const city = within(billing).getByLabelText('City or town');
    expect(city.tagName).toBe('SELECT');
    expect(city).toHaveValue('Pune');
    expect(within(billing).getByLabelText('Area or locality')).toHaveValue('N.I.A.');
    await userEvent.selectOptions(within(billing).getByLabelText('Area or locality'), 'Baner Gaon');
    await userEvent.type(within(billing).getByLabelText('Building, street'), '12 Baner Road');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add contact' }));
    expect(await screen.findByText('Baner Traders added', {}, { timeout: 5000 })).toBeInTheDocument();
    expect(within(await row('Baner Traders')).getByText(/Pune, Maharashtra/)).toBeInTheDocument();
  }, 30_000);

  it('lets the city be typed when India Post doesn’t know the PIN', async () => {
    renderApp();
    await row('Kumar Logistics');
    await userEvent.click(screen.getByRole('button', { name: 'Add contact' }));
    await screen.findByRole('dialog', { name: 'New contact' }, { timeout: 5000 });
    // The dialog can remount under load: find it afresh and type the PIN again if it was lost
    const billing = () => within(screen.getByRole('dialog', { name: 'New contact' })).getAllByRole('group')[0]!;
    await waitFor(
      () => {
        const pin = within(billing()).getByLabelText('PIN code') as HTMLInputElement;
        if (pin.value !== '799001') fireEvent.change(pin, { target: { value: '799001' } });
        expect(within(billing()).getByText(/India Post doesn’t know this PIN code/)).toBeInTheDocument();
      },
      { timeout: 15_000 },
    );
    expect(within(billing()).getByLabelText('City or town').tagName).toBe('INPUT');
    fireEvent.change(within(billing()).getByLabelText('PIN code'), { target: { value: '7990011' } });
    expect(within(billing()).getByLabelText('PIN code')).toHaveValue('799001');
  }, 30_000);

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
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Kumar Logistics' })).toBeInTheDocument(), { timeout: 5000 });
    await waitFor(() => expect(screen.getByText(/^27AAKCK4821R1Z/)).toBeInTheDocument());
    expect(await screen.findByRole('link', { name: /^INV\/.*\/0001$/ }, { timeout: 5000 })).toBeInTheDocument();
    expect(await screen.findByText('No quotes for this customer yet', {}, { timeout: 5000 })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'New invoice' }));
    await waitFor(() => expect(router.state.location.search).toMatch(/^\?contact=/));
    await waitFor(() => expect((screen.getByLabelText('Customer') as HTMLSelectElement).selectedOptions[0]!.textContent).toBe('Kumar Logistics'), { timeout: 5000 });
  });

  it('warns on an invoice that takes a customer over their credit limit', { timeout: 20_000 }, async () => {
    const router = renderApp();
    await userEvent.click(within(await row('Kumar Logistics')).getByRole('button', { name: 'Actions for Kumar Logistics' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Edit' }));
    const limit = await screen.findByLabelText('Credit limit', {}, { timeout: 4000 });
    fireEvent.change(limit, { target: { value: '1000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Kumar Logistics saved', {}, { timeout: 4000 })).toBeInTheDocument();
    // An hour of development with GST is ₹2,950: over a ₹1,000 limit whatever Kumar already owes
    await router.navigate('/invoices/new?contact=c0000000-0000-4000-8000-000000000001');
    await waitFor(() => expect((screen.getByLabelText('Customer') as HTMLSelectElement).selectedOptions[0]!.textContent).toBe('Kumar Logistics'), { timeout: 5000 });
    const item = () => screen.getByLabelText('Item on line 1') as HTMLSelectElement;
    await waitFor(() => expect(item().options.length).toBeGreaterThan(2));
    await userEvent.selectOptions(item(), [...item().options].find((o) => o.textContent === 'Software development')!.value);
    await waitFor(() => expect(screen.getByTestId('credit-limit-warning')).toHaveTextContent(/over their credit limit of INR 1,000\.00/), { timeout: 4000 });
  });

  it('reminds a customer about all their overdue invoices from their page', { timeout: 20_000 }, async () => {
    // An invoice for Kumar already past due, dated in an open month: the 1st of this one (or yesterday, on the 1st)
    const { createDemoInvoicesApi } = await import('../invoices/demoInvoicesApi');
    const { sampleId } = await import('../accounts/demoAccountsApi');
    const { todayIn } = await import('@ledgernest/shared');
    const today = todayIn('Asia/Kolkata');
    const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    const date = today.endsWith('-01') ? yesterday : `${today.slice(0, 8)}01`;
    const invoices = createDemoInvoicesApi(() => true);
    const draft = await invoices.create({ contactId: 'c0000000-0000-4000-8000-000000000001', issueDate: date, dueDate: date, lines: [{ description: 'Freight', quantity: '1', unitPrice: 100_000, accountId: sampleId('4100.01') }] });
    await invoices.issue(draft.id);
    renderApp('/contacts/c0000000-0000-4000-8000-000000000001');
    const remind = await screen.findByRole('button', { name: /^Remind about overdue \(\d+\)$/ }, { timeout: 6000 });
    // Or on WhatsApp: the overdue list and the total, ready to send (Kumar's number on file is a landline, so WhatsApp asks who)
    const wa = decodeURIComponent((await screen.findByRole('link', { name: 'Remind on WhatsApp' })).getAttribute('href')!);
    expect(wa).toMatch(/^https:\/\/wa\.me\/\?text=Dear Kumar Logistics, a gentle reminder from .+\. These invoices are overdue:\n• INV\/.+ · ₹1,000\.00 · due /);
    expect(wa).toMatch(/\nTotal: ₹[\d,.]+\n/);
    // Sending it notes the chase, for Collections (the link opens WhatsApp in a new tab)
    vi.spyOn(window, 'open').mockImplementation(() => null);
    fireEvent.click(screen.getByRole('link', { name: 'Remind on WhatsApp' }));
    const { demoContactRows } = await import('../contacts/demoContactsApi');
    await waitFor(() => expect(demoContactRows().find((c) => c.name === 'Kumar Logistics')?.lastChasedAt).toBeTruthy(), { timeout: 4000 });
    fireEvent.click(remind);
    const dialog = await screen.findByRole('dialog', { name: 'Remind Kumar Logistics about overdue invoices?' });
    expect(dialog).toHaveTextContent('accounts@kumarlogistics.in');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send reminders' }));
    expect(await screen.findByText(/^In the demo nothing is really sent; \d+ reminders would go to accounts@kumarlogistics.in$/, {}, { timeout: 4000 })).toBeInTheDocument();
  });

  it('shares a customer’s account link, which shows them what they owe with each invoice', { timeout: 30_000 }, async () => {
    const { demoInvoiceViews, resetDemoInvoices } = await import('../invoices/demoInvoicesApi');
    resetDemoInvoices();
    // The month's invoice to Kumar, in the books
    await demoInvoiceViews();
    renderApp('/contacts/c0000000-0000-4000-8000-000000000001');
    let link = '';
    await waitFor(
      () => {
        if (!screen.queryByRole('dialog')) fireEvent.click(screen.getByRole('button', { name: /^Share account/ }));
        link = (within(screen.getByRole('dialog', { name: 'Account link for Kumar Logistics' })).getByLabelText('Account link') as HTMLInputElement).value;
        expect(link).toMatch(/\/c\/[A-Za-z0-9_-]{32}$/);
      },
      { timeout: 8000 },
    );
    expect(screen.getByTestId('account-message')).toHaveTextContent(/^Dear Kumar Logistics, here is your account with .+: ₹[\d,.]+ due\./);
    const token = link.split('/c/')[1]!;
    cleanup();
    sessionStorage.clear();
    renderApp(`/c/${token}`);
    expect(await screen.findByText('Account of Kumar Logistics Private Limited', {}, { timeout: 6000 })).toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Invoices' });
    expect(within(list).getByText(/^INV\/.+\/0001$/)).toBeInTheDocument();
    expect(within(list).getByRole('button', { name: /^Download INV\/.+\/0001 as PDF$/ })).toBeInTheDocument();
    // And their statement for the year
    let saved: Blob | undefined;
    Object.assign(URL, { createObjectURL: vi.fn((b: Blob) => ((saved = b), 'blob:pdf')), revokeObjectURL: vi.fn() });
    await userEvent.click(screen.getByRole('button', { name: 'Download your statement for this year' }));
    await waitFor(() => expect(saved).toBeDefined(), { timeout: 4000 });
    expect(new TextDecoder('latin1').decode(await saved!.arrayBuffer())).toContain('Kumar Logistics');
  });

  it('finds a contact and their invoice from the command palette', { timeout: 20_000 }, async () => {
    const router = renderApp('/');
    await screen.findByRole('navigation', { name: 'Main' }, { timeout: 5000 });
    await userEvent.keyboard('{Control>}k{/Control}');
    const dialog = await screen.findByRole('dialog', { name: 'Command palette' });
    await userEvent.type(within(dialog).getByRole('textbox'), 'Kumar');
    await waitFor(() => expect(within(dialog).getAllByRole('option').map((o) => o.textContent)).toEqual(expect.arrayContaining([expect.stringMatching(/^Kumar Logistics.*Contact$/), expect.stringMatching(/^INV\/.*Kumar Logistics.*Invoice$/)])), { timeout: 5000 });
    fireEvent.click(within(dialog).getAllByRole('option').find((o) => /Contact$/.test(o.textContent ?? ''))!.querySelector('button')!);
    await waitFor(() => expect(router.state.location.pathname).toBe('/contacts/c0000000-0000-4000-8000-000000000001'));
  });

  it('downloads customers and vendors as CSV, ready to import elsewhere', async () => {
    let saved: Blob | undefined;
    Object.assign(URL, { createObjectURL: vi.fn((b: Blob) => ((saved = b), 'blob:csv')), revokeObjectURL: vi.fn() });
    renderApp();
    await row('Kumar Logistics');
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    await waitFor(() => expect(saved).toBeDefined(), { timeout: 4000 });
    const lines = (await saved!.text()).replace(/^\uFEFF/, '').trim().split('\r\n').map((l) => l.replaceAll('"', ''));
    expect(lines[0]).toBe('name,kind,legal name,gstin,email,phone,address,city,state,pin code,country,currency,payment terms,credit limit,notes');
    // A leading + is guarded with an apostrophe so spreadsheets don't read it as a formula
    expect(lines.find((l) => l.startsWith('Kumar Logistics,'))).toMatch(/^Kumar Logistics,customer,Kumar Logistics Private Limited,27AAKCK4821R1Z.,accounts@kumarlogistics.in,'\+91 20 4011 2200,Plot 18, Hinjewadi Phase 2,Pune,Maharashtra,411057,IN,,15,,$/);
    expect(lines.find((l) => l.startsWith('Gulf Traders LLC,'))).toContain(',both,');
  });
});
