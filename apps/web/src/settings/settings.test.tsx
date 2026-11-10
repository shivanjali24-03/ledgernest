import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import AppProviders from '../AppProviders';
import { routes } from '../routes';
import { resetDemoInvoices } from '../invoices/demoInvoicesApi';
import { resetDemoSettings } from './demoSettingsApi';

function renderApp(path = '/settings') {
  sessionStorage.setItem('ledgernest.demo', 'admin@ledgernest.demo');
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <AppProviders client={null}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return router;
}
const field = (label: string) => screen.findByLabelText(label);
const previewAs = (role: string) => userEvent.selectOptions(screen.getByLabelText('Preview the app as a role'), role);

beforeEach(() => {
  resetDemoSettings();
  resetDemoInvoices();
  sessionStorage.clear();
  Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:logo'), revokeObjectURL: vi.fn() });
});

describe('organisation settings', () => {
  it("shows the company's details, and explains what is locked", async () => {
    renderApp();
    expect(await screen.findByRole('heading', { name: 'Organisation settings' })).toBeInTheDocument();
    expect(await field('Legal name')).toHaveValue('Nest Demo Private Limited');
    expect(screen.getByLabelText('Tax ID')).toHaveValue('27AAPFN1234C1Z5');
    expect(screen.getByLabelText('Base currency')).toBeDisabled();
    expect(screen.getByText("Can't change once entries are posted")).toBeInTheDocument();
    expect(screen.getByText('Your financial year runs April – March.')).toBeInTheDocument();
    expect(screen.queryByText('You have unsaved changes')).not.toBeInTheDocument();
  });

  it('turns on automatic payment reminders, checking the numbers', async () => {
    renderApp();
    const on = await screen.findByRole('checkbox', { name: 'Send automatic reminders' }, { timeout: 4000 });
    expect(on).not.toBeChecked();
    expect(screen.getByLabelText('First, days after the due date')).toBeDisabled();
    await userEvent.click(on);
    const max = screen.getByLabelText('At most, per invoice');
    fireEvent.change(max, { target: { value: '0' } });
    expect(screen.getByText('1 to 10 reminders.')).toBeInTheDocument();
    const card = on.closest('form')!;
    expect(within(card).getByRole('button', { name: 'Save' })).toBeDisabled();
    fireEvent.change(max, { target: { value: '4' } });
    fireEvent.change(screen.getByLabelText('First, days after the due date'), { target: { value: '5' } });
    await userEvent.click(within(card).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Automatic reminders are on')).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('ledgernest.demo.reminderPolicy')!)).toEqual({ enabled: true, firstAfterDays: 5, repeatEveryDays: 7, maxReminders: 4 });
  });

  it('saves only after a change, and keeps it', async () => {
    renderApp();
    const legal = await field('Legal name');
    await userEvent.clear(legal);
    await userEvent.type(legal, 'Nest Demo Pvt Ltd');
    expect(screen.getByText('You have unsaved changes')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Financial year starts in'), '1');
    expect(screen.getByText('Your financial year runs January – December.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Settings saved')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('You have unsaved changes')).not.toBeInTheDocument());
    expect(JSON.parse(localStorage.getItem('ledgernest.demo.settings')!).settings).toMatchObject({ legalName: 'Nest Demo Pvt Ltd', fiscalYearStartMonth: 1 });
  });

  it('keeps the terms printed on invoices and quotes', async () => {
    renderApp();
    const terms = await field('Terms and bank details');
    fireEvent.change(terms, { target: { value: 'Payment within 15 days.\nHDFC Bank · IFSC HDFC0001234' } });
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Settings saved')).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('ledgernest.demo.settings')!).settings.invoiceTerms).toBe('Payment within 15 days.\nHDFC Bank · IFSC HDFC0001234');
  });

  it('gives the accountant the books for Tally: ledgers, then vouchers', async () => {
    const saved: Blob[] = [];
    Object.assign(URL, { createObjectURL: vi.fn((b: Blob) => (saved.push(b), 'blob:x')), revokeObjectURL: vi.fn() });
    renderApp();
    fireEvent.click(await screen.findByRole('button', { name: 'Download ledgers (XML)' }, { timeout: 4000 }));
    await waitFor(() => expect(saved).toHaveLength(1));
    const masters = await saved[0]!.text();
    expect(masters).toContain('<REPORTNAME>All Masters</REPORTNAME>');
    expect(masters).toContain('<NAME>Kumar Logistics</NAME></NAME.LIST><PARENT>Sundry Debtors</PARENT>');
    expect(masters).toContain('<PARENT>Bank Accounts</PARENT>');
    fireEvent.click(screen.getByRole('button', { name: 'Download vouchers (XML)' }));
    await waitFor(() => expect(saved).toHaveLength(2), { timeout: 4000 });
    const vouchers = await saved[1]!.text();
    expect(vouchers).toContain('<REPORTNAME>Vouchers</REPORTNAME>');
    expect(vouchers).toMatch(/<VOUCHER VCHTYPE="(Journal|Receipt|Payment|Contra)"/);
  });

  it('deletes the organisation only once its name is typed (the demo starts over)', async () => {
    renderApp();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete organisation…' }, { timeout: 4000 }));
    const dialog = await screen.findByRole('dialog', { name: /^Delete .+ for good\?$/ });
    const confirm = within(dialog).getByRole('button', { name: 'Delete it all' });
    expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText(/^Type “.+” to confirm$/), 'Nest');
    expect(confirm).toBeDisabled();
    await userEvent.clear(within(dialog).getByLabelText(/^Type “.+” to confirm$/));
    await userEvent.type(within(dialog).getByLabelText(/^Type “.+” to confirm$/), 'Nest Demo Pvt. Ltd.');
    localStorage.setItem('ledgernest.demo.marker', 'x');
    await waitFor(() => expect(confirm).toBeEnabled());
    fireEvent.click(confirm);
    expect(await screen.findByText('Nest Demo Pvt. Ltd. was deleted.', {}, { timeout: 4000 })).toBeInTheDocument();
    expect(localStorage.getItem('ledgernest.demo.marker')).toBeNull();
  });

  it('turns on the weekly summary email', async () => {
    renderApp();
    const box = await screen.findByRole('checkbox', { name: /^Weekly summary/ }, { timeout: 4000 });
    expect(box).not.toBeChecked();
    await userEvent.click(box);
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Settings saved')).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('ledgernest.demo.settings')!).settings.weeklySummary).toBe(true);
  });

  it('shows problems next to the field, with the same rules as the API, and discards changes', async () => {
    renderApp();
    const tax = await field('Tax ID');
    await userEvent.clear(tax);
    await userEvent.type(tax, '<script>');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Use letters, numbers, spaces, dots, dashes or slashes.')).toBeInTheDocument();
    expect(tax).toHaveAttribute('aria-invalid', 'true');

    await userEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(tax).toHaveValue('27AAPFN1234C1Z5');
    expect(screen.queryByText('Use letters, numbers, spaces, dots, dashes or slashes.')).not.toBeInTheDocument();
  });

  it('asks before leaving with unsaved changes', async () => {
    const router = renderApp();
    await userEvent.type(await field('City'), ' West');
    await userEvent.click(screen.getByRole('link', { name: 'Users & roles' }));
    const dialog = await screen.findByRole('dialog', { name: 'Leave without saving?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(router.state.location.pathname).toBe('/settings');

    await userEvent.click(screen.getByRole('link', { name: 'Users & roles' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Leave' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/users'));
  });

  it('is read-only for people who can only view settings', async () => {
    renderApp();
    await field('Legal name');
    await previewAs('auditor');
    expect(await screen.findByText('Only Owners and Admins can change these settings')).toBeInTheDocument();
    expect(await field('Legal name')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Upload logo' })).not.toBeInTheDocument();
  });
});

describe('logo', () => {
  const png = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])], 'logo.png', { type: 'image/png' });

  it('uploads a logo, shows it, and removes it', async () => {
    renderApp();
    await userEvent.click(await screen.findByRole('button', { name: 'Upload logo' }));
    fireEvent.change(document.querySelector('input[type=file]')!, { target: { files: [png] } });
    expect(await screen.findByText('Logo updated')).toBeInTheDocument();
    expect(await screen.findByRole('img', { name: 'Nest Demo Pvt. Ltd. logo' })).toHaveAttribute('src', 'blob:logo');

    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(await screen.findByText('Logo removed')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('img', { name: /logo/ })).not.toBeInTheDocument());
  });

  it('refuses an SVG or a renamed file before sending anything', async () => {
    renderApp();
    await screen.findByRole('button', { name: 'Upload logo' });
    const input = document.querySelector('input[type=file]')!;
    fireEvent.change(input, { target: { files: [new File(['<svg onload="alert(1)"/>'], 'logo.svg', { type: 'image/svg+xml' })] } });
    expect(await screen.findByRole('alert')).toHaveTextContent("Use a PNG, JPEG or WebP image. SVG isn't allowed.");
    fireEvent.change(input, { target: { files: [new File(['GIF89a'], 'logo.png', { type: 'image/png' })] } });
    expect(await screen.findByRole('alert')).toHaveTextContent("That file isn't the image type its name says.");
  });
});

