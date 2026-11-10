import { describe, expect, it } from 'vitest';
import { PIN_CODE, pinLookupFromIndiaPost } from './index.js';

// India Post's answer for 411045 (trimmed)
const BANER = [
  {
    Message: 'Number of pincode(s) found:2',
    Status: 'Success',
    PostOffice: [
      { Name: 'Baner Gaon', BranchType: 'Branch Post Office', DeliveryStatus: 'Non-Delivery', District: 'Pune', Block: 'Haveli', State: 'Maharashtra', Country: 'India', Pincode: '411045' },
      { Name: 'N.I.A.', BranchType: 'Sub Post Office', DeliveryStatus: 'Delivery', District: 'Pune', Block: 'Pune City', State: 'Maharashtra', Country: 'India', Pincode: '411045' },
    ],
  },
];

describe('Addresses from the PIN code', () => {
  it('accepts six-digit PINs not starting with 0', () => {
    expect(['411045', '110001', '011045', '41104', '4110455', '41104a'].map((p) => PIN_CODE.test(p))).toEqual([true, true, false, false, false, false]);
  });

  it('gives the GST state, the district, towns to choose from and the localities, delivering offices first', () => {
    expect(pinLookupFromIndiaPost('411045', BANER)).toEqual({
      pin: '411045',
      state: { code: '27', name: 'Maharashtra' },
      district: 'Pune',
      cities: ['Pune', 'Haveli', 'Pune City'],
      localities: [
        { name: 'N.I.A.', block: 'Pune City', district: 'Pune', delivery: true },
        { name: 'Baner Gaon', block: 'Haveli', district: 'Pune', delivery: false },
      ],
    });
  });

  it('says nothing for a PIN India Post doesn’t know, or an answer that isn’t its shape', () => {
    expect(pinLookupFromIndiaPost('999999', [{ Message: 'No records found', Status: 'Error', PostOffice: null }])).toBeNull();
    expect(pinLookupFromIndiaPost('411045', { evil: true })).toBeNull();
    expect(pinLookupFromIndiaPost('411045', [{ Status: 'Success', PostOffice: [{ Name: 'X', District: 'Pune', Pincode: '560001' }] }])).toBeNull();
  });

  it('drops NA blocks and still works when the state name isn’t one it knows', () => {
    const r = pinLookupFromIndiaPost('744101', [{ Status: 'Success', PostOffice: [{ Name: 'Port Blair', DeliveryStatus: 'Delivery', District: 'South Andaman', Block: 'NA', State: 'Atlantis', Pincode: '744101' }] }]);
    expect(r).toMatchObject({ state: null, cities: ['South Andaman'], localities: [{ name: 'Port Blair', block: null }] });
  });
});
