import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import AppProviders from '../AppProviders';
import { resetDemoAccounts } from '../accounts/demoAccountsApi';
import { resetDemoJournals } from '../journals/demoJournalsApi';
import { resetDemoPeriods } from '../periods/demoPeriodsApi';
import { routes } from '../routes';
import { resetDemoApprovals } from './demoApprovalsApi';

function renderApp(path: string) {
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
const pick = async (n: number, name: RegExp) => {
  const select = screen.getByLabelText(`Line ${n} account`) as HTMLSelectElement;
  await userEvent.selectOptions(select, [...select.options].find((o) => name.test(o.textContent ?? ''))!.value);
};

beforeEach(() => {
  for (const reset of [resetDemoApprovals, resetDemoJournals, resetDemoAccounts, resetDemoPeriods]) reset();
  sessionStorage.clear();
});

describe('approvals', () => {
  it('holds an Accountant’s large entry until the Admin approves it, which posts it', async () => {
    const router = renderApp('/approvals');
    const rule = await screen.findByLabelText('Journal entries need approval', {}, { timeout: 4000 });
    await userEvent.click(rule);
    await userEvent.type(screen.getByLabelText('At or above (INR)'), '1000');
    await userEvent.click(screen.getByRole('button', { name: 'Save the rule: Journal entries need approval' }));
    expect(await screen.findByText('Rule for Journal entry saved', {}, { timeout: 4000 })).toBeInTheDocument();

    await previewAs('accountant');
    await act(() => router.navigate('/journals/new'));
    await waitFor(() => expect((screen.getByLabelText('Line 1 account') as HTMLSelectElement).options.length).toBeGreaterThan(10), { timeout: 4000 });
    await userEvent.type(screen.getByLabelText('Memo'), 'Internet bill');
    await pick(1, /Internet and phone/);
    await userEvent.type(screen.getByLabelText('Line 1 debit'), '2360');
    await pick(2, /HDFC Bank current/);
    await userEvent.type(screen.getByLabelText('Line 2 credit'), '2360');
    await userEvent.click(screen.getByRole('button', { name: 'Post' }));
    expect(await screen.findByText('Sent for approval. It posts once someone approves it.', {}, { timeout: 4000 })).toBeInTheDocument();

    // Held, it stays a draft, and the editor moves to it
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/journals\/[0-9a-f-]{36}$/), { timeout: 4000 });
    await act(() => router.navigate('/approvals'));
    // The Accountant sees it as theirs: they can withdraw it but not approve it
    await waitFor(
      () => {
        const mine = screen.getByRole('link', { name: /^Journal entry/ }).closest('li')!;
        expect(within(mine).getByRole('button', { name: 'Withdraw' })).toBeInTheDocument();
        expect(within(mine).queryByRole('button', { name: /^Approve/ })).not.toBeInTheDocument();
      },
      { timeout: 6000 },
    );

    await previewAs('admin');
    await userEvent.click(await screen.findByRole('button', { name: /^Approve Journal entry/ }, { timeout: 6000 }));
    const dialog = (await screen.findByText('It posts now, under your name.')).closest('[role="dialog"]') as HTMLElement;
    await userEvent.type(within(dialog).getByLabelText('Note (optional)'), 'Fine');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Approve and post' }));
    expect(await screen.findByText(/^Journal entry.* approved and posted$/, {}, { timeout: 6000 })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Nothing waiting for approval')).toBeInTheDocument(), { timeout: 4000 });
    await userEvent.click(screen.getByRole('radio', { name: 'Decided' }));
    expect(await screen.findByText(/approved by Admin \(demo\)/, {}, { timeout: 4000 })).toBeInTheDocument();
  }, 40_000);
});
