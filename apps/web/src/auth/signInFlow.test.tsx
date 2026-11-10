import { act, render, screen, waitFor } from '@testing-library/react';
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
