import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import AppProviders from '../AppProviders';
import { routes } from '../routes';
import { createDemoPlatformApi, resetDemoPlatform } from './demoApi';

/** Renders the real app in demo mode, signed in as the demo Super Admin unless told otherwise. */
function renderApp(path: string, { signedIn = true } = {}) {
  if (signedIn) sessionStorage.setItem('ledgernest.demo', 'admin@ledgernest.demo');
  const api = createDemoPlatformApi({ latencyMs: 0 });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <AppProviders client={null} platformApi={api}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return { router, api };
}

beforeEach(() => {
  resetDemoPlatform();
  sessionStorage.clear();
});

describe('platform overview', () => {
  it('shows platform figures and recent activity', async () => {
    renderApp('/platform');
    expect(await screen.findByRole('heading', { name: 'Platform overview' })).toBeInTheDocument();
    expect(await screen.findByText('6 active · 1 suspended')).toBeInTheDocument();
    expect(screen.getByText('Super Admins: 2')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'GreenRoots Foundation' })).toHaveAttribute('href', '/platform/organizations/o-7');
  });

  it('is hidden from roles without platform access', async () => {
    renderApp('/');
    await userEvent.selectOptions(await screen.findByLabelText('Preview the app as a role'), 'accountant');
    expect(screen.queryByRole('link', { name: 'Platform overview' })).not.toBeInTheDocument();
  });
});