describe('MSME settings', () => {
  it('saves the business’s MSME category and the bank rate as basis points', async () => {
    const { changes, toValues } = await import('./form');
    const before = toValues({ id: 'o', name: 'Nest', slug: 'nest', status: 'ACTIVE', baseCurrency: 'INR', locale: 'en-IN', timeZone: 'Asia/Kolkata', country: 'IN', fiscalYearStartMonth: 4, legalName: null, taxId: null, email: null, phone: null, address: { line1: null, line2: null, city: null, region: null, postalCode: null }, logo: null, locks: { baseCurrency: false, fiscalYearStartMonth: false } });
    expect(before).toMatchObject({ msmeCategory: '', udyamNumber: '', msmeBankRate: '' });
    expect(changes(before, { ...before, msmeCategory: 'micro', udyamNumber: 'udyam-mh-26-0012345', msmeBankRate: '5.5' })).toEqual({ msmeCategory: 'micro', udyamNumber: 'udyam-mh-26-0012345', msmeBankRateBp: 550 });
    const saved = toValues({ id: 'o', name: 'Nest', slug: 'nest', status: 'ACTIVE', baseCurrency: 'INR', locale: 'en-IN', timeZone: 'Asia/Kolkata', country: 'IN', fiscalYearStartMonth: 4, legalName: null, taxId: null, email: null, phone: null, address: { line1: null, line2: null, city: null, region: null, postalCode: null }, logo: null, locks: { baseCurrency: false, fiscalYearStartMonth: false }, msmeCategory: 'small', msmeBankRateBp: 625 });
    expect(saved).toMatchObject({ msmeCategory: 'small', msmeBankRate: '6.25' });
    expect(changes(saved, { ...saved, msmeCategory: '', msmeBankRate: '' })).toEqual({ msmeCategory: null, msmeBankRateBp: null });
  });
});
