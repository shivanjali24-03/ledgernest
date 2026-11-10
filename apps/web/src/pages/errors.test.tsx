import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import AppProviders from '../AppProviders';
import { routes } from '../routes';
import RouteError from './RouteError';

function Boom(): never {
  throw new Error('kaboom');
}

describe('when a page breaks or doesn’t exist', () => {
  beforeEach(() => sessionStorage.setItem('ledgernest.demo', 'admin@ledgernest.demo'));
  afterEach(() => sessionStorage.clear());

  it('shows a plain explanation and a way on, not a stack trace', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const router = createMemoryRouter([{ path: '/', element: <Boom />, errorElement: <RouteError /> }]);
    render(
      <AppProviders client={null}>
        <RouterProvider router={router} />
      </AppProviders>,
    );
    expect(await screen.findByRole('heading', { name: 'Something went wrong on this page' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to the dashboard' })).toHaveAttribute('href', '/');
    // Details only in development, folded away
    expect(screen.getByText('kaboom').closest('details')).not.toHaveAttribute('open');
  });

  it('says an unknown address doesn’t exist, inside the app', async () => {
    const router = createMemoryRouter(routes, { initialEntries: ['/no-such-page'] });
    render(
      <AppProviders client={null}>
        <RouterProvider router={router} />
      </AppProviders>,
    );
    expect(await screen.findByRole('heading', { name: 'This page doesn’t exist' }, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
  });

  it('gives every route an error page', () => {
    for (const r of routes) {
      expect(r.errorElement, r.path).toBeTruthy();
      for (const c of r.children ?? []) expect(c.errorElement, c.path).toBeTruthy();
    }
  });
});
