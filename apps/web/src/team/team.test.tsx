import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import AppProviders from '../AppProviders';
import { routes } from '../routes';
import { resetDemoTeam } from './demoTeamApi';

function renderTeam(path = '/users') {
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
const row = async (name: string) => (await screen.findByText(name)).closest('tr, li')! as HTMLElement;

beforeEach(() => {
  resetDemoTeam();
  sessionStorage.clear();
});

describe('members', () => {
  it('lists the team with roles, marks you, and gives you no actions on yourself', async () => {
    renderTeam();
    const me = await row('Shivanjali Desai');
    expect(within(me).getByText('You')).toBeInTheDocument();
    expect(within(me).queryByRole('button')).not.toBeInTheDocument();
    expect(within(await row('Neha Gupta')).getByText('Branch cashier')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Members/ })).toHaveTextContent('7');
  });

  it('an Owner changes a role', async () => {
    renderTeam();
    await userEvent.click(within(await row('Arjun Kulkarni')).getByRole('button', { name: 'Change role for Arjun Kulkarni' }));
    const dialog = await screen.findByRole('dialog', { name: "Change Arjun Kulkarni's role" });
    await userEvent.selectOptions(within(dialog).getByLabelText('Role'), 'b:accountant');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText("Arjun Kulkarni's role was changed")).toBeInTheDocument();
    await waitFor(async () => expect(within(await row('Arjun Kulkarni')).getByText('Accountant')).toBeInTheDocument());
  });

  it('an Admin sees Owner and Admin locked, because nobody grants more than they have', async () => {
    renderTeam();
    await previewAs('admin');
    await userEvent.click(within(await row('Priya Nair')).getByRole('button', { name: 'Change role for Priya Nair' }));
    const select = within(await screen.findByRole('dialog')).getByLabelText('Role');
    expect(within(select).getByRole('option', { name: 'Owner (not in your role)' })).toBeDisabled();
    expect(within(select).getByRole('option', { name: 'Admin (not in your role)' })).toBeDisabled();
    expect(within(select).getByRole('option', { name: 'Bookkeeper' })).toBeEnabled();
  });

  it('removes someone after confirming', async () => {
    renderTeam();
    await userEvent.click(within(await row('Vikram Singh')).getByRole('button', { name: 'Remove Vikram Singh' }));
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Remove Vikram Singh?' })).getByRole('button', { name: 'Remove' }));
    expect(await screen.findByText('Vikram Singh was removed')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('vikram@nestdemo.in')).not.toBeInTheDocument());
  });

  it('roles without access to people do not see the page in the menu', async () => {
    renderTeam('/');
    await previewAs('viewer');
    expect(screen.queryByRole('link', { name: 'Users & roles' })).not.toBeInTheDocument();
  });
});

describe('invitations', () => {
  it('invites someone and shows the one-time link; refuses existing members', async () => {
    renderTeam('/users?tab=invitations');
    expect(await screen.findByText('kabir@nestdemo.in')).toBeInTheDocument();
    expect(within(await row('temp.staff@agency.in')).getByText('Expired')).toBeInTheDocument();

    await userEvent.click(screen.getAllByRole('button', { name: 'Invite people' })[0]!);
    const dialog = await screen.findByRole('dialog', { name: 'Invite someone' });
    await userEvent.type(within(dialog).getByLabelText('Email'), 'meera@nestdemo.in');
    await userEvent.selectOptions(within(dialog).getByLabelText('Role'), 'b:accountant');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create invitation' }));
    const done = await screen.findByRole('dialog', { name: 'Invitation ready' });
    expect((within(done).getByLabelText('Invitation link') as HTMLInputElement).value).toMatch(/accept-invite\?token=demo-/);
    await userEvent.click(within(done).getByRole('button', { name: 'Done' }));
    expect(await screen.findByText('meera@nestdemo.in')).toBeInTheDocument();

    await userEvent.click(screen.getAllByRole('button', { name: 'Invite people' })[0]!);
    const again = await screen.findByRole('dialog', { name: 'Invite someone' });
    await userEvent.type(within(again).getByLabelText('Email'), 'priya@nestdemo.in');
    await userEvent.click(within(again).getByRole('button', { name: 'Create invitation' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This person is already a member.');
  });

  it('resends an expired invitation with a fresh link, and revokes another', async () => {
    renderTeam('/users?tab=invitations');
    await userEvent.click(within(await row('temp.staff@agency.in')).getByRole('button', { name: 'Resend' }));
    expect(await screen.findByRole('dialog', { name: 'Invitation ready' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));

    await userEvent.click(within(await row('kabir@nestdemo.in')).getByRole('button', { name: 'Revoke invitation for kabir@nestdemo.in' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Revoke' }));
    expect(await screen.findByText('Invitation for kabir@nestdemo.in revoked')).toBeInTheDocument();
  });
});

describe('roles', () => {
  it('shows built-in roles read-only and creates a custom role', async () => {
    renderTeam('/users?tab=roles');
    expect(await screen.findByText('Full control, including billing and deleting the organisation.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'New role' }));
    const dialog = await screen.findByRole('dialog', { name: 'New role' });
    await userEvent.type(within(dialog).getByLabelText('Role name'), 'Payroll clerk');
    await userEvent.click(within(dialog).getByLabelText('Record payments'));
    await userEvent.click(within(dialog).getByLabelText('See bank accounts'));
    expect(within(dialog).getByText('2 of 35 selected')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create role' }));
    expect(await screen.findByText('Role Payroll clerk created')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Payroll clerk' })).toBeInTheDocument();
  });

  it('an Admin cannot put access they lack into a role', async () => {
    renderTeam('/users?tab=roles');
    await previewAs('admin');
    await userEvent.click(await screen.findByRole('button', { name: 'New role' }));
    const dialog = await screen.findByRole('dialog', { name: 'New role' });
    expect(within(dialog).getByLabelText(/Manage billing/)).toBeDisabled();
    expect(within(dialog).getByLabelText(/Delete the organisation/)).toBeDisabled();
    expect(within(dialog).getByLabelText('Invite people')).toBeEnabled();
  });

  it("won't delete a role people still have", async () => {
    renderTeam('/users?tab=roles');
    await userEvent.click(await screen.findByRole('button', { name: 'Delete Branch cashier' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete role' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('People still have this role.');

    await userEvent.click(screen.getByRole('button', { name: 'Delete Tax consultant' }));
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Delete Tax consultant?' })).getByRole('button', { name: 'Delete role' }));
    expect(await screen.findByText('Role Tax consultant deleted')).toBeInTheDocument();
  });
});

describe('demo data', () => {
  it('uses ids that pass the same validation as real ones, so custom roles can be invited', async () => {
    const { createDemoTeamApi } = await import('./demoTeamApi');
    const api = createDemoTeamApi(() => 'owner');
    const roles = await api.listRoles();
    const cashier = roles.custom.find((r) => r.name === 'Branch cashier')!;
    await expect(api.invite('new.cashier@nestdemo.in', { customRoleId: cashier.id })).resolves.toMatchObject({ email: 'new.cashier@nestdemo.in' });
  });
});
