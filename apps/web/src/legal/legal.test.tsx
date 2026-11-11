import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import AppProviders from '../AppProviders';
import i18n from '../i18n';
import { routes } from '../routes';

const renderAt = (path: string) => {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <AppProviders client={null}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return router;
};

afterEach(() => void i18n.changeLanguage('en'));

describe('privacy notice and terms', () => {
  it('opens from the sign-in page without signing in, and says what is collected and why', { timeout: 20_000 }, async () => {
    const router = renderAt('/sign-in');
    await userEvent.click(await screen.findByRole('link', { name: 'Privacy notice' }, { timeout: 6000 }));
    expect(router.state.location.pathname).toBe('/privacy');
    expect(await screen.findByRole('heading', { name: 'Privacy notice', level: 1 }, { timeout: 6000 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'What is collected' })).toBeInTheDocument();
    expect(screen.getByText(/Digital Personal Data Protection Act, 2023/)).toBeInTheDocument();
    expect(screen.getByText(/no tracking or analytics cookies are set/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('link', { name: 'Terms of use' }));
    expect(await screen.findByRole('heading', { name: 'Terms of use', level: 1 }, { timeout: 6000 })).toBeInTheDocument();
    expect(screen.getByText(/It does not file anything with the government for you/)).toBeInTheDocument();
  });

  it('tells Hindi readers the text is in English', { timeout: 20_000 }, async () => {
    await i18n.changeLanguage('hi');
    renderAt('/terms');
    expect(await screen.findByRole('heading', { name: 'उपयोग की शर्तें', level: 1 }, { timeout: 6000 })).toBeInTheDocument();
    expect(screen.getByText('यह पृष्ठ अंग्रेज़ी में है, जो इसकी मान्य भाषा है।')).toBeInTheDocument();
  });
});
