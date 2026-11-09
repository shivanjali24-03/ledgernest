import type { AuthClient } from '../auth/client';
import type { AttachmentsApi } from './types';

/** Attachments backed by the real API, always for one organisation. */
export function createLiveAttachmentsApi(client: AuthClient, organizationId: string): AttachmentsApi {
  const headers = { 'X-Organization-Id': organizationId };
  const r = <T>(path: string, init: RequestInit & { json?: unknown } = {}) => client.request<T>(`/attachments${path}`, { ...init, headers });
  return {
    list: (type, id) => r(`/${type}/${id}`),
    add: (type, id, file) => r(`/${type}/${id}`, { method: 'POST', json: file }),
    async file(type, id, attachmentId, inline) {
      const { blob, filename } = await client.download(`/attachments/${type}/${id}/${attachmentId}${inline ? '?inline=true' : ''}`, { headers });
      return { blob, filename: filename ? decodeURIComponent(filename) : 'attachment' };
    },
    remove: (type, id, attachmentId) => r(`/${type}/${id}/${attachmentId}`, { method: 'DELETE' }),
  };
}
