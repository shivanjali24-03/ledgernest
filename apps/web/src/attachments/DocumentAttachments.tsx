import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Eye, Paperclip, X } from 'lucide-react';
import { ATTACHMENT_MAX_BYTES, ATTACHMENT_PERMISSIONS, ATTACHMENT_TYPES, sniffAttachmentType, type AttachableDocument, type AttachmentType } from '@ledgernest/shared';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../auth/client';
import { useSession } from '../layout/session';
import Button from '../ui/Button';
import { Card } from '../ui/Kit';
import Modal from '../ui/Modal';
import { useToast } from '../ui/toastContext';
import type { Attachment } from './types';
import { useAttachmentsApi } from './useAttachmentsApi';

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * The paper behind a document: receipts, PDFs and photos kept with it. Lists them, previews and downloads them,
 * and lets people who can change the document add (PDF or image, up to 2 MB, checked by its bytes) or remove them.
 */
export default function DocumentAttachments({ documentType, documentId, bare = false }: { documentType: AttachableDocument; documentId: string; bare?: boolean }) {
  const { t } = useTranslation();
  const toast = useToast();
  const session = useSession();
  const qc = useQueryClient();
  const api = useAttachmentsApi();
  const input = useRef<HTMLInputElement>(null);
  const [previewing, setPreviewing] = useState<{ a: Attachment; url: string } | null>(null);
  const perms = ATTACHMENT_PERMISSIONS[documentType];
  const canView = session.permissions.has(perms.view);
  const canManage = session.permissions.has(perms.manage);
  const key = ['attachments', session.organizationId, session.role ?? session.customRoleName, documentType, documentId];
  const list = useQuery({ queryKey: key, queryFn: () => api!.list(documentType, documentId), enabled: !!api && canView });
  const message = (e: unknown) => {
    const reason = e instanceof ApiError ? e.details?.reason : undefined;
    if (typeof reason === 'string' && ['too_large', 'type_mismatch', 'too_many'].includes(reason)) return t(`attachments.errors.${reason}`);
    return e instanceof Error && !(e instanceof ApiError) ? e.message : t('attachments.errors.generic');
  };
  const add = useMutation({
    mutationFn: async (file: File) => {
      if (!(ATTACHMENT_TYPES as readonly string[]).includes(file.type)) throw new Error(t('attachments.errors.wrongType'));
      if (file.size > ATTACHMENT_MAX_BYTES) throw new Error(t('attachments.errors.too_large'));
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (sniffAttachmentType(bytes) !== file.type) throw new Error(t('attachments.errors.type_mismatch'));
      let binary = '';
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return api!.add(documentType, documentId, { fileName: file.name, type: file.type as AttachmentType, data: btoa(binary) });
    },
    onSuccess: (rows) => {
      qc.setQueryData(key, rows);
      toast(t('attachments.added'));
    },
    onError: (e) => toast(message(e), 'error'),
  });
  const remove = useMutation({
    mutationFn: (a: Attachment) => api!.remove(documentType, documentId, a.id),
    onSuccess: (_r, a) => {
      void qc.invalidateQueries({ queryKey: key });
      toast(t('attachments.removed', { name: a.fileName }));
    },
    onError: (e) => toast(message(e), 'error'),
  });
  const preview = async (a: Attachment) => {
    try {
      const f = await api!.file(documentType, documentId, a.id, true);
      setPreviewing({ a, url: URL.createObjectURL(f.blob) });
    } catch (e) {
      toast(message(e), 'error');
    }
  };
  useEffect(
    () => () => {
      if (previewing) URL.revokeObjectURL(previewing.url);
    },
    [previewing],
  );
  if (!api || !canView) return null;
  const rows = list.data ?? [];
  const body = (
    <>
      <div className="flex items-center gap-2">
        <h2 className="flex-1 font-semibold">{t('attachments.title')}</h2>
        {canManage && (
          <>
            <input ref={input} type="file" accept={ATTACHMENT_TYPES.join(',')} className="sr-only" tabIndex={-1} aria-hidden data-testid="attachment-input" onChange={(e) => e.target.files?.[0] && add.mutate(e.target.files[0], { onSettled: () => (e.target.value = '') })} />
            <Button size="sm" variant="secondary" icon={<Paperclip className="size-4" />} loading={add.isPending} onClick={() => input.current?.click()}>
              {t('attachments.add')}
            </Button>
          </>
        )}
      </div>
      <p className="mt-1 text-xs text-ink-500">{t('attachments.hint')}</p>
      {rows.length > 0 ? (
        <ul className="mt-3 divide-y divide-ink-100 rounded-xl border border-ink-100 dark:divide-ink-800 dark:border-ink-800">
          {rows.map((a) => (
            <li key={a.id} className="flex items-center gap-2 px-3 py-2 text-sm">
              <Paperclip className="size-4 text-ink-400" aria-hidden />
              <span className="min-w-0 flex-1 truncate" dir="auto">
                {a.fileName}
              </span>
              <span className="text-xs text-ink-400">{Math.max(1, Math.ceil(a.size / 1024))} KB</span>
              <Button size="sm" variant="ghost" aria-label={t('attachments.preview', { name: a.fileName })} icon={<Eye className="size-4" />} onClick={() => void preview(a)} />
              <Button
                size="sm"
                variant="ghost"
                aria-label={t('attachments.download', { name: a.fileName })}
                icon={<Download className="size-4" />}
                onClick={async () => {
                  try {
                    const f = await api.file(documentType, documentId, a.id);
                    saveBlob(f.blob, f.filename);
                  } catch (e) {
                    toast(message(e), 'error');
                  }
                }}
              />
              {canManage && <Button size="sm" variant="ghost" aria-label={t('attachments.remove', { name: a.fileName })} icon={<X className="size-4" />} onClick={() => remove.mutate(a)} />}
            </li>
          ))}
        </ul>
      ) : (
        !list.isPending && <p className="mt-3 text-sm text-ink-500">{t('attachments.none')}</p>
      )}
      {previewing && (
        <Modal open size="lg" onClose={() => setPreviewing(null)} title={previewing.a.fileName}>
          {previewing.a.contentType === 'application/pdf' ? <iframe src={previewing.url} title={previewing.a.fileName} className="h-[70dvh] w-full rounded-lg border border-ink-100 dark:border-ink-800" /> : <img src={previewing.url} alt={previewing.a.fileName} className="mx-auto max-h-[70dvh] rounded-lg" />}
        </Modal>
      )}
    </>
  );
  return bare ? <div>{body}</div> : <Card className="p-5 print:hidden">{body}</Card>;
}
