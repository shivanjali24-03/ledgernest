import { ATTACHMENT_MAX_BYTES, ATTACHMENT_PERMISSIONS, MAX_ATTACHMENTS_PER_DOCUMENT, sniffAttachmentType, type AttachableDocument, type OrganizationPermission } from '@ledgernest/shared';
import { ApiError } from '../auth/client';
import type { Attachment, AttachmentsApi } from './types';

/** Attachments in demo mode, kept in this browser (base64), with the same checks as the API. */
const KEY = 'ledgernest.demo.attachments';
type Stored = Attachment & { documentType: AttachableDocument; documentId: string; data: string };

function load(): Stored[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as Stored[];
  } catch {
    /* fall through */
  }
  return [];
}
function save(rows: Stored[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(rows));
  } catch {
    throw new ApiError('validation', 400, undefined, undefined, { reason: 'too_large' });
  }
}
export const resetDemoAttachments = () => {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing stored */
  }
};

const wait = <T>(fn: () => T | Promise<T>) => new Promise<T>((resolve, reject) => setTimeout(() => Promise.resolve().then(fn).then(resolve, reject), 100));
const bytesOf = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

export function createDemoAttachmentsApi(can: (p: OrganizationPermission) => boolean): AttachmentsApi {
  const guard = (type: AttachableDocument, need: 'view' | 'manage') => {
    const p = ATTACHMENT_PERMISSIONS[type][need];
    if (!can(p)) throw new ApiError('forbidden', 403, undefined, undefined, { missing: [p] });
  };
  const of = (type: AttachableDocument, id: string) =>
    load()
      .filter((a) => a.documentType === type && a.documentId === id)
      .map(({ documentType: _t, documentId: _d, data: _x, ...a }) => a);
  return {
    list: (type, id) =>
      wait(() => {
        guard(type, 'view');
        return of(type, id);
      }),
    add: (type, id, file) =>
      wait(() => {
        guard(type, 'manage');
        const bytes = bytesOf(file.data);
        if (!bytes.length || bytes.length > ATTACHMENT_MAX_BYTES) throw new ApiError('validation', 400, undefined, undefined, { reason: 'too_large' });
        if (sniffAttachmentType(bytes) !== file.type) throw new ApiError('validation', 400, undefined, undefined, { reason: 'type_mismatch' });
        if (of(type, id).length >= MAX_ATTACHMENTS_PER_DOCUMENT) throw new ApiError('conflict', 409, undefined, undefined, { reason: 'too_many' });
        save([...load(), { id: crypto.randomUUID(), documentType: type, documentId: id, fileName: file.fileName, contentType: file.type, size: bytes.length, createdAt: new Date().toISOString(), data: file.data }]);
        return of(type, id);
      }),
    file: (type, id, attachmentId) =>
      wait(() => {
        guard(type, 'view');
        const a = load().find((x) => x.documentType === type && x.documentId === id && x.id === attachmentId);
        if (!a) throw new ApiError('not_found', 404);
        return { blob: new Blob([bytesOf(a.data)], { type: a.contentType }), filename: a.fileName };
      }),
    remove: (type, id, attachmentId) =>
      wait(() => {
        guard(type, 'manage');
        save(load().filter((x) => !(x.documentType === type && x.documentId === id && x.id === attachmentId)));
      }),
  };
}
