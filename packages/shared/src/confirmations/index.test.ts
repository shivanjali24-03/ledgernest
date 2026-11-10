import { describe, expect, it } from 'vitest';
import { balanceConfirmationRequestSchema, balanceConfirmationResponseSchema } from './index.js';

describe('Balance confirmations', () => {
  it('asks for a day and a side, emailing by default', () => {
    expect(balanceConfirmationRequestSchema.parse({ asOf: '2027-03-31', side: 'receivable' })).toEqual({ asOf: '2027-03-31', side: 'receivable', send: true });
    expect(balanceConfirmationRequestSchema.safeParse({ asOf: '2027-03-31', side: 'both' }).success).toBe(false);
    expect(balanceConfirmationRequestSchema.safeParse({ asOf: '2027-03-31', side: 'payable', contactIds: [] }).success).toBe(false);
  });

  it('takes an agreement as it is, but a dispute needs their figure or a reason', () => {
    expect(balanceConfirmationResponseSchema.safeParse({ response: 'agree', name: 'Ravi Kumar' }).success).toBe(true);
    expect(balanceConfirmationResponseSchema.safeParse({ response: 'dispute', name: 'Ravi Kumar' }).success).toBe(false);
    expect(balanceConfirmationResponseSchema.parse({ response: 'dispute', name: 'Ravi Kumar', theirBalance: 5_000_00, note: '  ' })).toMatchObject({ theirBalance: 5_000_00, note: null });
    expect(balanceConfirmationResponseSchema.safeParse({ response: 'agree', name: 'R' }).success).toBe(false);
  });
});
