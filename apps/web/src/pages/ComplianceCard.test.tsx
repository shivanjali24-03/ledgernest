import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SessionProvider from '../layout/SessionProvider';
import ComplianceCard from './ComplianceCard';

describe('Due dates card', () => {
  it('says what a late GST return costs if it isn’t filed yet', () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <SessionProvider email="admin@ledgernest.demo" onSignOut={async () => {}}>
          <ComplianceCard
            data={{
              today: '2026-11-25',
              items: [
                { kind: 'gstr3b', from: '2026-10-01', to: '2026-10-31', due: '2026-11-20', daysLeft: -5, amount: 1_00_000_00, lateFee: 250_00, interest: 246_58 },
                { kind: 'gstr1', from: '2026-11-01', to: '2026-11-30', due: '2026-12-11', daysLeft: 16 },
              ],
            }}
          />
          </SessionProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Not filed yet? Late fee so far: ₹250.00, plus ₹246.58 interest');
    expect(items[1]).not.toHaveTextContent('Late fee');
  });
});
