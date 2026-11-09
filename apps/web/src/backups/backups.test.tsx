import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import AppProviders from '../AppProviders';
import { routes } from '../routes';

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

beforeEach(() => {
  for (const k of Object.keys(localStorage).filter((x) => x.startsWith('ledgernest.demo.'))) localStorage.removeItem(k);
  sessionStorage.clear();
});

describe('backups', () => {
  it('describes a backup file before restoring it, and refuses one that isn’t', async () => {
    renderApp();
    expect(await screen.findByRole('heading', { name: 'Backups' }, { timeout: 6000 })).toBeInTheDocument();
    localStorage.setItem('ledgernest.demo.example', JSON.stringify([1, 2, 3]));
    const file = new File([JSON.stringify({ format: 'ledgernest-demo-backup', exportedAt: '2026-11-10T04:00:00Z', source: { name: 'Nest Demo Pvt. Ltd.' }, data: { 'ledgernest.demo.example': JSON.stringify([1, 2]) } })], 'backup.json', { type: 'application/json' });
    await userEvent.upload(screen.getByTestId('backup-file'), new File(['{"hello": true}'], 'other.json', { type: 'application/json' }));
    expect(await screen.findByText('That isn’t a LedgerNest backup.')).toBeInTheDocument();
    await userEvent.upload(screen.getByTestId('backup-file'), file);
    const dialog = (await screen.findByText('The demo company’s data in this browser is replaced by the file’s.')).closest('[role="dialog"]') as HTMLElement;
    expect(dialog).toHaveTextContent('2 rows in 1 tables');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Replace the demo’s data' }));
    expect(await screen.findByText('The demo company now holds the file’s data', {}, { timeout: 4000 })).toBeInTheDocument();
    await waitFor(() => expect(localStorage.getItem('ledgernest.demo.example')).toBe('[1,2]'));
  }, 30_000);

  it('is for Owners only', async () => {
    renderApp();
    await screen.findByRole('heading', { name: 'Backups' }, { timeout: 6000 });
    await userEvent.selectOptions(screen.getByLabelText('Preview the app as a role'), 'admin');
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Backups' })).not.toBeInTheDocument());
  }, 30_000);
});
