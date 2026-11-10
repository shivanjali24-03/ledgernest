import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { todayIn } from '@ledgernest/shared';
import AppProviders from '../AppProviders';
import { resetDemoAccounts } from '../accounts/demoAccountsApi';
import { resetDemoBills } from '../bills/demoBillsApi';
import { resetDemoContacts } from '../contacts/demoContactsApi';
import { resetDemoInvoices } from '../invoices/demoInvoicesApi';
import { resetDemoJournals } from '../journals/demoJournalsApi';
import { resetDemoPayments } from '../payments/demoPaymentsApi';
import { routes } from '../routes';
import { demoConfirmationRows, resetDemoConfirmations } from './demoConfirmations';

function renderApp(path: string, signedIn = true) {
  if (signedIn) sessionStorage.setItem('ledgernest.demo', 'admin@ledgernest.demo');
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <AppProviders client={null}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return router;
}

beforeEach(() => {
  for (const reset of [resetDemoPayments, resetDemoBills, resetDemoInvoices, resetDemoJournals, resetDemoAccounts, resetDemoContacts, resetDemoConfirmations]) reset();
  sessionStorage.clear();
});

describe('balance confirmations', () => {
  it('asks customers to confirm, and shows what each answered from their link', { timeout: 30_000 }, async () => {
    const today = todayIn('Asia/Kolkata');
    renderApp(`/reports?tab=confirmations&asOf=${today}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Ask for confirmation' }, { timeout: 6000 }));
    const dialog = await screen.findByRole('dialog', { name: 'Ask for balance confirmation' }, { timeout: 4000 });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Ask now' }));
    const row = (await screen.findByText('Kumar Logistics', {}, { timeout: 6000 })).closest('tr')!;
    expect(row).toHaveTextContent('₹1,18,000.00');
    expect(row).toHaveTextContent('Waiting');
    expect(within(row).getByRole('link', { name: 'Send Kumar Logistics the link on WhatsApp' }).getAttribute('href')).toContain('wa.me');

    // Kumar opens the link and disputes it with their own figure
    const kumar = demoConfirmationRows().find((r) => r.contactName === 'Kumar Logistics')!;
    cleanup();
    renderApp(`/b/${kumar.token}`, false);
    expect(await screen.findByTestId('confirmation-balance', {}, { timeout: 6000 })).toHaveTextContent('You owe us ₹1,18,000.00');
    await userEvent.click(screen.getByLabelText('No, it differs'));
    await userEvent.type(screen.getByLabelText('The balance in your books (INR)'), '1,00,000');
    await userEvent.type(screen.getByLabelText(/What differs/), 'Paid ₹18,000 by NEFT');
    await userEvent.click(screen.getByRole('button', { name: 'Send my figure' }));
    expect(await screen.findByText('Your name', {}, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Enter your name.');
    await userEvent.type(screen.getByLabelText('Your name'), 'Ravi Kumar');
    await userEvent.click(screen.getByRole('button', { name: 'Send my figure' }));
    expect(await screen.findByRole('status', {}, { timeout: 4000 })).toHaveTextContent('Ravi Kumar told us the balance differs');

    cleanup();
    renderApp(`/reports?tab=confirmations&asOf=${today}`);
    const after = (await screen.findByText('Kumar Logistics', {}, { timeout: 6000 })).closest('tr')!;
    await waitFor(() => expect(after).toHaveTextContent('Disputed'));
    expect(after).toHaveTextContent('by Ravi Kumar');
    expect(after).toHaveTextContent('₹1,00,000.00');
    expect(after).toHaveTextContent('Paid ₹18,000 by NEFT');
  });
});
