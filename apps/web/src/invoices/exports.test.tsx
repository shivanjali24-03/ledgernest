import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import AppProviders from '../AppProviders';
import { resetDemoAccounts, sampleId } from '../accounts/demoAccountsApi';
import { demoContactRows, resetDemoContacts } from '../contacts/demoContactsApi';
import { createDemoSettingsApi, resetDemoSettings } from '../settings/demoSettingsApi';
import { demoTaxState } from '../taxes/demoTaxesApi';
import { routes } from '../routes';
import { createDemoInvoicesApi, resetDemoInvoices } from './demoInvoicesApi';

function renderApp(path: string) {
  sessionStorage.setItem('ledgernest.demo', 'admin@ledgernest.demo');
  render(
    <AppProviders client={null}>
      <RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />
    </AppProviders>,
  );
}

beforeEach(() => {
  for (const reset of [resetDemoInvoices, resetDemoContacts, resetDemoAccounts, resetDemoSettings]) reset();
  sessionStorage.clear();
});

const gst18 = () => demoTaxState().groups.find((g) => g.name === 'GST 18%')!.id;
const line = () => ({ description: 'Software services', quantity: '1', unitPrice: 1_000_00, accountId: sampleId('4100.01'), taxGroupId: gst18() });

describe('exports and SEZ supplies', () => {
  it('leaves tax off an export under LUT, with no Indian place of supply', async () => {
    const northwind = demoContactRows().find((c) => c.name === 'Northwind Inc.')!;
    const d = await createDemoInvoicesApi(() => true).create({ contactId: northwind.id, issueDate: '2026-10-01', supplyKind: 'export_lut', exportDetails: { portCode: 'INBOM4', shippingBillNo: '1234567', shippingBillDate: '2026-10-02', countryCode: 'US' }, lines: [line()] });
    expect(d).toMatchObject({ supplyKind: 'export_lut', placeOfSupply: null, taxTotal: 0, exportDetails: { portCode: 'INBOM4' } });
  });

  it('charges IGST, not CGST + SGST, on a supply to an SEZ in the same state', async () => {
    const kumar = demoContactRows().find((c) => c.name === 'Kumar Logistics')!;
    const d = await createDemoInvoicesApi(() => true).create({ contactId: kumar.id, issueDate: '2026-10-01', supplyKind: 'sez_with_igst', lines: [line()] });
    expect(d.taxTotal).toBe(180_00);
    expect(d.taxBreakdown.map((x) => x.name).join()).toMatch(/IGST/);
  });

  it('refuses zero-rating without a LUT covering the date', async () => {
    await createDemoSettingsApi(() => true).update({ lutNumber: null });
    const kumar = demoContactRows().find((c) => c.name === 'Kumar Logistics')!;
    await expect(createDemoInvoicesApi(() => true).create({ contactId: kumar.id, issueDate: '2026-10-01', supplyKind: 'sez_lut', lines: [line()] })).rejects.toMatchObject({ details: { reason: 'no_lut' } });
  });

  it('asks for shipping bill details on an export and prints the declaration', async () => {
    renderApp('/invoices/new');
    const kind = (await screen.findByLabelText('Type of supply', {}, { timeout: 10_000 })) as HTMLSelectElement;
    expect(screen.getByLabelText('Place of supply')).toBeInTheDocument();
    await userEvent.selectOptions(kind, 'export_lut');
    await waitFor(() => expect(screen.queryByLabelText('Place of supply')).not.toBeInTheDocument());
    expect(screen.getByLabelText('Shipping bill no.')).toBeInTheDocument();
    expect(screen.getByText(/your LUT must cover/)).toBeInTheDocument();
  }, 30_000);

  it('shows the export declaration on the invoice', async () => {
    const northwind = demoContactRows().find((c) => c.name === 'Northwind Inc.')!;
    const d = await createDemoInvoicesApi(() => true).create({ contactId: northwind.id, issueDate: '2026-10-01', supplyKind: 'export_lut', exportDetails: { shippingBillNo: '1234567' }, rate: '83.25', lines: [line()] });
    await createDemoInvoicesApi(() => true).issue(d.id);
    renderApp(`/invoices/${d.id}`);
    await screen.findByText(/without payment of IGST \(LUT AD270326001234X\)/, {}, { timeout: 10_000 });
    expect(screen.getByTestId('invoice-supply-declaration')).toHaveTextContent('Shipping bill no.: 1234567');
  }, 30_000);
});

