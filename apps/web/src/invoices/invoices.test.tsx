import { vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import AppProviders from '../AppProviders';
import { resetDemoAccounts } from '../accounts/demoAccountsApi';
import { resetDemoContacts } from '../contacts/demoContactsApi';
import { resetDemoCurrencies } from '../currencies/demoCurrenciesApi';
import { resetDemoItems } from '../items/demoItemsApi';
import { resetDemoJournals } from '../journals/demoJournalsApi';
import { resetDemoPeriods } from '../periods/demoPeriodsApi';
import { routes } from '../routes';
import { resetDemoTaxes } from '../taxes/demoTaxesApi';
import { resetDemoInvoices } from './demoInvoicesApi';
import { openDialog } from '../test/openDialog';

function renderApp(path = '/invoices') {
  sessionStorage.setItem('ledgernest.demo', 'admin@ledgernest.demo');
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <AppProviders client={null}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return router;
}
/** Signed out, as a customer would be */
function renderPath(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <AppProviders client={null}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
}
const previewAs = (role: string) => userEvent.selectOptions(screen.getByLabelText('Preview the app as a role'), role);
const totals = () => screen.getByRole('status', { name: 'Totals' });

beforeEach(() => {
  for (const reset of [resetDemoInvoices, resetDemoJournals, resetDemoAccounts, resetDemoPeriods, resetDemoTaxes, resetDemoContacts, resetDemoItems, resetDemoCurrencies]) reset();
  sessionStorage.clear();
});

describe('invoices', () => {
  it('lists the month’s invoice and a draft, with what is outstanding', async () => {
    renderApp();
    const issued = (await screen.findByRole('link', { name: /^INV\/.*\/0001$/ }, { timeout: 4000 })).closest('tr')!;
    expect(within(issued).getByText('Kumar Logistics')).toBeInTheDocument();
    expect(within(issued).getAllByText('₹1,18,000.00')).toHaveLength(2);
    expect(screen.getByRole('link', { name: 'Draft' }).closest('tr')!).toHaveTextContent('Bluewave Clinics');
    expect(screen.getByText('Outstanding').closest('div')!).toHaveTextContent('₹1,18,000.00');
  });

  it('issues the draft to a customer in Karnataka with IGST, ready to print', async () => {
    renderApp();
    await userEvent.click(await screen.findByRole('link', { name: 'Draft' }, { timeout: 4000 }));
    await screen.findByRole('heading', { name: 'Draft invoice' });
    // 24 hours at ₹2,500 and a year's maintenance less 10%: ₹1,68,000, with IGST because Bluewave is in another state
    await waitFor(() => expect(totals()).toHaveTextContent('IGST 18%'));
    expect(totals()).toHaveTextContent('1,68,000.00');
    expect(totals()).toHaveTextContent('30,240.00');
    expect(totals()).toHaveTextContent('INR 1,98,240.00');
    expect(screen.getByText('Another state: IGST')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Issue' }));
    expect(await screen.findByText(/^Issued as INV\//, {}, { timeout: 4000 })).toBeInTheDocument();
    const doc = await screen.findByRole('article', {}, { timeout: 4000 });
    expect(within(doc).getByText('Tax invoice')).toBeInTheDocument();
    expect(within(doc).getByText('Place of supply: Karnataka (29)')).toBeInTheDocument();
    expect(within(doc).getByText('HSN/SAC 998314')).toBeInTheDocument();
    expect(within(doc).getByText('₹1,98,240.00')).toBeInTheDocument();
    expect(screen.getByText('Posted as').parentElement!.querySelector('a')!.textContent).toMatch(/^JV\//);
    expect(screen.getByRole('button', { name: 'Print or save as PDF' })).toBeInTheDocument();
  }, 20_000);

  it('charges no GST under the composition scheme, even for an item that usually carries it', async () => {
    const { createDemoSettingsApi, resetDemoSettings } = await import('../settings/demoSettingsApi');
    await createDemoSettingsApi(() => true).update({ gstScheme: 'composition' });
    try {
      renderApp('/invoices/new');
      const customer = (await screen.findByLabelText('Customer')) as HTMLSelectElement;
      await waitFor(() => expect(customer.options.length).toBeGreaterThan(2));
      await userEvent.selectOptions(customer, [...customer.options].find((o) => o.textContent === 'Kumar Logistics')!.value);
      const item = screen.getByLabelText('Item on line 1') as HTMLSelectElement;
      await waitFor(() => expect(item.options.length).toBeGreaterThan(2));
      await userEvent.selectOptions(item, [...item.options].find((o) => o.textContent === 'Software development')!.value);
      const tax = screen.getByLabelText('Tax on line 1') as HTMLSelectElement;
      await waitFor(() => expect(tax).toBeDisabled());
      expect(tax.value).toBe('');
      expect(totals()).not.toHaveTextContent('CGST');
    } finally {
      resetDemoSettings();
    }
  }, 20_000);

  it('fills a line from an item and charges CGST + SGST within Maharashtra', async () => {
    renderApp('/invoices/new');
    const customer = (await screen.findByLabelText('Customer')) as HTMLSelectElement;
    await waitFor(() => expect(customer.options.length).toBeGreaterThan(2));
    await userEvent.selectOptions(customer, [...customer.options].find((o) => o.textContent === 'Kumar Logistics')!.value);
    const item = screen.getByLabelText('Item on line 1') as HTMLSelectElement;
    await waitFor(() => expect(item.options.length).toBeGreaterThan(2));
    await userEvent.selectOptions(item, [...item.options].find((o) => o.textContent === 'Software development')!.value);
    expect(screen.getByLabelText('Description on line 1')).toHaveValue('Software development');
    expect(screen.getByLabelText('Price on line 1')).toHaveValue('2,500.00');
    await userEvent.clear(screen.getByLabelText('Quantity on line 1'));
    await userEvent.type(screen.getByLabelText('Quantity on line 1'), '8');
    await waitFor(() => expect(totals()).toHaveTextContent('CGST 9%'));
    expect(totals()).toHaveTextContent('SGST 9%');
    expect(totals()).toHaveTextContent('INR 23,600.00');
    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByText('Draft saved', {}, { timeout: 4000 })).toBeInTheDocument();
  });

  it('voids an unpaid invoice', { timeout: 20_000 }, async () => {
    renderApp();
    await userEvent.click(await screen.findByRole('link', { name: /^INV\/.*\/0001$/ }, { timeout: 4000 }));
    // Wait for the invoice itself, so the header (and its Void button) has settled
    await screen.findByRole('article', {}, { timeout: 4000 });
    await screen.findByRole('button', { name: 'Record payment' });
    // Plain clicks, retried until they take: open the dialog (only while it's closed, as a second click would land
    // outside it) and confirm in the same step, as the header re-renders while the invoice's details load
    await waitFor(
      () => {
        if (!screen.queryByText(/^Its entry is reversed today/)) fireEvent.click(screen.getByRole('button', { name: 'Void' }));
        const dialog = screen.getByText(/^Its entry is reversed today/).closest('[role="dialog"]') as HTMLElement;
        expect(dialog).toHaveTextContent(/^Void INV\//);
        fireEvent.click(within(dialog).getByRole('button', { name: 'Void' }));
      },
      { timeout: 6000 },
    );
    // The invoice records its reversal (more lasting than the toast, which can come and go under load)
    await waitFor(() => expect(screen.getByText(/Posted as/)).toHaveTextContent(/Voided by JV\//), { timeout: 8000 });
  });

  it('sends a payment reminder, and remembers it', { timeout: 20_000 }, async () => {
    renderApp();
    await userEvent.click(await screen.findByRole('link', { name: /^INV\/.*\/0001$/ }, { timeout: 4000 }));
    await screen.findByRole('article', {}, { timeout: 4000 });
    await screen.findByRole('button', { name: 'Record payment' }, { timeout: 4000 });
    // Open the dialog and send in one step, retried, as the header re-renders while the invoice loads
    let sent = false;
    await waitFor(
      () => {
        if (sent) return;
        if (!screen.queryByRole('dialog')) fireEvent.click(screen.getByRole('button', { name: 'Send reminder' }));
        const dialog = screen.getByRole('dialog', { name: /^Payment reminder for INV\// });
        expect(within(dialog).getByLabelText('Send to')).toHaveValue('accounts@kumarlogistics.in');
        expect(dialog).toHaveTextContent('1,18,000.00');
        fireEvent.click(within(dialog).getByRole('button', { name: 'Send reminder' }));
        sent = true;
      },
      { timeout: 8000 },
    );
    await waitFor(() => expect(screen.getByText(/Posted as/)).toHaveTextContent(/Reminders sent: 1, last on/), { timeout: 8000 });
  });

  it('duplicates an issued invoice into a new draft dated today', { timeout: 20_000 }, async () => {
    const router = renderApp();
    await userEvent.click(await screen.findByRole('link', { name: /^INV\/.*\/0001$/ }, { timeout: 4000 }));
    await screen.findByRole('article', {}, { timeout: 4000 });
    await waitFor(
      () => {
        if (!router.state.location.search.includes('copy=')) fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }));
        expect(router.state.location.search).toMatch(/^\?copy=/);
      },
      { timeout: 6000 },
    );
    await waitFor(() => expect(screen.getByLabelText('Description on line 1')).toHaveValue('Software development, sprint 14'), { timeout: 4000 });
    await waitFor(() => expect((screen.getByLabelText('Customer') as HTMLSelectElement).selectedOptions[0]!.textContent).toBe('Kumar Logistics'), { timeout: 4000 });
    expect(screen.getByLabelText('Reference')).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/invoices\/[0-9a-f-]{36}$/), { timeout: 6000 });
  });

  it('emails an issued invoice to the customer', { timeout: 20_000 }, async () => {
    renderApp();
    await userEvent.click(await screen.findByRole('link', { name: /^INV\/.*\/0001$/ }, { timeout: 4000 }));
    await screen.findByRole('article', {}, { timeout: 4000 });
    await screen.findByRole('button', { name: 'Email' }, { timeout: 4000 });
    // Open the dialog and send in one step, retried, as the header re-renders while the invoice loads
    let sent = false;
    await waitFor(
      () => {
        if (sent) return;
        if (!screen.queryByRole('dialog')) fireEvent.click(screen.getByRole('button', { name: 'Email' }));
        const dialog = screen.getByRole('dialog', { name: /^Email INV\/.* to the customer$/ });
        expect(within(dialog).getByLabelText('Send to')).toHaveValue('accounts@kumarlogistics.in');
        fireEvent.click(within(dialog).getByRole('button', { name: 'Send' }));
        sent = true;
      },
      { timeout: 8000 },
    );
    await waitFor(() => expect(screen.getByText('In the demo nothing is really sent; it would go to accounts@kumarlogistics.in')).toBeInTheDocument(), { timeout: 4000 });
  });

  it('downloads the list as CSV, with the filter in use', async () => {
    let saved: Blob | undefined;
    Object.assign(URL, { createObjectURL: vi.fn((b: Blob) => ((saved = b), 'blob:csv')), revokeObjectURL: vi.fn() });
    renderApp();
    await screen.findByRole('link', { name: /^INV\/.*\/0001$/ }, { timeout: 4000 });
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    await waitFor(() => expect(saved).toBeDefined(), { timeout: 4000 });
    const text = await saved!.text();
    expect(text.replace(/^\uFEFF/, '').split('\r\n')[0]).toBe('"number","state","issue_date","due_date","customer","reference","currency","total","paid","balance"');
    expect(text).toMatch(/"INV\/[^"]+\/0001","[a-z_]+","[\d-]+","[\d-]+","Kumar Logistics","PO-4471","INR","1180\d\d\.00"/);
  });

  it('downloads an issued invoice as PDF', { timeout: 20_000 }, async () => {
    let saved: Blob | undefined;
    Object.assign(URL, { createObjectURL: vi.fn((b: Blob) => ((saved = b), 'blob:pdf')), revokeObjectURL: vi.fn() });
    renderApp();
    await userEvent.click(await screen.findByRole('link', { name: /^INV\/.*\/0001$/ }, { timeout: 4000 }));
    await screen.findByRole('article', {}, { timeout: 4000 });
    await waitFor(
      () => {
        if (!saved) fireEvent.click(screen.getByRole('button', { name: 'Download PDF' }));
        expect(saved).toBeDefined();
      },
      { timeout: 8000 },
    );
    const text = new TextDecoder('latin1').decode(await saved!.arrayBuffer());
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toMatch(/\(Tax invoice INV\/[^)]+\/0001\) Tj/);
    expect(text).toContain('(Amount in words: Indian Rupees One Lakh Eighteen Thousand Only) Tj');
    // And on screen, under the totals
    await waitFor(() => expect(screen.getByTestId('amount-in-words')).toHaveTextContent('Amount in words: Indian Rupees One Lakh Eighteen Thousand Only'));
  });

  it('shows a pay-by-UPI QR code for what is owed once the UPI ID is set, and puts it in the PDF', { timeout: 20_000 }, async () => {
    let saved: Blob | undefined;
    Object.assign(URL, { createObjectURL: vi.fn((b: Blob) => ((saved = b), 'blob:pdf')), revokeObjectURL: vi.fn() });
    localStorage.removeItem('ledgernest.demo.settings');
    renderApp('/settings');
    const upi = await screen.findByLabelText('UPI ID', {}, { timeout: 4000 });
    await userEvent.type(upi, 'nope');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Enter a UPI ID like yourname@okhdfcbank.')).toBeInTheDocument();
    await userEvent.clear(upi);
    await userEvent.type(upi, 'nestdemo@okhdfcbank');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(JSON.parse(localStorage.getItem('ledgernest.demo.settings')!).settings.upiId).toBe('nestdemo@okhdfcbank'));
    cleanup();
    renderApp();
    await userEvent.click(await screen.findByRole('link', { name: /^INV\/.*\/0001$/ }, { timeout: 4000 }));
    // Found afresh each try: the page can remount while the invoice and settings load
    await waitFor(
      () => {
        const card = screen.getByTestId('invoice-upi');
        expect(within(card).getByRole('img', { name: 'QR code to pay ₹1,18,000.00 to nestdemo@okhdfcbank by UPI' })).toBeInTheDocument();
        expect(within(card).getByRole('link', { name: 'Pay with a UPI app' }).getAttribute('href')).toMatch(/^upi:\/\/pay\?pa=nestdemo%40okhdfcbank&pn=Nest%20Demo%20Private%20Limited&am=118000\.00&cu=INR&tn=Invoice%20INV%2F/);
      },
      { timeout: 8000 },
    );
    await waitFor(
      () => {
        if (!saved) fireEvent.click(screen.getByRole('button', { name: 'Download PDF' }));
        expect(saved).toBeDefined();
      },
      { timeout: 8000 },
    );
    const text = new TextDecoder('latin1').decode(await saved!.arrayBuffer());
    expect(text).toContain('(Rs 118000.00 to nestdemo@okhdfcbank) Tj');
    localStorage.removeItem('ledgernest.demo.settings');
  });

  it('shares an invoice by link and WhatsApp; the customer opens it without signing in, and the link can be turned off', { timeout: 30_000 }, async () => {
    renderApp();
    await userEvent.click(await screen.findByRole('link', { name: /^INV\/.*\/0001$/ }, { timeout: 4000 }));
    const dialog = await openDialog('Share', /^Share invoice/);
    const link = (await within(dialog).findByLabelText('Invoice link', {}, { timeout: 4000 })) as HTMLInputElement;
    const token = /\/i\/([A-Za-z0-9_-]{32})$/.exec(link.value)![1]!;
    // The invoice message (a reminder is ready instead once the invoice is overdue)
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Send the invoice' }));
    const wa = within(dialog).getByRole('link', { name: 'Send on WhatsApp' }).getAttribute('href')!;
    // Kumar's number on file is a landline, so WhatsApp asks who to send it to
    expect(wa.startsWith('https://wa.me/?text=')).toBe(true);
    expect(decodeURIComponent(wa.split('text=')[1]!)).toMatch(new RegExp(`^Dear Kumar Logistics, here is invoice INV/.+/0001 from .+ for ₹1,18,000\\.00, due on .+\\. View it, download the PDF or pay by UPI here: ${link.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Payment reminder' }));
    expect(within(dialog).getByTestId('share-message')).toHaveTextContent(/^Dear Kumar Logistics, a gentle reminder that invoice INV\/.+\/0001 from .+ for ₹1,18,000\.00 was due on /);
    expect(decodeURIComponent(within(dialog).getByRole('link', { name: 'Send on WhatsApp' }).getAttribute('href')!)).toContain('a gentle reminder');
    expect(within(dialog).getByText('Not opened yet.')).toBeInTheDocument();
    cleanup();

    // The customer, signed out, opens the link
    sessionStorage.clear();
    renderPath(`/i/${token}`);
    expect(await screen.findByText('Amount due', {}, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getAllByText('₹1,18,000.00').length).toBeGreaterThan(0);
    expect(screen.getByRole('article', { name: /^Invoice INV\// })).toHaveTextContent('Software development, sprint 14');
    expect(screen.getByRole('button', { name: 'Download PDF' })).toBeInTheDocument();
    cleanup();

    // The business sees it was opened, and turns the link off
    renderApp();
    await userEvent.click(await screen.findByRole('link', { name: /^INV\/.*\/0001$/ }, { timeout: 4000 }));
    const again = await openDialog('Share · opened 1×', /^Share invoice/);
    expect(await within(again).findByText(/^Opened once, /, {}, { timeout: 4000 })).toBeInTheDocument();
    fireEvent.click(within(again).getByRole('button', { name: 'Turn off link' }));
    expect(await screen.findByRole('button', { name: 'Share' }, { timeout: 4000 })).toBeInTheDocument();
    cleanup();
    renderPath(`/i/${token}`);
    expect(await screen.findByText('This invoice link doesn’t work', {}, { timeout: 4000 })).toBeInTheDocument();
  });

  it('downloads an issued B2B invoice as GST e-invoice JSON, or says what the portal needs', { timeout: 20_000 }, async () => {
    let saved: Blob | undefined;
    Object.assign(URL, { createObjectURL: vi.fn((b: Blob) => ((saved = b), 'blob:json')), revokeObjectURL: vi.fn() });
    renderApp();
    await userEvent.click(await screen.findByRole('link', { name: /^INV\/.*\/0001$/ }, { timeout: 4000 }));
    await screen.findByRole('article', {}, { timeout: 4000 });
    await waitFor(
      () => {
        if (!saved) fireEvent.click(screen.getByRole('button', { name: 'e-Invoice JSON' }));
        expect(saved).toBeDefined();
      },
      { timeout: 8000 },
    );
    const json = JSON.parse(await saved!.text()) as { Version: string; DocDtls: { Typ: string; No: string }; SellerDtls: { Gstin: string; Pin: number }; BuyerDtls: { LglNm: string; Pos: string }; ItemList: { HsnCd: string; Qty: number; AssAmt: number; CgstAmt: number }[]; ValDtls: { TotInvVal: number } };
    expect(json).toMatchObject({ Version: '1.1', DocDtls: { Typ: 'INV' }, SellerDtls: { Gstin: '27AAPFN1234C1Z5', Pin: 411045 }, BuyerDtls: { LglNm: 'Kumar Logistics Private Limited', Pos: '27' }, ItemList: [{ HsnCd: '998314', Qty: 40, AssAmt: 100000, CgstAmt: 9000 }], ValDtls: { TotInvVal: 118000 } });
    expect(json.DocDtls.No).toMatch(/^INV\/.+\/0001$/);

    // Without the organisation's PIN code the portal would refuse it: say so, with where to fix it
    const { createDemoSettingsApi, resetDemoSettings } = await import('../settings/demoSettingsApi');
    await createDemoSettingsApi(() => true).update({ address: { postalCode: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'e-Invoice JSON' }));
    const dialog = await screen.findByRole('dialog', { name: 'Not ready for the e-invoice portal' }, { timeout: 4000 });
    expect(within(dialog).getByText('Your organisation’s PIN code is missing or not 6 digits.')).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: 'Fix' })).toHaveAttribute('href', '/settings');
    resetDemoSettings();
  });

  it('is read-only for Auditors', async () => {
    renderApp();
    await screen.findByRole('link', { name: /^INV\// }, { timeout: 4000 });
    await previewAs('auditor');
    await waitFor(() => expect(screen.queryByRole('button', { name: 'New invoice' })).not.toBeInTheDocument());
  });

  it('records the IRN from the portal’s response, pasted in', { timeout: 30_000 }, async () => {
    renderApp();
    await userEvent.click(await screen.findByRole('link', { name: /^INV\/.*\/0001$/ }, { timeout: 6000 }));
    await screen.findByRole('article', {}, { timeout: 6000 });
    // Found is enough: the page can re-render right after, leaving a found element detached
    await screen.findByText('Not registered on the e-invoice portal yet.', {}, { timeout: 12_000 });
    const irn = 'a5c12dca80e743321740b001fd70953e8738d109865d28ba4013750f2046f229';
    const response = JSON.stringify({ Status: 1, Data: { AckNo: 112610036563310, AckDt: '2026-11-10 11:05:00', Irn: irn, SignedQRCode: 'eyJhbGciOiJSUzI1NiJ9.eyJJcm4iOiJ4In0.c2ln', Status: 'ACT' } });
    // Open, paste and save in one retried step: under load the page can re-render and close the dialog
    await waitFor(
      () => {
        let dialog = screen.queryByRole('dialog');
        if (!dialog) {
          fireEvent.click(screen.getByRole('button', { name: 'Add IRN' }));
          dialog = screen.getByRole('dialog');
        }
        fireEvent.change(within(dialog).getByLabelText('The portal’s response (JSON)'), { target: { value: response } });
        expect(within(dialog).getByLabelText('IRN')).toHaveValue(irn);
        expect(within(dialog).getByLabelText('Ack No')).toHaveValue('112610036563310');
        fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
      },
      { timeout: 10_000 },
    );
    await screen.findByText(`e-Invoice registered · IRN ${irn} · Ack 112610036563310`, {}, { timeout: 10_000 });
  });
});
