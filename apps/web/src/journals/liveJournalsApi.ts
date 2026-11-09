import type { AuthClient } from '../auth/client';
import type { JournalsApi } from './types';

const qs = (q: Record<string, string | number | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== '') p.set(k, String(v));
  return p.toString() ? `?${p}` : '';
};

/** Journal entries backed by the real API, always for one organisation. */
export function createLiveJournalsApi(client: AuthClient, organizationId: string): JournalsApi {
  const headers = { 'X-Organization-Id': organizationId };
  const r = <T>(path: string, init: RequestInit & { json?: unknown } = {}) => client.request<T>(`/journals${path}`, { ...init, headers });
  return {
    list: (q) => r(qs({ ...q })),
    get: (id) => r(`/${id}`),
    create: (input) => r('', { method: 'POST', json: input }),
    update: (id, input) => r(`/${id}`, { method: 'PATCH', json: input }),
    remove: (id) => r(`/${id}`, { method: 'DELETE' }),
    post: (id) => r(`/${id}/post`, { method: 'POST' }),
    reverse: (id, input) => r(`/${id}/reverse`, { method: 'POST', json: input }),
    attach: (id, file) => r(`/${id}/attachments`, { method: 'POST', json: file }),
    async download(id, attachmentId) {
      const { blob, filename } = await client.download(`/journals/${id}/attachments/${attachmentId}`, { headers });
      return { blob, filename: filename ? decodeURIComponent(filename) : 'attachment' };
    },
    detach: (id, attachmentId) => r(`/${id}/attachments/${attachmentId}`, { method: 'DELETE' }),
  };
}
