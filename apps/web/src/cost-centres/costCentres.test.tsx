import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import AppProviders from '../AppProviders';
import { resetDemoAccounts } from '../accounts/demoAccountsApi';
import { resetDemoJournals } from '../journals/demoJournalsApi';
import { resetDemoPeriods } from '../periods/demoPeriodsApi';
import { routes } from '../routes';
import { openDialog } from '../test/openDialog';
import { resetDemoCostCentres } from './demoCostCentresApi';

function renderApp(path = '/cost-centres') {
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
  for (const reset of [resetDemoCostCentres, resetDemoJournals, resetDemoAccounts, resetDemoPeriods]) reset();
  sessionStorage.clear();
});

describe('cost centres', () => {
  it('adds a project, archives it and deletes it', async () => {
    renderApp();
    expect(await screen.findByText('Pune office', {}, { timeout: 4000 })).toBeInTheDocument();
    const dialog = await openDialog('Add cost centre', 'Add a cost centre');
    await userEvent.type(within(dialog).getByLabelText('Code'), 'prj-alpha');
    expect(within(dialog).getByLabelText('Code')).toHaveValue('PRJ-ALPHA');
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Project Alpha');
    await userEvent.selectOptions(within(dialog).getByLabelText('Kind'), 'project');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add cost centre' }));
    expect(await screen.findByText('Project Alpha added', {}, { timeout: 4000 })).toBeInTheDocument();
    const row = (await screen.findByText('Project Alpha', { selector: 'span.font-medium' }, { timeout: 4000 })).closest('li')!;
    expect(row).toHaveTextContent('Project');

    await userEvent.click(within(row).getByRole('button', { name: 'Actions for Project Alpha' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Archive' }));
    expect(await screen.findByText('Project Alpha archived', {}, { timeout: 4000 })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Project Alpha', { selector: 'span.font-medium' })).not.toBeInTheDocument());
    await userEvent.click(screen.getByLabelText('Show archived'));
    const archived = (await screen.findByText('Project Alpha', { selector: 'span.font-medium' }, { timeout: 4000 })).closest('li')!;
    await userEvent.click(within(archived).getByRole('button', { name: 'Actions for Project Alpha' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    const confirm = (await screen.findByText(/^Only a cost centre nothing has been tagged with/)).closest('[role="dialog"]') as HTMLElement;
    await userEvent.click(within(confirm).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('Project Alpha deleted', {}, { timeout: 4000 })).toBeInTheDocument();
  }, 30_000);

  it('shows profit with a column for each cost centre, and for one of them', async () => {
    renderApp('/reports?tab=pnl&compare=costCentres');
    const table = await screen.findByRole('table', { name: 'Profit and loss' }, { timeout: 6000 });
    await waitFor(() => expect(within(table).getByRole('columnheader', { name: 'PUNE · Pune office' })).toBeInTheDocument(), { timeout: 4000 });
    expect(within(table).getByRole('columnheader', { name: 'MUM · Mumbai branch' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'Unassigned' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('radio', { name: 'Nothing' }));
    const filter = await screen.findByLabelText('Cost centre', {}, { timeout: 4000 });
    await userEvent.selectOptions(filter, (within(filter).getByRole('option', { name: 'MUM · Mumbai branch' }) as HTMLOptionElement).value);
    await waitFor(() => expect(screen.getByRole('table', { name: 'Profit and loss' })).toHaveTextContent('38,200.00'), { timeout: 4000 });
  }, 30_000);
});
