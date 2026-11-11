import { describe, expect, it } from 'vitest';
import { bankDetailsLine, bankDetailsSchema, ifscFromRazorpay } from './index.js';

describe('bank details', () => {
  it('reads a branch from the IFSC directory, refusing anything that isn’t it', () => {
    const r = { BANK: 'HDFC Bank', IFSC: 'HDFC0001234', BRANCH: 'BANER', ADDRESS: 'Baner Road, Pune', CITY: 'PUNE', STATE: 'MAHARASHTRA', UPI: true, NEFT: true, RTGS: true, IMPS: true };
    expect(ifscFromRazorpay('HDFC0001234', r)).toMatchObject({ bank: 'HDFC Bank', branch: 'BANER', upi: true });
    expect(ifscFromRazorpay('HDFC0009999', r)).toBeNull();
    expect(ifscFromRazorpay('HDFC0001234', 'Not Found')).toBeNull();
  });

  it('checks the account and IFSC, and prints them', () => {
    const p = bankDetailsSchema.safeParse({ accountName: 'Nest Demo Pvt Ltd', accountNumber: '5010 0123 4567 89', ifsc: 'hdfc0001234', bankName: 'HDFC Bank', branch: 'Baner' });
    expect(p.success).toBe(true);
    expect(bankDetailsLine(p.data!)).toBe('Bank: HDFC Bank, Baner · A/c 50100123456789 · IFSC HDFC0001234 · Nest Demo Pvt Ltd');
    expect(bankDetailsSchema.safeParse({ accountName: 'X Y', accountNumber: '12345', ifsc: 'HDFC1001234' }).error!.issues.map((i) => i.path[0])).toEqual(['accountNumber', 'ifsc']);
  });
});
