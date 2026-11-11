import { senderFor } from './mail.service.js';

describe('The From line', () => {
  it('keeps the server’s address and shows the organisation’s name', () => {
    expect(
      senderFor('LedgerNest <no-reply@ledgernest.in>', 'Nest Demo Pvt. Ltd.'),
    ).toBe('"Nest Demo Pvt. Ltd. via LedgerNest" <no-reply@ledgernest.in>');
    expect(senderFor('no-reply@ledgernest.in', 'Sharma & Sons')).toBe(
      '"Sharma & Sons via LedgerNest" <no-reply@ledgernest.in>',
    );
  });

  it('leaves it alone without a name, and keeps a name from breaking the header', () => {
    expect(senderFor('LedgerNest <no-reply@ledgernest.in>', null)).toBe(
      'LedgerNest <no-reply@ledgernest.in>',
    );
    expect(
      senderFor('LedgerNest <no-reply@ledgernest.in>', 'Evil" <x@y>\r\nBcc: z'),
    ).toBe('"Evil x@yBcc: z via LedgerNest" <no-reply@ledgernest.in>');
  });
});
