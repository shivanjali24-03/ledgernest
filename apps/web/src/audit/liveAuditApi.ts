import type { AuthClient } from '../auth/client';
import type { AuditApi, AuditFilters, AuditScope } from './types';

const qs = (q: Record<string, string | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
};

/** The audit log backed by the real API. The organisation log always sends the organisation header. */
export function createLiveAuditApi(client: AuthClient, scope: AuditScope, organizationId: string | null): AuditApi {
  const base = scope === 'platform' ? '/platform/audit' : '/organization/audit';
  const headers: Record<string, string> = scope === 'organization' && organizationId ? { 'X-Organization-Id': organizationId } : {};
  const filters = (f: AuditFilters) => ({
    group: f.group,
    actorId: f.actorId,
    organizationId: scope === 'platform' ? f.organizationId : undefined,
    from: f.from,
    to: f.to,
  });
  return {
    list: (f, cursor) => client.request(`${base}${qs({ ...filters(f), cursor })}`, { headers }),
    actors: () => client.request(`${base}/actors`, { headers }),
    async exportCsv(f) {
      const { blob, filename, headers: h } = await client.download(`${base}/export${qs(filters(f))}`, { headers });
      return {
        blob,
        filename: filename ?? 'audit-log.csv',
        truncated: h.get('X-Truncated') === 'true',
      };
    },
  };
}
