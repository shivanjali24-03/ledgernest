import { z } from 'zod';

/** Filter groups shown in the audit screens. Each matches actions by prefix. */
export const AUDIT_ACTION_GROUPS = {
  signIns: ['auth.'],
  members: ['org.member.'],
  invitations: ['org.invitation.', 'invitation.'],
  roles: ['org.role.'],
  settings: ['org.settings.', 'org.logo.'],
  accounts: ['org.account.'],
  periods: ['org.fiscal_year.', 'org.period.'],
  supportAccess: ['platform.support_access'],
  organizations: ['platform.organization.'],
  platformUsers: ['platform.user.', 'platform.superadmin.'],
  exports: ['org.audit.export', 'platform.audit.export'],
} as const satisfies Record<string, readonly string[]>;
export type AuditActionGroup = keyof typeof AUDIT_ACTION_GROUPS;

/** Groups that make sense inside one organisation (sign-ins and platform admin actions are platform-wide). */
export const ORGANIZATION_AUDIT_GROUPS: AuditActionGroup[] = ['accounts', 'periods', 'members', 'invitations', 'roles', 'settings', 'supportAccess', 'exports'];

export const AUDIT_PAGE_SIZE = 50;
export const AUDIT_EXPORT_LIMIT = 10_000;

export const auditQuerySchema = z.object({
  group: z.enum(Object.keys(AUDIT_ACTION_GROUPS) as [AuditActionGroup, ...AuditActionGroup[]]).optional(),
  actorId: z.uuid().optional(),
  organizationId: z.uuid().optional(),
  /** ISO timestamps; the web app converts the user's local day boundaries */
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(AUDIT_PAGE_SIZE),
});
export type AuditQuery = z.input<typeof auditQuerySchema>;

/**
 * Makes a value safe for a CSV cell: quotes it, and neutralises text a spreadsheet
 * would run as a formula (=, +, -, @, tab, carriage return), a classic injection route.
 */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? '' : typeof value === 'string' ? value : JSON.stringify(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}
