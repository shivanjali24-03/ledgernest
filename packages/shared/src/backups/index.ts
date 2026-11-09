import { z } from 'zod';

/**
 * An organisation's books as one JSON file: every table that belongs to it, row by row, with bytes as base64
 * and big numbers as text. It restores into a new organisation, every id renewed, after checking that the
 * file holds together. People, invitations, API keys, webhooks and the audit trail stay behind.
 */
export const BACKUP_FORMAT = 'ledgernest-backup';
export const BACKUP_VERSION = 1;
export const MAX_BACKUP_BYTES = 50 * 1024 * 1024;

export const backupFileSchema = z.object({
  format: z.literal(BACKUP_FORMAT, 'This isn’t a LedgerNest backup.'),
  version: z.number().int(),
  exportedAt: z.string(),
  source: z.object({ organizationId: z.string(), name: z.string() }),
  organization: z.record(z.string(), z.unknown()),
  tables: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))),
});
export type BackupFile = z.infer<typeof backupFileSchema>;

export const backupRestoreSchema = z.object({
  /** The new organisation's name; the backup's own name with “(restored)” if left out */
  name: z.string().trim().min(2).max(120).optional(),
  backup: backupFileSchema,
});
