import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import AppProviders from '../AppProviders';
import { resetDemoAccounts, sampleId } from '../accounts/demoAccountsApi';
import { resetDemoBills } from '../bills/demoBillsApi';
import { demoContactRows, resetDemoContacts } from '../contacts/demoContactsApi';
import { routes } from '../routes';
import { demoTaxState } from '../taxes/demoTaxesApi';
import { createDemoPurchaseOrdersApi, resetDemoPurchaseOrders } from './demoPurchaseOrdersApi';

function renderApp(path: string) {
  sessionStorage.setItem('ledgernest.demo', 'admin@ledgernest.demo');
  render(
    <AppProviders client={null}>
      <RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />
    </AppProviders>,
  );
}

beforeEach(() => {
  for (const reset of [resetDemoPurchaseOrders, resetDemoBills, resetDemoContacts, resetDemoAccounts]) reset();
  sessionStorage.clear();
});

describe('purchase orders', () => {
  it('orders, receives part on a GRN, and bills what came', async () => {
    const api = createDemoPurchaseOrdersApi(() => true);
    const sharma = demoContactRows().find((c) => c.name === 'Sharma Office Supplies')!;
    const gst18 = demoTaxState().groups.find((g) => g.name === 'GST 18%')!.id;
    const po = await api.create({ contactId: sharma.id, orderDate: '2026-10-01', lines: [{ description: 'Printer paper (ream)', quantity: '10', unitPrice: 300_00, taxGroupId: gst18, accountId: sampleId('5300') }] });
    expect(po.number).toBe('PO-0001');
    await api.move(po.id, 'issued');
    renderApp(`/purchase-orders/${po.id}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Record goods received' }, { timeout: 10_000 }));
    const dialog = await screen.findByRole('dialog');
    const qty = within(dialog).getByLabelText(/Printer paper/);
    await userEvent.clear(qty);
    await userEvent.type(qty, '4');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record receipt' }));
    expect(await screen.findByText('GRN-0001 recorded', {}, { timeout: 6000 })).toBeInTheDocument();
    await waitFor(async () => expect((await api.get(po.id)).lines[0]).toMatchObject({ received: '4', toReceive: '6', toBill: '4' }));
    const { billId, purchaseOrder } = await api.bill(po.id);
    expect(purchaseOrder.lines[0]!.billed).toBe('4');
    const { createDemoBillsApi } = await import('../bills/demoBillsApi');
    expect((await createDemoBillsApi(() => true).get(billId)).lines[0]).toMatchObject({ quantity: '4', amount: 1_200_00 });
    await expect(api.bill(po.id)).rejects.toMatchObject({ details: { reason: 'nothing_to_bill' } });
  }, 30_000);

  it('lists orders, and drafts a new one from the page', async () => {
    renderApp('/purchase-orders');
    await userEvent.click(await screen.findByRole('button', { name: 'New purchase order' }, { timeout: 10_000 }));
    await screen.findByLabelText('Vendor', {}, { timeout: 10_000 });
    await waitFor(() => expect((screen.getByLabelText('Vendor') as HTMLSelectElement).options.length).toBeGreaterThan(1), { timeout: 10_000 });
    await userEvent.selectOptions(screen.getByLabelText('Vendor'), demoContactRows().find((c) => c.name === 'Sharma Office Supplies')!.id);
    await userEvent.type(screen.getByLabelText('Description on line 1'), 'Toner');
    await userEvent.type(screen.getByLabelText('Price on line 1'), '2500');
    await userEvent.selectOptions(screen.getByLabelText('Account for line 1'), sampleId('5300'));
    await userEvent.click(screen.getByRole('button', { name: 'Save order' }));
    expect(await screen.findByText('PO-0001 saved', {}, { timeout: 6000 })).toBeInTheDocument();
  }, 30_000);
});
