import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import i18n from '../i18n';
import { routes } from '../routes';
import { BASE, ME, fakeApi } from '../test/fakeApi';
import AppProviders from '../AppProviders';
import { createAuthClient, type AuthClient } from './client';

function renderApp(path: string, client: AuthClient | null) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <AppProviders client={client}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return router;
}

const live = (opts?: Parameters<typeof fakeApi>[0]) => {
  const api = fakeApi(opts);
  return { api, client: createAuthClient(BASE, api.fetch) };
};

async function signIn(email: string, password: string) {
  const emailBox = await screen.findByLabelText('Email');
  await userEvent.clear(emailBox);
  if (email) await userEvent.type(emailBox, email);
  const pw = screen.getByLabelText('Password');
  await userEvent.clear(pw);
  if (password) await userEvent.type(pw, password);
  await userEvent.click(screen.getByRole('button', { name: /sign in|explore the demo/i }));
}

afterEach(() => sessionStorage.clear());

describe('signing in (live API)', () => {
  it('sends a signed-out visitor to sign in, then back to the page they wanted', async () => {
    const { client } = live();
    const router = renderApp('/reports', client);

    expect(await screen.findByRole('heading', { name: 'Sign in to LedgerNest' })).toBeInTheDocument();
    expect(router.state.location.search).toBe('?next=%2Freports');

    await signIn(ME.user.email, 'Right-Password-1');
    await waitFor(() => expect(router.state.location.pathname).toBe('/reports'));
    expect(await screen.findByText('Acme Traders')).toBeInTheDocument();
    expect(screen.getAllByText('Accountant').length).toBeGreaterThan(0);
  });

  it('shows a translated error for a wrong password and clears the field', async () => {
    const { client } = live();
    renderApp('/', client);
    await signIn(ME.user.email, 'Wrong-Password-1');

    expect(await screen.findByRole('alert')).toHaveTextContent('Email or password is incorrect.');
    expect(screen.getByLabelText('Password')).toHaveValue('');
  });

  it('checks the fields before calling the API', async () => {
    const { api, client } = live();
    renderApp('/', client);
    await signIn('not-an-email', '');

    expect(await screen.findByText('Enter a valid email address.')).toBeInTheDocument();
    expect(screen.getByText('Enter your password.')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
    expect(api.calls('/auth/login')).toBe(0);
  });

  it('asks for the authenticator code after the password when two-factor is on', async () => {
    const { api, client } = live();
    api.state.twoFactorCode = '492039';
    const router = renderApp('/reports', client);
    await signIn(ME.user.email, 'Right-Password-1');
    const code = await screen.findByLabelText('Authentication code');
    await userEvent.type(code, '111111');
    await userEvent.click(screen.getByRole('button', { name: 'Verify and sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That code isn’t right.');
    await userEvent.type(screen.getByLabelText('Authentication code'), '492039');
    await userEvent.click(screen.getByRole('button', { name: 'Verify and sign in' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/reports'));
    expect(api.calls('/auth/login/2fa')).toBe(2);
  });

  it('says how long a locked account must wait', async () => {
    const { api, client } = live();
    api.state.loginStatus = { status: 423, body: { message: 'locked', details: { retryAfterMinutes: 9 } } };
    renderApp('/', client);
    await signIn(ME.user.email, 'Right-Password-1');
    expect(await screen.findByRole('alert')).toHaveTextContent('Try again in 9 min.');
  });

  it('restores the session after a page reload using the refresh cookie', async () => {
    const { client } = live({ signedIn: true });
    renderApp('/', client);
    expect(await screen.findByText('Acme Traders')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Sign in to LedgerNest' })).not.toBeInTheDocument();
  });

  it('has no role preview with real data', async () => {
    const { client } = live({ signedIn: true });
    renderApp('/', client);
    await screen.findByText('Acme Traders');
    expect(screen.queryByLabelText('Preview the app as a role')).not.toBeInTheDocument();
  });

  it('signs out from the account menu', async () => {
    const { api, client } = live({ signedIn: true });
    renderApp('/', client);
    await userEvent.click(await screen.findByRole('button', { name: 'Account' }));
    expect(screen.getByText(ME.user.email)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(await screen.findByRole('status')).toHaveTextContent("You've been signed out.");
    expect(api.calls('/auth/logout')).toBe(1);
  });

  it('returns to sign in with a clear message when the session ends', async () => {
    const { api, client } = live({ signedIn: true });
    renderApp('/', client);
    await screen.findByText('Acme Traders');

    api.revokeSession();
    await act(() => client.me().catch(() => {}));

    expect(await screen.findByRole('status')).toHaveTextContent('Your session has ended. Please sign in again.');
  });
});

describe('demo mode (no API configured)', () => {
  it('explains the demo, prefills the form and opens the sample company', async () => {
    renderApp('/', null);
    expect(await screen.findByText(/No server is connected/)).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveValue('admin@ledgernest.demo');

    await userEvent.click(screen.getByRole('button', { name: 'Explore the demo' }));
    expect(await screen.findByText('Nest Demo Pvt. Ltd.')).toBeInTheDocument();
    expect(screen.getByLabelText('Preview the app as a role')).toBeInTheDocument();
  });

  it('uses the name from the email you typed', async () => {
    renderApp('/', null);
    await signIn('meera.iyer@shop.in', 'anything');
    await userEvent.click(await screen.findByRole('button', { name: 'Account' }));
    expect(screen.getByText('Meera Iyer')).toBeInTheDocument();
  });
});

describe('sign-in page languages', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('is fully translated, in Marathi', async () => {
    await i18n.changeLanguage('mr');
    renderApp('/', null);
    expect(await screen.findByRole('heading', { name: 'LedgerNest मध्ये साइन इन करा' })).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('mr');
    // Email and password stay left-to-right, so they read correctly whatever the page direction
    expect(screen.getByLabelText('ईमेल')).toHaveAttribute('dir', 'ltr');
    expect(screen.getByRole('button', { name: 'पासवर्ड दाखवा' }).parentElement).toHaveAttribute('dir', 'ltr');
  });
});

describe('passwords', () => {
  it('asks for a reset link from sign in, saying the same whatever the address', async () => {
    const { api, client } = live();
    renderApp('/sign-in', client);
    await userEvent.click(await screen.findByRole('link', { name: 'Forgot your password?' }));
    await screen.findByRole('heading', { name: 'Reset your password' });
    const email = screen.getByLabelText('Email');
    await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByText('Enter a valid email address.')).toBeInTheDocument();
    await userEvent.type(email, 'Asha@Acme.in');
    await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeInTheDocument();
    expect(api.state.resetRequests).toEqual(['asha@acme.in']);
  });

  it('sets a new password from the link, checking the rules, then signs in with it', async () => {
    const { api, client } = live();
    const router = renderApp(`/reset-password?token=${api.RESET_TOKEN}`, client);
    const next = await screen.findByLabelText('New password');
    await userEvent.type(next, 'weak');
    await userEvent.click(screen.getByRole('button', { name: 'Set new password' }));
    expect(await screen.findByText('Meet every rule below.')).toBeInTheDocument();
    await userEvent.clear(next);
    await userEvent.type(next, 'Brand-New-Pass-9');
    await userEvent.type(screen.getByLabelText('Type it again'), 'Brand-New-Pass-8');
    await userEvent.click(screen.getByRole('button', { name: 'Set new password' }));
    expect(await screen.findByText('The two passwords don’t match.')).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText('Type it again'));
    await userEvent.type(screen.getByLabelText('Type it again'), 'Brand-New-Pass-9');
    await userEvent.click(screen.getByRole('button', { name: 'Set new password' }));
    expect(await screen.findByRole('heading', { name: 'Password changed' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('link', { name: 'Sign in' }));
    await signIn(ME.user.email, 'Brand-New-Pass-9');
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
  });

  it('says when a reset link has expired or was used', async () => {
    const { client } = live();
    renderApp('/reset-password?token=used-token-0123456789abcdefghijklmn', client);
    await userEvent.type(await screen.findByLabelText('New password'), 'Brand-New-Pass-9');
    await userEvent.type(screen.getByLabelText('Type it again'), 'Brand-New-Pass-9');
    await userEvent.click(screen.getByRole('button', { name: 'Set new password' }));
    expect(await screen.findByRole('heading', { name: 'This link doesn’t work' })).toBeInTheDocument();
    renderApp('/reset-password', client);
    expect(await screen.findAllByRole('heading', { name: 'This link doesn’t work' })).toHaveLength(2);
  });

  it('changes the password from the account menu without signing out, and signs out everywhere', async () => {
    const { api, client } = live({ signedIn: true });
    const router = renderApp('/', client);
    await userEvent.click(await screen.findByRole('button', { name: 'Account' }));
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }));
    const dialog = await screen.findByRole('dialog', { name: 'Change your password' });
    await userEvent.type(screen.getByLabelText('Current password'), 'Wrong-Password-1');
    await userEvent.type(screen.getByLabelText('New password'), 'Brand-New-Pass-9');
    await userEvent.type(screen.getByLabelText('Type it again'), 'Brand-New-Pass-9');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Change password' }));
    expect(await screen.findByText('Your current password isn’t right.')).toBeInTheDocument();
    // Still signed in after the wrong password
    expect(router.state.location.pathname).toBe('/');
    await userEvent.clear(screen.getByLabelText('Current password'));
    await userEvent.type(screen.getByLabelText('Current password'), 'Right-Password-1');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Change password' }));
    expect(await screen.findByText('Password changed. Other devices have been signed out.')).toBeInTheDocument();
    expect(api.state.password).toBe('Brand-New-Pass-9');

    await userEvent.click(screen.getByRole('button', { name: 'Account' }));
    await userEvent.click(screen.getByRole('button', { name: 'Sign out everywhere' }));
    const confirm = await screen.findByRole('dialog', { name: 'Sign out of every device?' });
    await userEvent.click(within(confirm).getByRole('button', { name: 'Sign out everywhere' }));
    expect(await screen.findByRole('heading', { name: 'Sign in to LedgerNest' })).toBeInTheDocument();
    expect(api.state.cookie).toBeNull();
  });

  it('deletes your own account after checking the password, then signs out', async () => {
    const { api, client } = live({ signedIn: true });
    renderApp('/', client);
    await userEvent.click(await screen.findByRole('button', { name: 'Account' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete my account' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete your account?' });
    await userEvent.type(within(dialog).getByLabelText('Current password'), 'Wrong-Password-1');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete my account' }));
    expect(await within(dialog).findByText('Your current password isn’t right.')).toBeInTheDocument();
    expect(api.state.deleted).toBe(false);
    await userEvent.clear(within(dialog).getByLabelText('Current password'));
    await userEvent.type(within(dialog).getByLabelText('Current password'), 'Right-Password-1');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete my account' }));
    expect(await screen.findByRole('heading', { name: 'Sign in to LedgerNest' })).toBeInTheDocument();
    expect(api.state.deleted).toBe(true);
  });
});
