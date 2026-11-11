import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import AppProviders from '../AppProviders';
import { routes } from '../routes';
import { openDialog } from '../test/openDialog';
import { resetDemoPayroll } from './api';

function renderApp(path = '/payroll') {
  sessionStorage.setItem('ledgernest.demo', 'admin@ledgernest.demo');
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <AppProviders client={null}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
}

beforeEach(() => {
  resetDemoPayroll();
  sessionStorage.clear();
});

describe('payroll', () => {
  it('adds an employee, runs a month with days not paid, posts it and pays it', async () => {
    renderApp();
    expect(await screen.findByText('No pay runs yet', {}, { timeout: 10_000 })).toBeInTheDocument();
    let dialog = await openDialog('Add employee', 'New employee');
    await userEvent.type(within(dialog).getByLabelText('Employee code'), 'E-001');
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Asha Patil');
    const joined = within(dialog).getByLabelText('Date of joining');
    await userEvent.clear(joined);
    await userEvent.type(joined, '2025-04-01');
    await userEvent.type(within(dialog).getByLabelText('Basic (₹ a month)'), '10000');
    await userEvent.type(within(dialog).getByLabelText('House rent allowance (₹)'), '4000');
    await userEvent.type(within(dialog).getByLabelText('Special allowance (₹)'), '4000');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save employee' }));
    expect(await screen.findByText('Asha Patil saved', {}, { timeout: 4000 })).toBeInTheDocument();

    dialog = await openDialog('Run payroll', 'Run payroll for a month');
    const month = within(dialog).getByLabelText('Month');
    await userEvent.clear(month);
    await userEvent.type(month, '2026-06');
    await userEvent.type(within(dialog).getByLabelText('Asha Patil'), '6');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Run payroll' }));
    expect(await screen.findByText('Payroll for June 2026 drafted', {}, { timeout: 4000 })).toBeInTheDocument();
    const slips = await screen.findByRole('table', { name: 'Payslips for June 2026' }, { timeout: 4000 });
    // 24 of 30 days: ₹14,400 gross, PF 960, ESI 108, PT 200 → ₹13,132 net
    expect(within(slips).getByText('24/30')).toBeInTheDocument();
    expect(within(slips).getByText('13,132.00')).toBeInTheDocument();
    expect(within(slips).getByText(/PF 960\.00 · ESI 108\.00 · PT 200\.00/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Post' }));
    expect(await screen.findByText('Salaries for June 2026 posted', {}, { timeout: 4000 })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Pay salaries' })).toBeInTheDocument(), { timeout: 4000 });
  }, 40_000);
});
