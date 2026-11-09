import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import AppProviders from '../AppProviders';
import { routes } from '../routes';
import { resetDemoAccounts } from './demoAccountsApi';

function renderApp(path = '/accounts') {
  sessionStorage.setItem('ledgernest.demo', 'admin@ledgernest.demo');
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <AppProviders client={null}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return router;
}
// The first match is the account's name (a sub-type label can repeat it, e.g. Retained earnings)
const row = async (name: string) => (await screen.findAllByText(name))[0]!.closest('li')! as HTMLElement;
const menu = async (name: string) => userEvent.click(within(await row(name)).getByRole('button', { name: `Actions for ${name}` }));
const previewAs = (role: string) => userEvent.selectOptions(screen.getByLabelText('Preview the app as a role'), role);

beforeEach(() => {
  resetDemoAccounts();
  sessionStorage.clear();
});

describe('chart of accounts', () => {
  it('shows accounts as a tree grouped by type, with system accounts marked and archived ones hidden', async () => {
    renderApp();
    expect(await screen.findByRole('heading', { name: 'Chart of accounts' })).toBeInTheDocument();
    await row('Bank accounts');
    for (const group of ['Assets', 'Liabilities', 'Equity', 'Income', 'Expenses']) expect(screen.getByRole('heading', { name: new RegExp(`^${group}`) })).toBeInTheDocument();
    const bank = await row('Bank accounts');
    const hdfc = await row('HDFC Bank current account');
    // Sub-accounts are indented under their parent
    expect(parseInt(hdfc.style.paddingInlineStart)).toBeGreaterThan(parseInt(bank.style.paddingInlineStart));
    expect(within(await row('Retained earnings')).getByText('System')).toBeInTheDocument();
    expect(screen.queryByText('Conference travel')).not.toBeInTheDocument();

    await userEvent.click(screen.getByLabelText('Show archived'));
    expect(within(await row('Conference travel')).getByText('Archived')).toBeInTheDocument();
  });

  it('collapses and expands sub-accounts', async () => {
    renderApp();
    await row('HDFC Bank current account');
    await userEvent.click(screen.getByRole('button', { name: 'Collapse Bank accounts' }));
    expect(screen.queryByText('HDFC Bank current account')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Expand Bank accounts' })).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(screen.getByRole('button', { name: 'Expand all' }));
    expect(await screen.findByText('HDFC Bank current account')).toBeInTheDocument();
  });

  it('searches by name or code and keeps matches in their place in the tree', async () => {
    renderApp();
    await row('Bank accounts');
    await userEvent.type(screen.getByLabelText('Search by code or name'), 'igst');
    await waitFor(() => expect(screen.queryByText('Bank accounts')).not.toBeInTheDocument());
    // Each match comes with its parent
    expect(screen.getByText('IGST input')).toBeInTheDocument();
    expect(screen.getByText('GST input credit')).toBeInTheDocument();
    expect(screen.getByText('IGST output')).toBeInTheDocument();
    expect(screen.queryByText('CGST input')).not.toBeInTheDocument();
  });

  it('filters by type', async () => {
    const router = renderApp();
    await row('Bank accounts');
    await userEvent.click(screen.getByRole('radio', { name: 'Income' }));
    await waitFor(() => expect(screen.queryByText('Bank accounts')).not.toBeInTheDocument());
    expect(screen.getByText('Export clients')).toBeInTheDocument();
    expect(router.state.location.search).toBe('?type=income');
  });

  it('adds a sub-account with a suggested code, under its parent', async () => {
    renderApp();
    await menu('Bank accounts');
    await userEvent.click(screen.getByRole('menuitem', { name: 'Add sub-account' }));
    const dialog = await screen.findByRole('dialog', { name: 'New sub-account of Bank accounts' });
    await waitFor(() => expect(within(dialog).getByLabelText('Name')).toHaveFocus());
    expect(within(dialog).getByLabelText('Code')).toHaveValue('1100.03');
    expect(within(dialog).getByLabelText('Type')).toHaveValue('asset');
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Axis Bank current account');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('Axis Bank current account created')).toBeInTheDocument();
    const axis = await row('Axis Bank current account');
    expect(within(axis).getByText('1100.03')).toBeInTheDocument();
  });

  it('explains a taken code next to the field', async () => {
    renderApp();
    await userEvent.click(await screen.findByRole('button', { name: 'New account' }));
    const dialog = await screen.findByRole('dialog', { name: 'New account' });
    // Like a person, wait until the dialog has opened and put the cursor in Name before typing
    await waitFor(() => expect(within(dialog).getByLabelText('Name')).toHaveFocus());
    const code = within(dialog).getByLabelText('Code');
    await userEvent.clear(code);
    await userEvent.type(code, '1100');
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Duplicate');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create account' }));
    expect(await within(dialog).findByText('Another account already uses this code.')).toBeInTheDocument();
  });

  it('archives bottom-up, and explains why a parent with active sub-accounts cannot be archived', async () => {
    renderApp();
    await menu('Bank accounts');
    await userEvent.click(screen.getByRole('menuitem', { name: 'Archive' }));
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Archive Bank accounts?' })).getByRole('button', { name: 'Archive' }));
    expect(await screen.findByText('Archive its sub-accounts first.')).toBeInTheDocument();

    await menu('ICICI Bank savings account');
    await userEvent.click(screen.getByRole('menuitem', { name: 'Archive' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Archive' }));
    expect(await screen.findByText('ICICI Bank savings account archived')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Actions for ICICI Bank savings account' })).not.toBeInTheDocument());
  });

  it('offers system accounts only renaming, and deletes unused accounts', async () => {
    renderApp();
    await menu('Retained earnings');
    expect(screen.getByRole('menuitem', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Archive' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Delete' })).not.toBeInTheDocument();
    await userEvent.keyboard('{Escape}');

    await menu('Bank charges');
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Delete Bank charges?' })).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('Bank charges deleted')).toBeInTheDocument();
  });

  it('is read-only for people who can only view accounts', async () => {
    renderApp();
    await row('Bank accounts');
    await previewAs('auditor');
    await row('Bank accounts');
    expect(screen.queryByRole('button', { name: 'New account' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Actions for/ })).not.toBeInTheDocument();
  });
});

describe('demo data', () => {
  it('uses account ids that pass the same validation as real ones', async () => {
    const { createDemoAccountsApi } = await import('./demoAccountsApi');
    const { z } = await import('zod');
    const accounts = await createDemoAccountsApi(() => true).list(true);
    expect(accounts.every((a) => z.uuid().safeParse(a.id).success)).toBe(true);
    expect(new Set(accounts.map((a) => a.id)).size).toBe(accounts.length);
  });
});

describe('industry templates', () => {
  const systemOnly = [
    { id: 'c0000000-0000-4000-8000-000000000001', code: '3900', name: 'Retained earnings', type: 'equity', subtype: 'retained_earnings', description: null, parentId: null, systemKey: 'retained_earnings', archivedAt: null },
    { id: 'c0000000-0000-4000-8000-000000000002', code: '3990', name: 'Opening balance equity', type: 'equity', subtype: 'other_equity', description: null, parentId: null, systemKey: 'opening_balance_equity', archivedAt: null },
  ];

  it('offers a template to a new organisation, previews it, and creates it', async () => {
    localStorage.setItem('ledgernest.demo.accounts', JSON.stringify(systemOnly));
    renderApp();
    expect(await screen.findByText('Start with a ready chart of accounts')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Use a template' }));
    const dialog = await screen.findByRole('dialog', { name: 'Start from a template' });
    await userEvent.click(within(dialog).getByRole('button', { name: /Retail and shops/ }));

    const preview = await screen.findByRole('dialog', { name: 'Retail and shops template' });
    await waitFor(() => expect(within(preview).getByText(/accounts will be created/)).not.toHaveTextContent(/^0 /));
    const count = Number(within(preview).getByText(/accounts will be created/).textContent!.match(/\d+/)![0]);
    expect(count).toBeGreaterThanOrEqual(25);
    await userEvent.click(within(preview).getByRole('button', { name: 'Apply template' }));
    expect(await screen.findByText(`${count} accounts created`)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Start with a ready chart of accounts')).not.toBeInTheDocument());
  });

  it("doesn't offer a template once the chart has accounts", async () => {
    renderApp();
    await row('Bank accounts');
    expect(screen.queryByRole('button', { name: 'Use a template' })).not.toBeInTheDocument();
  });
});
