import { BACKUP_FORMAT } from '@ledgernest/shared';
import type { AuthClient } from '../auth/client';
import type { BackupsApi } from './types';

/** Backups backed by the real API: the restore makes a new organisation, owned by whoever restores it. */
export function createLiveBackupsApi(client: AuthClient, organizationId: string): BackupsApi {
  const headers = { 'X-Organization-Id': organizationId };
  return {
    async download() {
      const { blob, filename } = await client.download('/backups/export', { headers });
      return { blob, filename: filename ? decodeURIComponent(filename) : 'backup.json' };
    },
    restore: (backup, name) => client.request('/backups/restore', { method: 'POST', json: { backup, ...(name && { name }) }, headers }),
    describe(json) {
      const b = json as { format?: string; source?: { name?: string }; exportedAt?: string; tables?: Record<string, unknown[]> } | null;
      if (!b || b.format !== BACKUP_FORMAT || !b.tables || !b.source?.name) return null;
      return { format: b.format, name: b.source.name, exportedAt: b.exportedAt ?? '', tables: Object.keys(b.tables).length, rows: Object.values(b.tables).reduce((s, r) => s + r.length, 0) };
    },
  };
}