describe('organisations', () => {
  it('lists, searches and filters', async () => {
    renderApp('/platform/organizations');
    expect(await screen.findByRole('link', { name: 'Bluewave Clinics' })).toBeInTheDocument();
    expect(screen.getByText('Total: 7')).toBeInTheDocument();

    await userEvent.type(screen.getByRole('searchbox', { name: 'Search organisations' }), 'café');
    await waitFor(() => expect(screen.getByText('Total: 1')).toBeInTheDocument());
    expect(screen.getByRole('link', { name: 'Café Lumière' })).toBeInTheDocument();

    await userEvent.clear(screen.getByRole('searchbox', { name: 'Search organisations' }));
    await userEvent.click(screen.getByRole('radio', { name: 'Suspended' }));
    await waitFor(() => expect(screen.getByText('Total: 1')).toBeInTheDocument());
    expect(screen.getByRole('link', { name: 'Al Noor Trading LLC' })).toBeInTheDocument();
  });

  it('creates an organisation and shows a one-time invitation link for a new Owner', async () => {
    renderApp('/platform/organizations');
    await userEvent.click(await screen.findByRole('button', { name: 'New organisation' }));
    const dialog = await screen.findByRole('dialog', { name: 'New organisation' });

    await userEvent.type(within(dialog).getByLabelText('Organisation name'), 'Sunrise Bakery');
    expect(within(dialog).getByText('Used in links: sunrise-bakery')).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText("Owner's email"), 'owner@sunrise.in');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create organisation' }));

    const done = await screen.findByRole('dialog', { name: 'Sunrise Bakery is ready' });
    expect(within(done).getByText(/owner@sunrise.in doesn't have an account yet/)).toBeInTheDocument();
    expect((within(done).getByLabelText('Invitation link') as HTMLInputElement).value).toMatch(/\/accept-invite\?token=demo-/);

    await userEvent.click(within(done).getByRole('button', { name: 'Done' }));
    expect(await screen.findByRole('link', { name: 'Sunrise Bakery' })).toBeInTheDocument();
  });

  it('adds an existing user as Owner straight away', async () => {
    renderApp('/platform/organizations?new=1');
    const dialog = await screen.findByRole('dialog', { name: 'New organisation' });
    await userEvent.type(within(dialog).getByLabelText('Organisation name'), 'Rao Exports');
    await userEvent.type(within(dialog).getByLabelText("Owner's email"), 'asha@shreeganesh.in');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create organisation' }));
    expect(await screen.findByText('The Owner already had an account and has been added.')).toBeInTheDocument();
  });

  it('explains invalid input and a taken web address in the user language', async () => {
    renderApp('/platform/organizations?new=1');
    const dialog = await screen.findByRole('dialog', { name: 'New organisation' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create organisation' }));
    expect(within(dialog).getByText('Enter a name of at least 2 characters.')).toBeInTheDocument();
    expect(within(dialog).getByText('Enter a valid email address.')).toBeInTheDocument();

    await userEvent.type(within(dialog).getByLabelText('Organisation name'), 'Copycat');
    await userEvent.type(within(dialog).getByLabelText('Web address'), 'bluewave-clinics');
    await userEvent.type(within(dialog).getByLabelText("Owner's email"), 'x@y.co');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create organisation' }));
    expect(await within(dialog).findByText('That web address is taken. Try another.')).toBeInTheDocument();
  });

  it('suspends an organisation with a reason, then reactivates it', async () => {
    renderApp('/platform/organizations/o-2');
    expect(await screen.findByRole('heading', { name: 'Shree Ganesh Traders' })).toBeInTheDocument();
    expect(screen.getByText('Asha Rao')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Suspend' }));
    const confirm = await screen.findByRole('dialog', { name: 'Suspend Shree Ganesh Traders?' });
    await userEvent.type(within(confirm).getByLabelText(/Reason/), 'Unpaid invoice');
    await userEvent.click(within(confirm).getByRole('button', { name: 'Suspend' }));

    expect(await screen.findByText('Shree Ganesh Traders is suspended')).toBeInTheDocument();
    expect(await screen.findByText("This organisation is suspended. Its members can't use it.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Reactivate' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Reactivate' }));
    await waitFor(() => expect(screen.queryByText(/This organisation is suspended/)).not.toBeInTheDocument());
  });

  it('shows a clear message for an organisation that does not exist', async () => {
    renderApp('/platform/organizations/nope');
    expect(await screen.findByText("We couldn't find that. It may have been removed.")).toBeInTheDocument();
  });
});

describe('platform users', () => {
  it('never lets the last Super Admin go, and explains why', async () => {
    renderApp('/platform/users');
    const rohan = (await screen.findByText('Rohan Mehta')).closest('tr')!;
    await userEvent.click(within(rohan).getByRole('button', { name: 'Actions for Rohan Mehta' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Remove Super Admin' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Remove Super Admin' }));
    expect(await screen.findByText('Rohan Mehta is no longer a Super Admin')).toBeInTheDocument();

    const me = screen.getByText('Shivanjali Desai').closest('tr')!;
    expect(within(me).getByText('You')).toBeInTheDocument();
    await userEvent.click(within(me).getByRole('button', { name: 'Actions for Shivanjali Desai' }));
    expect(within(me).getByRole('menuitem', { name: 'Suspend account' })).toBeDisabled();
    await userEvent.click(within(me).getByRole('menuitem', { name: 'Remove Super Admin' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Remove Super Admin' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('LedgerNest needs at least one active Super Admin');
  });

  it('filters to Super Admins', async () => {
    renderApp('/platform/users?show=superAdmins');
    await screen.findByText('Rohan Mehta');
    expect(screen.queryByText('Asha Rao')).not.toBeInTheDocument();
  });
});

describe('accepting an invitation', () => {
  it('a new person creates their account and lands in the app', async () => {
    const setup = createDemoPlatformApi({ latencyMs: 0 });
    const created = await setup.createOrganization({ name: 'Nova Studio', owner: { email: 'nina@nova.studio' } });
    const token = new URL((created.owner as { inviteUrl: string }).inviteUrl).searchParams.get('token')!;

    const { router } = renderApp(`/accept-invite?token=${token}`, { signedIn: false });
    expect(await screen.findByRole('heading', { name: 'Nova Studio' })).toBeInTheDocument();
    expect(screen.getByText(/You'll join as Owner with nina@nova.studio/)).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Your name'), 'Nina Shah');
    await userEvent.type(screen.getByLabelText('Choose a password'), 'weak');
    await userEvent.click(screen.getByRole('button', { name: 'Create account and join' }));
    expect(screen.getByText("Your password doesn't meet every rule yet.")).toBeInTheDocument();

    await userEvent.clear(screen.getByLabelText('Choose a password'));
    await userEvent.type(screen.getByLabelText('Choose a password'), 'Nova-Studio-2026');
    await userEvent.click(screen.getByRole('button', { name: 'Create account and join' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
  });

  it('people with an account are asked to sign in first', async () => {
    renderApp('/accept-invite?token=demo-greenroots-owner', { signedIn: false });
    expect(await screen.findByRole('heading', { name: 'GreenRoots Foundation' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in to accept' })).toBeInTheDocument();
  });

  it('explains a broken link', async () => {
    renderApp('/accept-invite?token=this-token-does-not-exist-at-all', { signedIn: false });
    expect(await screen.findByText(/The link isn't valid/)).toBeInTheDocument();
  });
});
