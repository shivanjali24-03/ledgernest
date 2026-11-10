import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError, type AuthClient } from './client';
import TwoFactorDialog from './TwoFactorDialog';

const CODES = Array.from({ length: 10 }, (_, i) => `ab${i}c-d${i}ef`);

function stub() {
  let enabled = false;
  const twoFactor = {
    status: vi.fn(async () => ({ enabled, enabledAt: null, recoveryCodesLeft: enabled ? 10 : 0 })),
    setup: vi.fn(async (password: string) => {
      if (password !== 'Right-Password-1') throw new ApiError('validation', 400, undefined, undefined, { reason: 'wrong_password' });
      return { secret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP', uri: 'otpauth://totp/LedgerNest:meera%40acme.in?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP' };
    }),
    enable: vi.fn(async (code: string) => {
      if (code !== '492039') throw new ApiError('validation', 400, undefined, undefined, { reason: 'wrong_code' });
      enabled = true;
      return { recoveryCodes: CODES };
    }),
    disable: vi.fn(async () => {
      enabled = false;
    }),
    recoveryCodes: vi.fn(async () => ({ recoveryCodes: CODES })),
  };
  return { twoFactor } as unknown as AuthClient & { twoFactor: typeof twoFactor };
}

describe('Two-factor dialog', () => {
  it('sets up with the password, a QR code and a code from the app, then shows the recovery codes', { timeout: 20_000 }, async () => {
    const client = stub();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <TwoFactorDialog client={client} onClose={() => {}} />
      </QueryClientProvider>,
    );
    const dialog = await screen.findByRole('dialog', { name: 'Two-factor sign-in' }, { timeout: 4000 });
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Set up' }, { timeout: 4000 }));
    await userEvent.type(within(dialog).getByLabelText('Your password'), 'Wrong-Password-1');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Continue' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('That password isn’t right.');
    await userEvent.clear(within(dialog).getByLabelText('Your password'));
    await userEvent.type(within(dialog).getByLabelText('Your password'), 'Right-Password-1');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Continue' }));
    expect(await within(dialog).findByRole('img', { name: 'QR code to add LedgerNest to an authenticator app' }, { timeout: 4000 })).toBeInTheDocument();
    expect(within(dialog).getByText('JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP')).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText('Code from the app'), '492 039');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Turn on' }));
    const list = await within(dialog).findByRole('list', { name: 'Recovery codes' }, { timeout: 4000 });
    expect(within(list).getAllByRole('listitem')).toHaveLength(10);
    expect(client.twoFactor.enable).toHaveBeenCalledWith('492039');
    await userEvent.click(within(dialog).getByRole('button', { name: 'I’ve saved them' }));
    expect(await within(dialog).findByText('Two-factor sign-in is on.', {}, { timeout: 4000 })).toBeInTheDocument();
    expect(within(dialog).getByText('10 recovery codes left.')).toBeInTheDocument();
  });
});
