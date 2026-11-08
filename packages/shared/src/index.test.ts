import { describe, expect, it } from 'vitest';
import { PRODUCT_NAME } from './index';

describe('@ledgernest/shared', () => {
  it('exposes the product name', () => {
    expect(PRODUCT_NAME).toBe('LedgerNest');
  });
});
