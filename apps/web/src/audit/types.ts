import type { AuditActionGroup } from '@ledgernest/shared';

/** Which log: one organisation's own history, or the whole platform's (Super Admins). */
export type AuditScope = 'organization' | 'platform';

export interface AuditActor {
  /** null when the person has since been deleted; the email captured at the time remains */
  id: string | null;
  name: string | null;
  email: string;
}

export interface AuditEntry {
  id: string;
  action: string;
  createdAt: string;
  actor: AuditActor | null;
  /** Platform log only */
  organization?: { id: string; name: string } | null;
  entityType: string | null;
  entityId: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  userAgent: string | null;
}

export interface AuditPage {
  items: AuditEntry[];
  nextCursor: string | null;
}

export interface AuditFilters {
  group?: AuditActionGroup;
  actorId?: string;
  organizationId?: string;
  /** ISO timestamps */
  from?: string;
  to?: string;
}

export interface AuditExport {
  blob: Blob;
  filename: string;
  /** More than the export limit matched; only the newest were included */
  truncated: boolean;
}

/** Reads one audit log. Live and demo both implement it. */
export interface AuditApi {
  list(filters: AuditFilters, cursor?: string): Promise<AuditPage>;
  actors(): Promise<{ id: string; name: string; email: string }[]>;
  exportCsv(filters: AuditFilters): Promise<AuditExport>;
}
