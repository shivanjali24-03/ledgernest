import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import AppShell from './AppShell';
import SessionProvider from './SessionProvider';
import type { BuiltInRoleId } from '@ledgernest/shared';

function renderShell(role: BuiltInRoleId = 'super_admin') {
  const router = createMemoryRouter([{ path: '/', element: <AppShell />, children: [{ index: true, element: <p>Home page</p> }] }]);
  return render(
    <SessionProvider initialRole={role}>
      <RouterProvider router={router} />
    </SessionProvider>,
  );
}

const nav = () => within(screen.getByRole('navigation', { name: 'Main' }));

describe('AppShell', () => {
  it('shows the Platform section to the Super Admin', () => {
    renderShell('super_admin');
    expect(nav().getByText('Organisations')).toBeInTheDocument();
    expect(nav().getByText('Users & roles')).toBeInTheDocument();
  });

  it('hides what a Viewer may not use', () => {
    renderShell('viewer');
    expect(nav().queryByText('Organisations')).not.toBeInTheDocument();
    expect(nav().queryByText('Users & roles')).not.toBeInTheDocument();
    expect(nav().queryByText('Journal entries')).not.toBeInTheDocument();
    expect(nav().getByText('Reports')).toBeInTheDocument();
  });

  it('switching the preview role updates the menu', async () => {
    renderShell('super_admin');
    await userEvent.selectOptions(screen.getByLabelText('Preview the app as a role'), 'auditor');
    expect(nav().queryByText('Organisations')).not.toBeInTheDocument();
    expect(nav().getByText('Audit log')).toBeInTheDocument();
  });

  it('opens the command palette with Ctrl+K and filters results', async () => {
    renderShell('super_admin');
    await userEvent.keyboard('{Control>}k{/Control}');
    const dialog = await screen.findByRole('dialog', { name: 'Command palette' });
    await userEvent.type(within(dialog).getByLabelText('Search'), 'tenants');
    const options = within(dialog).getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent('Organisations');
  });

  it('toggles dark mode on <html>', async () => {
    renderShell();
    await userEvent.click(screen.getByLabelText(/switch to dark mode/i));
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});
