import { ALL_PERMISSIONS, type Permission } from '@ledgernest/shared';
import { visibleNav } from './nav';

describe('navigation', () => {
  const all = new Set<Permission>(ALL_PERMISSIONS);
  const targets = (inOrganization: boolean) => visibleNav(all, inOrganization).flatMap((g) => g.items.map((i) => i.to));

  it('shows a Super Admin outside any organisation only the platform console', () => {
    const outside = targets(false);
    expect(outside.length).toBeGreaterThan(0);
    expect(outside.every((to) => to.startsWith('/platform'))).toBe(true);
    expect(targets(true)).toEqual(expect.arrayContaining(['/invoices', '/accounts', '/platform']));
  });
});
