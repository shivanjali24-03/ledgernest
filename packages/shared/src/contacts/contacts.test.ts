import { describe, expect, it } from 'vitest';
import { contactCreateSchema, contactStateCode, contactUpdateSchema } from './index.js';

describe('contacts', () => {
  it('needs a name and to be a customer, a vendor or both', () => {
    const c = contactCreateSchema.parse({ name: ' Kumar Logistics ', isCustomer: true, isVendor: false });
    expect(c).toMatchObject({ name: 'Kumar Logistics', paymentTermsDays: 30, currency: null, shippingAddress: null, billingAddress: { country: null } });
    expect(contactCreateSchema.safeParse({ name: 'X Co', isCustomer: false, isVendor: false }).success).toBe(false);
  });

  it('checks an Indian GSTIN and its state', () => {
    const base = { name: 'Acme India', isCustomer: true, isVendor: false };
    expect(contactCreateSchema.safeParse({ ...base, taxId: '27AAPFU0939F1ZV', billingAddress: { country: 'IN', region: 'Maharashtra' } }).success).toBe(true);
    expect(contactCreateSchema.safeParse({ ...base, taxId: '27AAPFU0939F1ZW', billingAddress: { country: 'IN' } }).success).toBe(false);
    expect(contactCreateSchema.safeParse({ ...base, taxId: '27AAPFU0939F1ZV', billingAddress: { country: 'IN', region: 'Karnataka' } }).success).toBe(false);
    // Outside India a tax ID is free text (VAT numbers, EINs…)
    expect(contactCreateSchema.safeParse({ ...base, taxId: 'GB123456789', billingAddress: { country: 'GB' } }).success).toBe(true);
  });

  it('works out the state of supply from the GSTIN, else the address', () => {
    expect(contactStateCode({ taxId: '27AAPFU0939F1ZV', billingAddress: { region: null, country: 'IN' } })).toBe('27');
    expect(contactStateCode({ taxId: null, billingAddress: { region: 'Kerala', country: 'IN' } })).toBe('32');
    expect(contactStateCode({ taxId: null, billingAddress: { region: 'Bavaria', country: 'DE' } })).toBeNull();
  });

  it('updates only what is sent', () => {
    expect(contactUpdateSchema.parse({ paymentTermsDays: 45 })).toEqual({ paymentTermsDays: 45 });
    expect(contactUpdateSchema.safeParse({}).success).toBe(false);
    expect(contactUpdateSchema.safeParse({ balance: 5 }).success).toBe(false);
  });
});
