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
