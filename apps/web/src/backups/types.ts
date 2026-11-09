/** A backup file as read, enough to describe it before restoring */
export interface BackupSummary {
  format: string;
  name: string;
  exportedAt: string;
  rows: number;
  tables: number;
}

/** Downloading and restoring backups. Live and demo both implement it. */
export interface BackupsApi {
  download(): Promise<{ blob: Blob; filename: string }>;
  /** Restores into a new organisation (live), or over the demo company (demo) */
  restore(backup: unknown, name?: string): Promise<{ organizationId: string; name: string }>;
  /** What a file holds, or null if it isn't a backup this can restore */
  describe(json: unknown): BackupSummary | null;
}
