import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AuthClient } from './client';
import SessionsDialog from './SessionsDialog';

describe('Sessions dialog', () => {
  it('lists the devices, this one first, and signs another out', { timeout: 20_000 }, async () => {
    let list = [
      { id: 's1', current: true, startedAt: '2026-11-01T09:00:00Z', lastUsedAt: '2026-11-10T08:00:00Z', ip: '49.36.10.4', device: { browser: 'Chrome', os: 'Windows', mobile: false } },
      { id: 's2', current: false, startedAt: '2026-11-02T09:00:00Z', lastUsedAt: '2026-11-09T18:30:00Z', ip: '106.51.2.9', device: { browser: 'Safari', os: 'iPhone', mobile: true } },
    ];
    const sessions = {
      list: vi.fn(async () => list),
      revoke: vi.fn(async (id: string) => {
        list = list.filter((s) => s.id !== id);
      }),
    };
    render(
      <QueryClientProvider client={new QueryClient()}>
        <SessionsDialog client={{ sessions } as unknown as AuthClient} onClose={() => {}} />
      </QueryClientProvider>,
    );
    const items = await screen.findAllByRole('listitem', {}, { timeout: 4000 });
    expect(items[0]).toHaveTextContent('Chrome on Windows');
    expect(items[0]).toHaveTextContent('This device');
    expect(within(items[0]!).queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument();
    expect(items[1]).toHaveTextContent('Safari on iPhone');
    expect(items[1]).toHaveTextContent('106.51.2.9');
    await userEvent.click(within(items[1]!).getByRole('button', { name: 'Sign out' }));
    expect(sessions.revoke).toHaveBeenCalledWith('s2');
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1), { timeout: 4000 });
  });
});
