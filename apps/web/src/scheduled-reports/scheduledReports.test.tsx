import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import AppProviders from '../AppProviders';
import { resetDemoJournals } from '../journals/demoJournalsApi';
import { routes } from '../routes';
import { openDialog } from '../test/openDialog';
import { resetDemoScheduledReports } from './demoScheduledReportsApi';

function renderApp(path = '/reports?tab=scheduled') {
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
  for (const reset of [resetDemoScheduledReports, resetDemoJournals]) reset();
  sessionStorage.clear();
});

describe('scheduled reports', () => {
  it('schedules a weekly report, makes it now and keeps the file, then pauses it', async () => {
    renderApp();
    expect(await screen.findByText('No scheduled reports yet', {}, { timeout: 4000 })).toBeInTheDocument();
    const dialog = await openDialog('Schedule a report', /^It’s made for the period just ended/);
    await userEvent.selectOptions(within(dialog).getByLabelText('How often'), 'weekly');
    await userEvent.selectOptions(within(dialog).getByLabelText('On'), '1');
    await waitFor(() => expect(within(dialog).getAllByRole('checkbox').some((c) => (c as HTMLInputElement).checked)).toBe(true), { timeout: 4000 });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Schedule it' }));
    expect(await screen.findByText('Report scheduled', {}, { timeout: 4000 })).toBeInTheDocument();
    const row = (await screen.findByText('Weekly Profit and loss')).closest('li')!;
    expect(row).toHaveTextContent('Every Monday');

    await userEvent.click(within(row).getByRole('button', { name: 'Actions for Weekly Profit and loss' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Make it now' }));
    expect(await screen.findByText('Report made', {}, { timeout: 6000 })).toBeInTheDocument();
    await userEvent.click(within(screen.getByText('Weekly Profit and loss').closest('li')!).getByRole('button', { name: 'Actions for Weekly Profit and loss' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Past runs' }));
    expect(await screen.findByText(/^profit-and-loss-\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}\.xlsx$/, {}, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getByText(/kept here \(not emailed\)/)).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');

    await userEvent.click(within(screen.getByText('Weekly Profit and loss').closest('li')!).getByRole('button', { name: 'Actions for Weekly Profit and loss' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Pause' }));
    await waitFor(() => expect(screen.getByText('Weekly Profit and loss').closest('li')!).toHaveTextContent('Paused'), { timeout: 4000 });
  }, 40_000);
});
