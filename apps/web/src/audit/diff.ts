import { AUDIT_ACTION_GROUPS, type AuditActionGroup } from '@ledgernest/shared';

export type Change = 'added' | 'removed' | 'changed' | 'same';

export interface DiffRow {
  field: string;
  before: unknown;
  after: unknown;
  change: Change;
  /** For lists of plain values (e.g. permissions): what was added and taken away */
  list?: { added: string[]; removed: string[]; kept: string[] };
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStringList = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Field-by-field comparison of an entry's before and after values, in a stable order
 * (fields present before come first). Non-object values are shown as a single "value" field.
 */
export function diffEntry(before: unknown, after: unknown): DiffRow[] {
  if (before == null && after == null) return [];
  const b = isRecord(before) ? before : before == null ? {} : { value: before };
  const a = isRecord(after) ? after : after == null ? {} : { value: after };
  const fields = [...new Set([...Object.keys(b), ...Object.keys(a)])];
  return fields.map((field) => {
    const inB = field in b && b[field] !== undefined;
    const inA = field in a && a[field] !== undefined;
    const row: DiffRow = {
      field,
      before: b[field],
      after: a[field],
      change: before == null ? 'added' : after == null ? 'removed' : !inB ? 'added' : !inA ? 'removed' : same(b[field], a[field]) ? 'same' : 'changed',
    };
    if (row.change === 'changed' && isStringList(b[field]) && isStringList(a[field])) {
      const was = new Set(b[field]);
      const now = new Set(a[field]);
      row.list = {
        added: a[field].filter((x) => !was.has(x)),
        removed: b[field].filter((x) => !now.has(x)),
        kept: a[field].filter((x) => was.has(x)),
      };
    }
    return row;
  });
}

/** Which filter group an action belongs to (for its icon and colour). */
export function groupOf(action: string): AuditActionGroup | null {
  for (const [group, prefixes] of Object.entries(AUDIT_ACTION_GROUPS) as [AuditActionGroup, readonly string[]][]) if (prefixes.some((p) => action.startsWith(p))) return group;
  return null;
}

/** Actions worth drawing the eye to. */
export function toneOf(action: string): 'danger' | 'warning' | 'neutral' {
  if (/(failed|lockout|reuse_detected|suspend|remove|delete|revoke|demote)$/.test(action)) return 'danger';
  if (action === 'platform.support_access' || action.endsWith('.export')) return 'warning';
  return 'neutral';
}

/** Who or what an entry is about, when the entry says (an email or a name). */
export function subjectOf(before: unknown, after: unknown): string | null {
  for (const v of [after, before]) {
    if (!isRecord(v)) continue;
    for (const k of ['user', 'email', 'name'] as const) if (typeof v[k] === 'string' && v[k]) return v[k];
  }
  return null;
}

/** A local calendar day (yyyy-mm-dd) as the ISO instant where it starts or ends. */
export function dayBoundary(day: string, edge: 'start' | 'end'): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return undefined;
  const d = new Date(`${day}T${edge === 'start' ? '00:00:00.000' : '23:59:59.999'}`);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/** A short, readable device name from a user agent: "Safari on macOS". */
export function deviceOf(ua: string | null): string | null {
  if (!ua) return null;
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /curl|node|undici/i.test(ua) ? 'API client' : null;
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : null;
  return browser && os ? `${browser} · ${os}` : (browser ?? os ?? ua.slice(0, 40));
}
