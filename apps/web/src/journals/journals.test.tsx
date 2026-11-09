import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import AppProviders from '../AppProviders';
import { resetDemoAccounts } from '../accounts/demoAccountsApi';
import { resetDemoPeriods } from '../periods/demoPeriodsApi';
import { routes } from '../routes';
import { resetDemoJournals } from './demoJournalsApi';

function renderApp(path = '/journals') {
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
const pick = (n: number, label: RegExp) => {
  const select = screen.getByLabelText(`Line ${n} account`) as HTMLSelectElement;
  const option = [...select.options].find((o) => label.test(o.textContent ?? ''))!;
  return userEvent.selectOptions(select, option.value);
};

beforeEach(() => {
  resetDemoJournals();
  resetDemoAccounts();
  resetDemoPeriods();
  sessionStorage.clear();
});

describe('journal entries', () => {
  it('lists entries newest first, in the organisation currency, with drafts and reversals marked', async () => {
    renderApp();
    expect(await screen.findByText('Payment from Kumar Logistics')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Amount (INR)' })).toBeInTheDocument();
    // Indian digit grouping: 1,18,000.00
    expect(screen.getAllByText('1,18,000.00').length).toBeGreaterThan(0);
    expect(screen.getByText(/^Reverses JV\//)).toBeInTheDocument();
    expect(screen.getByText('Reversed')).toBeInTheDocument();
  });

  it('writes a balanced entry, line by line, and posts it with the next number', async () => {
    renderApp('/journals/new');
    expect(await screen.findByRole('heading', { name: 'New journal entry' })).toBeInTheDocument();
    await waitFor(() => expect((screen.getByLabelText('Line 1 account') as HTMLSelectElement).options.length).toBeGreaterThan(10));
    await userEvent.type(screen.getByLabelText('Memo'), 'Internet bill');
    await pick(1, /Internet and phone/);
    await userEvent.type(screen.getByLabelText('Line 1 debit'), '2360');
    await pick(2, /HDFC Bank current/);
    await userEvent.type(screen.getByLabelText('Line 2 credit'), '2000');
    expect(screen.getByRole('status')).toHaveTextContent('Out by ₹360.00');
    expect(screen.getByRole('button', { name: 'Post' })).toBeDisabled();

    await userEvent.clear(screen.getByLabelText('Line 2 credit'));
    await userEvent.type(screen.getByLabelText('Line 2 credit'), '2,360');
    expect(screen.getByRole('status')).toHaveTextContent('Balanced');
    await userEvent.click(screen.getByRole('button', { name: 'Post' }));
    // Saving and posting chain several simulated round trips in the demo
    expect(await screen.findByText(/^Posted as JV\/.+\/0007$/, {}, { timeout: 4000 })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: /^JV\/.+\/0007$/ })).toBeInTheDocument();
  });

  it('reverses a posted entry with the exact opposite amounts, linked both ways', async () => {
    renderApp();
    await userEvent.click(await screen.findByRole('link', { name: /\/0002$/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Reverse' }));
    const dialog = await screen.findByRole('dialog', { name: /^Reverse JV/ });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reverse' }));
    expect(await screen.findByText(/^Reversed as JV\/.+\/0007$/, {}, { timeout: 4000 })).toBeInTheDocument();
    expect(await screen.findByText('This entry reverses')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /\/0002$/ })).toBeInTheDocument();
    // Rent was a debit in the original; it is a credit here
    const rent = screen.getByText('Office rent').closest('tr')!;
    expect(within(rent).getAllByRole('cell')[2]).toHaveTextContent('85,000.00');
  });

  it('a Bookkeeper saves drafts but cannot post them', async () => {
    renderApp();
    await screen.findByText('Payment from Kumar Logistics');
    await previewAs('bookkeeper');
    await userEvent.click(await screen.findByRole('link', { name: 'Draft' }));
    expect(await screen.findByRole('button', { name: 'Save draft' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Post' })).not.toBeInTheDocument();
  });

  it('is hidden from Viewers', async () => {
    renderApp('/');
    await previewAs('viewer');
    expect(screen.queryByRole('link', { name: 'Journal entries' })).not.toBeInTheDocument();
  });
});
