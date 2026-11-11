import { describe, expect, it } from 'vitest';
describe('organisation identifiers', () => {
  it('validates PAN, TAN, CIN and IEC formats', async () => {
    const { organizationSettingsSchema } = await import('./index.js');
    expect(organizationSettingsSchema.safeParse({ pan: 'aapfn1234c' }).data).toEqual({ pan: 'AAPFN1234C' });
    expect(organizationSettingsSchema.safeParse({ pan: 'AAPXN1234C' }).success).toBe(false);
    expect(organizationSettingsSchema.safeParse({ tan: 'PNEN12345A' }).success).toBe(true);
    expect(organizationSettingsSchema.safeParse({ cin: 'U72200MH2020PTC123456' }).success).toBe(true);
    expect(organizationSettingsSchema.safeParse({ cin: 'AAB-1234' }).success).toBe(true);
    expect(organizationSettingsSchema.safeParse({ cin: '' }).data).toEqual({ cin: null });
  });

  it('checks the PAN against the GSTIN and the kind of business, and the CIN against the kind of company', async () => {
    const { organizationIdProblems } = await import('./index.js');
    expect(organizationIdProblems({ pan: 'AAPFN1234C', taxId: '27AAPFN1234C1Z5', businessType: 'partnership' })).toEqual([]);
    expect(organizationIdProblems({ pan: 'AAPCN1234C', taxId: '27AAPFN1234C1Z5' })[0]).toMatchObject({ field: 'pan' });
    expect(organizationIdProblems({ pan: 'AAPFN1234C', businessType: 'private_limited' })[0]!.message).toMatch(/4th letter/);
    expect(organizationIdProblems({ cin: 'U72200MH2020PLC123456', businessType: 'private_limited' })[0]!.message).toMatch(/PLC/);
    expect(organizationIdProblems({ cin: 'AAB-1234', businessType: 'llp' })).toEqual([]);
    expect(organizationIdProblems({ cin: 'AAB-1234', businessType: 'proprietorship' })).toHaveLength(1);
  });
});
