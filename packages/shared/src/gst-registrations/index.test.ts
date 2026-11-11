import { describe, expect, it } from 'vitest';
import { gstinCheckChar } from '../taxes/index.js';
import { gstinStateCode, gstRegistrationSchema, panOfGstin } from './index.js';

const gstin = (first14: string) => `${first14}${gstinCheckChar(first14)}`;

describe('GST registrations', () => {
  it('takes a valid GSTIN, its state and PAN from it', () => {
    const g = gstin('24AAPFN1234C1Z');
    expect(gstRegistrationSchema.parse({ gstin: g.toLowerCase() }).gstin).toBe(g);
    expect(gstinStateCode(g)).toBe('24');
    expect(panOfGstin(g)).toBe('AAPFN1234C');
    expect(gstRegistrationSchema.safeParse({ gstin: '24AAPFN1234C1Z0' }).success).toBe(false);
  });
});
