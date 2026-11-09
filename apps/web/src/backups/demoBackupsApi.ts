import { ApiError } from '../auth/client';
import type { BackupsApi } from './types';

/**
 * Backups in demo mode: everything the demo keeps in this browser, as one file. Restoring puts a file's data
 * back in place of the sample company's, here only.
 */
const FORMAT = 'ledgernest-demo-backup';
const PREFIX = 'ledgernest.demo.';

export function createDemoBackupsApi(isOwner: () => boolean): BackupsApi {
  const guard = () => {
    if (!isOwner()) throw new ApiError('forbidden', 403, undefined, undefined, { missing: ['org.delete'] });
  };
  return {
    async download() {
      guard();
      const data: Record<string, string> = {};
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)!;
        if (k.startsWith(PREFIX)) data[k] = localStorage.getItem(k)!;
      }
      const exportedAt = new Date().toISOString();
      return { blob: new Blob([JSON.stringify({ format: FORMAT, exportedAt, source: { name: 'Nest Demo Pvt. Ltd.' }, data })], { type: 'application/json' }), filename: `nest-demo-backup-${exportedAt.slice(0, 10)}.json` };
    },
    async restore(backup) {
      guard();
      const b = backup as { format?: string; data?: Record<string, string> };
      if (b.format !== FORMAT || !b.data) throw new ApiError('validation', 400, undefined, undefined, { reason: 'backup_invalid' });
      for (const k of Object.keys(localStorage).filter((x) => x.startsWith(PREFIX))) localStorage.removeItem(k);
      for (const [k, v] of Object.entries(b.data)) if (k.startsWith(PREFIX)) localStorage.setItem(k, v);
      return { organizationId: 'demo', name: 'Nest Demo Pvt. Ltd.' };
    },
    describe(json) {
      const b = json as { format?: string; exportedAt?: string; data?: Record<string, string> } | null;
      if (!b || b.format !== FORMAT || !b.data) return null;
      const rows = Object.values(b.data).reduce((s, v) => {
        try {
          const x = JSON.parse(v) as unknown;
          return s + (Array.isArray(x) ? x.length : 1);
        } catch {
          return s + 1;
        }
      }, 0);
      return { format: FORMAT, name: 'Nest Demo Pvt. Ltd.', exportedAt: b.exportedAt ?? '', tables: Object.keys(b.data).length, rows };
    },
  };
}
