import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import AppProviders from '../AppProviders';
import { resetDemoAccounts } from '../accounts/demoAccountsApi';
import { routes } from '../routes';
import { resetDemoGstSlabs } from './demoGstSlabs';
import { resetDemoTaxes } from './demoTaxesApi';

function renderApp(path = '/taxes') {
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
/** A tax group's row (rates can share a group's name, e.g. IGST 18%, but they're table rows) */
const groupRow = async (name: string) => (await screen.findAllByText(name, { selector: 'li span.font-medium' }))[0]!.closest('li')!;

beforeEach(() => {
  resetDemoTaxes();
  resetDemoGstSlabs();
  resetDemoAccounts();
  sessionStorage.clear();
});

describe('taxes', () => {
  it('shows the sample company’s GST: CGST + SGST within Maharashtra, IGST between states', async () => {
    renderApp();
    expect(await screen.findByRole('heading', { name: 'GST in Maharashtra (state code 27)' })).toBeInTheDocument();
    expect(screen.getByText(/Sales within your state carry CGST \+ SGST/)).toBeInTheDocument();
    const gst18 = await groupRow('GST 18%');
    expect(within(gst18).getByText('CGST 9% + SGST 9%')).toBeInTheDocument();
    expect(within(gst18).getByText('Within the state')).toBeInTheDocument();
    expect(within(await groupRow('IGST 18%')).getByText('Between states')).toBeInTheDocument();
    expect(within(await groupRow('GST 40%')).getByText('CGST 20% + SGST 20%')).toBeInTheDocument();
    // The retired 12% slab isn't set up until it's asked for
    expect(screen.queryByText('GST 12% (to 2025-09-21)')).not.toBeInTheDocument();
    const cgst9 = screen.getByRole('cell', { name: /^CGST 9%/ }).closest('tr')!;
    expect(within(cgst9).getByText('2200.01 · CGST output')).toBeInTheDocument();
    expect(within(cgst9).getByText('1400.01 · CGST input')).toBeInTheDocument();
  });

  it('sets up a retired slab for back-dated entries', async () => {
    renderApp();
    await userEvent.click(await screen.findByRole('button', { name: 'Set up GST' }));
    const dialog = await screen.findByRole('dialog', { name: 'Set up GST' });
    // Everything in force is already set up, so nothing is ticked yet
    expect(within(dialog).getByRole('button', { name: 'Set up (0)' })).toBeDisabled();
    const retired = within(dialog).getByRole('group', { name: 'Retired (for older entries)' });
    await userEvent.click(within(retired).getAllByRole('checkbox')[0]!);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Set up (1)' }));
    expect(await screen.findByText('GST set up: 2 groups added')).toBeInTheDocument();
    expect(within(await groupRow('GST 12% (to 2025-09-21)')).getByText('CGST 6% + SGST 6%')).toBeInTheDocument();
  });

  it('adds a rate, refusing an asset as the account for tax on sales, then groups it', async () => {
    renderApp();
    await userEvent.click(await screen.findByRole('button', { name: 'Add rate' }));
    const dialog = await screen.findByRole('dialog', { name: 'New tax rate' });
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Compensation cess 1%');
    await userEvent.selectOptions(within(dialog).getByLabelText('Tax'), 'cess');
    await userEvent.type(within(dialog).getByLabelText('Rate (%)'), '1');
    // Only liabilities are offered for tax on sales
    const output = within(dialog).getByLabelText('Account for tax on sales');
    expect(within(output).queryByRole('option', { name: '1100 · Bank accounts' })).not.toBeInTheDocument();
    await userEvent.selectOptions(output, '2300 · TDS payable');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add rate' }));
    expect(await screen.findByText('Compensation cess 1% added')).toBeInTheDocument();
    await screen.findByRole('cell', { name: /^Compensation cess 1%/ });

    await userEvent.click(screen.getByRole('button', { name: 'Add group' }));
    const g = await screen.findByRole('dialog', { name: 'New tax group' });
    await userEvent.type(within(g).getByLabelText('Name'), 'GST 40% with cess');
    await userEvent.click(within(g).getByRole('checkbox', { name: /CGST 20%/ }));
    await userEvent.click(within(g).getByRole('checkbox', { name: /SGST 20%/ }));
    await userEvent.click(within(g).getByRole('checkbox', { name: /Compensation cess 1%/ }));
    expect(within(g).getByText('Total: 41%')).toBeInTheDocument();
    await userEvent.click(within(g).getByRole('button', { name: 'Add group' }));
    expect(within(await groupRow('GST 40% with cess')).getByText('CGST 20% + SGST 20% + Compensation cess 1%')).toBeInTheDocument();
  });

  it('won’t archive a rate an active group uses', async () => {
    renderApp();
    const cgst9 = (await screen.findByRole('cell', { name: /^CGST 9%/ })).closest('tr')!;
    await userEvent.click(within(cgst9).getByRole('button', { name: 'Actions for CGST 9%' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Archive' }));
    expect(await screen.findByText('Active tax groups use this rate. Archive them first.')).toBeInTheDocument();
  });

  it('lets read-only roles see taxes but not change them', async () => {
    renderApp();
    await groupRow('GST 18%');
    await previewAs('viewer');
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Add rate' })).not.toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Set up GST' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Actions for GST 18%' })).not.toBeInTheDocument();
    expect(await groupRow('GST 18%')).toBeInTheDocument();
  });
});

describe('GST slabs (Super Admin)', () => {
  it('lists India’s slabs: in force, and retired by GST 2.0', async () => {
    renderApp('/platform/gst-slabs');
    const standard = (await screen.findByText('Standard rate')).closest('li')!;
    expect(within(standard).getByText('In force')).toBeInTheDocument();
    expect(within(standard).getByText(/Used by groups: 2/)).toBeInTheDocument();
    const old28 = screen.getByText('Former 28% rate').closest('li')!;
    expect(within(old28).getByText('Retired')).toBeInTheDocument();
    expect(screen.getByText('Demerit rate')).toBeInTheDocument();
  });

  it('adds a slab, and refuses a second one of the same rate in force at the same time', async () => {
    renderApp('/platform/gst-slabs');
    await userEvent.click(await screen.findByRole('button', { name: 'Add slab' }));
    let dialog = await screen.findByRole('dialog', { name: 'New GST slab' });
    await userEvent.type(within(dialog).getByLabelText('Rate (%)'), '18');
    await userEvent.type(within(dialog).getByLabelText('Label'), 'Standard again');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add slab' }));
    expect(await within(dialog).findByText('A slab of this rate already applies on some of these dates. Give that one an end date first.')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await userEvent.click(screen.getByRole('button', { name: 'Add slab' }));
    dialog = await screen.findByRole('dialog', { name: 'New GST slab' });
    await userEvent.type(within(dialog).getByLabelText('Rate (%)'), '7.5');
    await userEvent.type(within(dialog).getByLabelText('Label'), 'Test rate');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add slab' }));
    expect(await screen.findByText('7.5% slab added')).toBeInTheDocument();

    // Unused, so it can be deleted
    await userEvent.click(await screen.findByRole('button', { name: 'Actions for the 7.5% slab' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Delete the 7.5% slab?' })).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('7.5% slab deleted')).toBeInTheDocument();
  });

  it('a slab organisations use can only be retired', async () => {
    renderApp('/platform/gst-slabs');
    await userEvent.click(await screen.findByRole('button', { name: 'Actions for the 18% slab' }));
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeDisabled();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Retire today' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit the 18% slab' });
    expect(within(dialog).getByLabelText('Rate (%)')).toBeDisabled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('18% slab saved')).toBeInTheDocument();
  });

  it('is only for the Super Admin', async () => {
    renderApp('/');
    await previewAs('owner');
    expect(screen.queryByRole('link', { name: 'GST slabs' })).not.toBeInTheDocument();
  });
});

describe('compensation cess', () => {
  it('adds cess on top of a GST rate as a group within the state and one between states', async () => {
    renderApp();
    const heading = await screen.findByRole('heading', { name: 'Compensation cess' }, { timeout: 10_000 });
    const card = heading.closest('div')!.parentElement as HTMLElement;
    await userEvent.type(within(card).getByLabelText('Cess, %'), '12');
    await userEvent.click(within(card).getByRole('button', { name: 'Add cess' }));
    expect(await screen.findByText(/Added: GST \d+% \+ Cess 12%, IGST \d+% \+ Cess 12%/, {}, { timeout: 10_000 })).toBeInTheDocument();
  }, 30_000);
});

