import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import AppProviders from '../AppProviders';
import { createDemoPlatformApi, resetDemoPlatform } from '../platform/demoApi';
import { routes } from '../routes';
import { resetDemoAudit } from './demoAuditApi';

function renderApp(path: string) {
  sessionStorage.setItem('ledgernest.demo', 'admin@ledgernest.demo');
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <AppProviders client={null} platformApi={createDemoPlatformApi({ latencyMs: 0 })}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return router;
}
const previewAs = (role: string) => userEvent.selectOptions(screen.getByLabelText('Preview the app as a role'), role);
const entry = async (label: string) => (await screen.findByRole('button', { name: new RegExp(label) })).closest('li')! as HTMLElement;
/** The summary line of every entry currently listed */
const labels = () => [...document.querySelectorAll('li > button[aria-expanded]')].map((b) => b.textContent ?? '');

beforeEach(() => {
  resetDemoAudit();
  resetDemoPlatform();
  sessionStorage.clear();
});

describe('organisation audit log', () => {
  it("shows only this organisation's history, newest first, in pages", async () => {
    renderApp('/audit');
    expect(await screen.findByRole('heading', { name: 'Audit log' })).toBeInTheDocument();
    expect(screen.getByText('Append-only: entries can never be edited or deleted')).toBeInTheDocument();
    await entry('Role edited');
    expect(screen.getByRole('button', { name: /Support access by a Super Admin/ })).toBeInTheDocument();
    // Platform-wide entries and other organisations' history never appear
    expect(screen.queryByRole('button', { name: /^Signed in/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/GreenRoots/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('Showing all 10 entries')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Role deleted/ })).toBeInTheDocument();
  });

  it('expands an entry to show exactly what changed', async () => {
    renderApp('/audit');
    const row = await entry('Role edited');
    await userEvent.click(within(row).getByRole('button', { expanded: false }));
    expect(within(row).getByRole('button', { expanded: true })).toBeInTheDocument();
    expect(within(row).getByText('What changed')).toBeInTheDocument();
    // Phone and desktop layouts are both in the page; CSS shows one
    expect(within(row).getAllByText(/Added:/)[0]!.closest('li')).toHaveTextContent('See invoices');
    expect(within(row).getAllByText('4 unchanged')).toHaveLength(2);
    expect(within(row).getByText('49.36.112.8')).toBeInTheDocument();
    expect(within(row).getByText('Safari · macOS')).toBeInTheDocument();

    const change = await entry("Member's role changed");
    await userEvent.click(within(change).getByRole('button', { expanded: false }));
    const roleRow = within(change).getByRole('rowheader', { name: 'Role' }).closest('tr')!;
    expect(roleRow).toHaveTextContent('Bookkeeper');
    expect(roleRow).toHaveTextContent('Accountant');
  });

  it('keeps who did it even after their account was deleted', async () => {
    renderApp('/audit');
    await userEvent.click(await screen.findByRole('button', { name: 'Load more' }));
    const row = await entry('Role created');
    expect(within(row).getByText('arjun@nestdemo.in')).toBeInTheDocument();
    expect(within(row).getByText('Deleted account')).toBeInTheDocument();
  });

  it('filters by activity and person, and keeps filters in the address bar', async () => {
    const router = renderApp('/audit');
    await entry('Role edited');
    await userEvent.selectOptions(screen.getByLabelText('Activity'), 'invitations');
    await waitFor(() => expect(labels()).toHaveLength(3));
    expect(labels().every((l) => l.startsWith('Invitation'))).toBe(true);
    expect(router.state.location.search).toBe('?group=invitations');

    await userEvent.selectOptions(screen.getByLabelText('Person'), 'u-m-2');
    await waitFor(() => expect(labels()).toHaveLength(2));
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    await entry('Role edited');
    expect(router.state.location.search).toBe('');
  });

  it('says so when the date range is backwards, and when nothing matches', async () => {
    renderApp('/audit?from=2026-03-10&to=2026-03-01');
    expect(await screen.findAllByText('The start date is after the end date')).not.toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeDisabled();
  });

  it('exports CSV, and the export itself appears in the log', async () => {
    const createObjectURL = vi.fn(() => 'blob:audit');
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    renderApp('/audit');
    await entry('Role edited');
    await userEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    expect(await screen.findByText(/^Downloaded audit-log-\d{4}-\d{2}-\d{2}\.csv$/)).toBeInTheDocument();
    expect(click).toHaveBeenCalled();
    const blob = (createObjectURL.mock.calls[0] as unknown as [Blob])[0];
    // A byte-order mark first, so Excel reads Hindi and Arabic correctly (blob.text() hides it)
    expect([...new Uint8Array(await blob.arrayBuffer()).slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const csv = await blob.text();
    expect(csv.split('\r\n')[0]).toBe('"time","action","actor","entity_type","entity_id","ip","before","after"');
    expect(csv).toContain('"org.role.update"');
    expect(csv).not.toContain('platform.organization.create');
    expect(await screen.findByRole('button', { name: /Audit log exported/ })).toBeInTheDocument();
    click.mockRestore();
  });

  it('Auditors can read it; Viewers cannot', async () => {
    renderApp('/audit');
    await entry('Role edited');
    await previewAs('auditor');
    expect(await screen.findByRole('link', { name: 'Audit log' })).toBeInTheDocument();
    await entry('Role edited');
    await previewAs('viewer');
    expect(await screen.findByText("You don't have access to this page")).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Audit log' })).not.toBeInTheDocument();
  });
});

describe('platform audit log', () => {
  it('shows every organisation and platform-wide activity, and narrows to one organisation', async () => {
    renderApp('/platform/audit');
    expect(await screen.findByRole('heading', { name: 'Platform audit log' })).toBeInTheDocument();
    const signIn = await entry('Signed in');
    expect(within(signIn).getByText('Shivanjali Desai')).toBeInTheDocument();
    expect(within(await entry('Role edited')).getByText('Nest Demo Pvt. Ltd.')).toBeInTheDocument();

    const org = screen.getByLabelText('Organisation');
    await waitFor(() => expect(within(org).getByRole('option', { name: 'Café Lumière' })).toBeInTheDocument());
    await userEvent.selectOptions(org, 'o-5');
    await waitFor(() => expect(labels()).toEqual([expect.stringMatching(/^Organisation edited/)]));
  });

  it('offers platform-only activity groups', async () => {
    renderApp('/platform/audit');
    const group = await screen.findByLabelText('Activity');
    expect(within(group).getByRole('option', { name: 'Sign-ins' })).toBeInTheDocument();
    expect(within(group).getByRole('option', { name: 'Platform accounts' })).toBeInTheDocument();
  });

  it('is only for Super Admins', async () => {
    renderApp('/');
    await previewAs('owner');
    expect(screen.queryByRole('link', { name: 'Platform audit log' })).not.toBeInTheDocument();
  });
});
