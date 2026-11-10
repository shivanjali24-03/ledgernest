import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import { FileJson } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { saveBlob } from '../lib/saveBlob';
import type { EinvoiceBatch } from '../invoices/types';
import { useInvoicesApi } from '../invoices/useInvoicesApi';
import Button from '../ui/Button';
import Modal from '../ui/Modal';
import { useToast } from '../ui/toastContext';

/** Every B2B invoice in the dates as one e-invoice JSON file for the portal's bulk upload, and which need fixing */
export default function EinvoiceBatchButton({ from, to }: { from: string; to: string }) {
  const { t } = useTranslation();
  const toast = useToast();
  const api = useInvoicesApi();
  const [skipped, setSkipped] = useState<EinvoiceBatch['skipped'] | null>(null);
  const run = useMutation({
    mutationFn: () => api!.einvoices(from, to),
    onSuccess: (b) => {
      if (b.invoices.length) saveBlob({ blob: new Blob([JSON.stringify(b.invoices, null, 2)], { type: 'application/json' }), filename: `e-invoices-${from}-${to}.json` });
      toast(b.invoices.length ? t('invoices.einvoice.batchDone', { count: b.invoices.length }) : t('invoices.einvoice.batchNone'), b.invoices.length ? undefined : 'error');
      if (b.skipped.length) setSkipped(b.skipped);
    },
    onError: () => toast(t('invoices.einvoice.batchFailed'), 'error'),
  });
  if (!api) return null;
  return (
    <>
      <Button variant="secondary" icon={<FileJson className="size-4" />} loading={run.isPending} disabled={from > to} onClick={() => run.mutate()}>
        {t('invoices.einvoice.batch')}
      </Button>
      {skipped && (
        <Modal open onClose={() => setSkipped(null)} title={t('invoices.einvoice.skippedTitle', { count: skipped.length })} description={t('invoices.einvoice.skippedBody')} footer={<Button variant="secondary" onClick={() => setSkipped(null)}>{t('common.close')}</Button>}>
          <ul className="divide-y divide-ink-100 text-sm dark:divide-ink-800">
            {skipped.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 py-2">
                <Link to={`/invoices/${s.id}`} className="font-mono hover:underline" dir="ltr">
                  {s.number}
                </Link>
                <span className="text-xs text-ink-500">{t('invoices.einvoice.problemCount', { count: s.problems.length })}</span>
              </li>
            ))}
          </ul>
        </Modal>
      )}
    </>
  );
}
