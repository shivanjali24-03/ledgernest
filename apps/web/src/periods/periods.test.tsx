import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { fiscalYearName, fiscalYearOf, todayIn } from '@ledgernest/shared';
import AppProviders from '../AppProviders';
import { routes } from '../routes';
import { resetDemoAccounts } from '../accounts/demoAccountsApi';
import { resetDemoJournals } from '../journals/demoJournalsApi';
import { resetDemoTaxes } from '../taxes/demoTaxesApi';
import { resetDemoPeriods } from './demoPeriodsApi';

function renderApp(path = '/periods') {
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
const thisYear = fiscalYearOf(todayIn('Asia/Kolkata'), 4);

beforeEach(() => {
  resetDemoPeriods();
  resetDemoJournals();
  resetDemoAccounts();
  resetDemoTaxes();
  sessionStorage.clear();
});

describe('financial years', () => {
  it('shows last year and this one, month by month, with the current year marked', async () => {
    renderApp();
    expect(await screen.findByRole('heading', { name: fiscalYearName(thisYear, 4) })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: fiscalYearName(thisYear - 1, 4) })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem').filter((li) => /20\d\d/.test(li.textContent ?? '')).length).toBe(24);
    expect(screen.getAllByText('Current')).toHaveLength(1);
    // Only the earliest open month offers "Close month", and only the latest closed one "Reopen"
    expect(screen.getAllByRole('button', { name: 'Close month' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Reopen' })).toHaveLength(1);
  });

  it('closes the next month with a reason, then lets it be reopened', async () => {
    renderApp();
    const closeButton = await screen.findByRole('button', { name: 'Close month' });
    const month = closeButton.closest('li')!.querySelector('span span')!.textContent!;
    await userEvent.click(closeButton);
    const dialog = await screen.findByRole('dialog', { name: `Close ${month}?` });
    await userEvent.type(within(dialog).getByRole('textbox'), 'Books reviewed');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close month' }));
    expect(await screen.findByText(/ closed$/)).toBeInTheDocument();

    // Once the list refreshes, the month just closed is the one that can reopen
    const row = await waitFor(() => {
      const li = [...document.querySelectorAll('li')].find((l) => l.textContent?.startsWith(month) && l.textContent.includes('Reopen'));
      if (!li) throw new Error('not refreshed yet');
      return li as HTMLElement;
    });
    await userEvent.click(within(row).getByRole('button', { name: 'Reopen' }));
    await userEvent.click(within(await screen.findByRole('dialog', { name: /^Reopen / })).getByRole('button', { name: 'Reopen' }));
    expect(await screen.findByText(/ reopened$/)).toBeInTheDocument();
  });

  it('adds the next and an earlier financial year', async () => {
    renderApp();
    await userEvent.click(await screen.findByRole('button', { name: 'Add next financial year' }));
    expect(await screen.findByRole('heading', { name: fiscalYearName(thisYear + 1, 4) })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Add earlier year' }));
    expect(await screen.findByRole('heading', { name: fiscalYearName(thisYear - 2, 4) })).toBeInTheDocument();
  });

  it('lets Viewers see the months but not close them', async () => {
    renderApp();
    await screen.findByRole('heading', { name: fiscalYearName(thisYear, 4) });
    await previewAs('viewer');
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Close month' })).not.toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Add next financial year' })).not.toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: fiscalYearName(thisYear, 4) })).toBeInTheDocument();
  });

  it("closes the year with its last month, moving the year's result to retained earnings, and reopening reverses it", async () => {
    renderApp();
    const yearName = fiscalYearName(thisYear, 4);
    await screen.findByRole('heading', { name: yearName });
    // Close month after month until the year's last one, which offers "Close year"
    for (let i = 0; i < 13 && !screen.queryByRole('button', { name: 'Close year' }); i++) {
      await userEvent.click(await screen.findByRole('button', { name: 'Close month' }));
      await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Close month' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      await screen.findByRole('button', { name: /^Close (month|year)$/ }, { timeout: 4000 });
    }
    await userEvent.click(screen.getByRole('button', { name: 'Close year' }));
    const dialog = await screen.findByRole('dialog', { name: `Close ${yearName}?` });
    // This month's sample entries: ₹1,00,000 of sales against rent, salaries and the AWS bill
    expect(await within(dialog).findByText('A loss of ₹4,43,200.00 moves to Retained earnings.', {}, { timeout: 4000 })).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close year' }));
    expect(await screen.findByText(`${yearName} closed`, {}, { timeout: 4000 })).toBeInTheDocument();
    const link = await screen.findByRole('link', { name: /^JV\// }, { timeout: 4000 });
    expect(link.closest('header')).toHaveTextContent('Closed with');

    await userEvent.click(screen.getByRole('button', { name: 'Reopen' }));
    const reopen = await screen.findByRole('dialog', { name: `Reopen ${yearName}?` });
    expect(reopen).toHaveTextContent(`the year-end entry ${link.textContent} is reversed`);
    await userEvent.click(within(reopen).getByRole('button', { name: 'Reopen' }));
    expect(await screen.findByText(`${yearName} reopened`, {}, { timeout: 4000 })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Closed with')).not.toBeInTheDocument());
  }, 30_000);
});
