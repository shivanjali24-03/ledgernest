import { dayBoundary, deviceOf, diffEntry, groupOf, subjectOf, toneOf } from './diff';

describe('diffEntry', () => {
  it('marks every field as added for a creation, removed for a deletion', () => {
    expect(diffEntry(null, { name: 'Cashier' })).toEqual([{ field: 'name', before: undefined, after: 'Cashier', change: 'added' }]);
    expect(diffEntry({ email: 'a@b.in' }, null)).toEqual([{ field: 'email', before: 'a@b.in', after: undefined, change: 'removed' }]);
    expect(diffEntry(null, null)).toEqual([]);
  });

  it('compares field by field, and splits lists into added, removed and kept', () => {
    const rows = diffEntry(
      {
        name: 'Cashier',
        permissions: ['banking.view', 'invoices.view'],
        status: 'ACTIVE',
      },
      {
        name: 'Cashier',
        permissions: ['banking.view', 'reports.view'],
        reason: 'Audit season',
      },
    );
    expect(rows.map((r) => [r.field, r.change])).toEqual([
      ['name', 'same'],
      ['permissions', 'changed'],
      ['status', 'removed'],
      ['reason', 'added'],
    ]);
    expect(rows[1]!.list).toEqual({
      added: ['reports.view'],
      removed: ['invoices.view'],
      kept: ['banking.view'],
    });
  });

  it('treats nested objects as one value', () => {
    expect(diffEntry({ owner: { email: 'a' } }, { owner: { email: 'a' } })[0]!.change).toBe('same');
    expect(diffEntry({ owner: { email: 'a' } }, { owner: { email: 'b' } })[0]!.change).toBe('changed');
  });
});

describe('entry helpers', () => {
  it('maps actions to their filter group and tone', () => {
    expect(groupOf('org.invitation.create')).toBe('invitations');
    expect(groupOf('invitation.accept')).toBe('invitations');
    expect(groupOf('auth.login.failed')).toBe('signIns');
    expect(groupOf('something.else')).toBeNull();
    expect(toneOf('auth.lockout')).toBe('danger');
    expect(toneOf('platform.support_access')).toBe('warning');
    expect(toneOf('org.role.create')).toBe('neutral');
  });

  it('finds who an entry is about', () => {
    expect(subjectOf({ user: 'p@x.in', builtInRole: 'viewer' }, { user: 'p@x.in' })).toBe('p@x.in');
    expect(subjectOf(null, { name: 'Tax consultant' })).toBe('Tax consultant');
    expect(subjectOf(null, { failures: 3 })).toBeNull();
  });

  it('turns a local day into the instant it starts and ends', () => {
    const start = new Date(dayBoundary('2026-03-15', 'start')!);
    const end = new Date(dayBoundary('2026-03-15', 'end')!);
    expect([start.getFullYear(), start.getMonth(), start.getDate(), start.getHours()]).toEqual([2026, 2, 15, 0]);
    expect([end.getDate(), end.getHours(), end.getMinutes()]).toEqual([15, 23, 59]);
    expect(dayBoundary('15/03/2026', 'start')).toBeUndefined();
  });

  it('names the device from the user agent', () => {
    expect(deviceOf('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15')).toBe('Safari · macOS');
    expect(deviceOf('Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36')).toBe('Chrome · Android');
    expect(deviceOf(null)).toBeNull();
  });
});