describe('reverse charge on sales', () => {
  it('charges no GST, keeping the tax the buyer pays', async () => {
    const kumar = demoContactRows().find((c) => c.name === 'Kumar Logistics')!;
    const api = createDemoInvoicesApi(() => true);
    const d = await api.create({ contactId: kumar.id, issueDate: '2026-10-01', reverseCharge: true, lines: [line()] });
    expect(d).toMatchObject({ reverseCharge: true, taxTotal: 0, total: 1_000_00 });
    expect(d.lines[0]!.taxGroup).toBeNull();
    expect(d.lines[0]!.rcmTaxGroup?.name).toBe('GST 18%');
    expect(d.reverseChargeTax).toEqual([
      { name: 'CGST 9%', amount: 90_00 },
      { name: 'SGST 9%', amount: 90_00 },
    ]);
    await api.issue(d.id);
    renderApp(`/invoices/${d.id}`);
    expect(await screen.findByTestId('invoice-reverse-charge', {}, { timeout: 10_000 })).toHaveTextContent('Whether tax is payable on reverse charge: Yes');
  }, 30_000);

  it('refuses it for an unregistered buyer or an export', async () => {
    const api = createDemoInvoicesApi(() => true);
    const northwind = demoContactRows().find((c) => c.name === 'Northwind Inc.')!;
    await expect(api.create({ contactId: northwind.id, issueDate: '2026-10-01', reverseCharge: true, lines: [line()] })).rejects.toMatchObject({ details: { reason: 'rcm_unregistered' } });
    const kumar = demoContactRows().find((c) => c.name === 'Kumar Logistics')!;
    await expect(api.create({ contactId: kumar.id, issueDate: '2026-10-01', supplyKind: 'sez_with_igst', reverseCharge: true, lines: [line()] })).rejects.toMatchObject({ details: { reason: 'rcm_kind' } });
  });

  it('shows the buyer’s GST in the draft’s totals instead of charging it', async () => {
    renderApp('/invoices/new');
    await userEvent.type(await screen.findByLabelText('Description on line 1', {}, { timeout: 10_000 }), 'Transport');
    await userEvent.type(screen.getByLabelText('Price on line 1'), '1000');
    await userEvent.click(await screen.findByRole('checkbox', { name: /Buyer pays GST/ }, { timeout: 10_000 }));
    expect(screen.getByRole('status', { name: 'Totals' })).toHaveTextContent('GST payable by the buyer');
  }, 30_000);
});

describe('GST registration type', () => {
  it('makes supplies to an SEZ customer zero-rated, choosing it for them on the invoice', async () => {
    const { createDemoContactsApi } = await import('../contacts/demoContactsApi');
    const { gstinCheckChar } = await import('@ledgernest/shared');
    const g = (s: string) => `${s}${gstinCheckChar(s)}`;
    const sez = await createDemoContactsApi(() => true).create({ name: 'Magarpatta SEZ unit', isCustomer: true, isVendor: false, gstTreatment: 'sez', taxId: g('27AABCM9876K1Z'), billingAddress: { line1: null, line2: null, city: 'Pune', region: 'Maharashtra', postalCode: null, country: 'IN' } });
    await expect(createDemoInvoicesApi(() => true).create({ contactId: sez.id, issueDate: '2026-10-01', lines: [line()] })).rejects.toMatchObject({ details: { reason: 'sez_customer' } });
    renderApp('/invoices/new');
    await screen.findByLabelText('Type of supply', {}, { timeout: 10_000 });
    const customer = screen.getByLabelText('Customer') as HTMLSelectElement;
    await waitFor(() => expect([...customer.options].map((x) => x.value)).toContain(sez.id), { timeout: 10_000 });
    await userEvent.selectOptions(customer, sez.id);
    // The demo company has a LUT
    await waitFor(() => expect(screen.getByLabelText('Type of supply')).toHaveValue('sez_lut'));
  }, 30_000);
});
