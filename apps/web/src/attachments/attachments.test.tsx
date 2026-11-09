import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import AppProviders from '../AppProviders';
import { resetDemoBills } from '../bills/demoBillsApi';
import { resetDemoJournals } from '../journals/demoJournalsApi';
import { routes } from '../routes';
import { resetDemoAttachments } from './demoAttachmentsApi';

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
const pdf = () => new File(['%PDF-1.4\n%%EOF\n'], 'rent-receipt.pdf', { type: 'application/pdf' });

beforeEach(() => {
  for (const reset of [resetDemoAttachments, resetDemoBills, resetDemoJournals]) reset();
  sessionStorage.clear();
  URL.createObjectURL ??= () => 'blob:preview';
  URL.revokeObjectURL ??= () => undefined;
});

describe('attachments', () => {
  it('attaches a receipt to a bill, previews it and removes it; a fake file is refused', async () => {
    renderApp('/bills');
    await userEvent.click(await screen.findByRole('link', { name: /^BILL\/.*\/0001$/ }, { timeout: 4000 }));
    expect(await screen.findByText('Nothing attached yet.', {}, { timeout: 4000 })).toBeInTheDocument();
    const input = screen.getByTestId('attachment-input') as HTMLInputElement;
    await userEvent.upload(input, new File(['not really a png'], 'fake.png', { type: 'image/png' }));
    expect(await screen.findByText('That file isn’t the type it claims to be.', {}, { timeout: 4000 })).toBeInTheDocument();
    await userEvent.upload(input, pdf());
    expect(await screen.findByText('File attached', {}, { timeout: 4000 })).toBeInTheDocument();
    const row = (await screen.findByText('rent-receipt.pdf')).closest('li')!;
    await userEvent.click(within(row).getByRole('button', { name: 'Preview rent-receipt.pdf' }));
    expect(await screen.findByTitle('rent-receipt.pdf', {}, { timeout: 4000 })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await userEvent.click(within(row).getByRole('button', { name: 'Remove rent-receipt.pdf' }));
    await waitFor(() => expect(screen.getByText('Nothing attached yet.')).toBeInTheDocument(), { timeout: 4000 });
  }, 30_000);
});
