import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import AppProviders from '../AppProviders';
import { routes } from '../routes';
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
