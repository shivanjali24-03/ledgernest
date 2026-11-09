import { useContext, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { DatabaseBackup, Download, FileUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ApiClientContext } from '../auth/apiClientContext';
import { ApiError } from '../auth/client';
import { useIntlLocale } from '../i18n';
import { formatDate } from '../lib/format';
import Button from '../ui/Button';
import { TextField } from '../ui/Field';
import { Card } from '../ui/Kit';
import Modal from '../ui/Modal';
import { useToast } from '../ui/toastContext';
import type { BackupSummary } from './types';
import { useBackupsApi } from './useBackupsApi';

/** An organisation's books, out as one file and back in: for Owners, at the foot of Settings. */
export default function BackupsCard() {
  const { t } = useTranslation();
  const locale = useIntlLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const api = useBackupsApi();
  const demo = !useContext(ApiClientContext);
  const input = useRef<HTMLInputElement>(null);
  const [chosen, setChosen] = useState<{ json: unknown; summary: BackupSummary } | null>(null);
  const [name, setName] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const download = useMutation({
    mutationFn: () => api!.download(),
    onSuccess: ({ blob, filename }) => {
      const url = URL.createObjectURL(blob);
      Object.assign(document.createElement('a'), { href: url, download: filename }).click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast(t('backups.downloaded'));
    },
    onError: () => toast(t('backups.failed'), 'error'),
  });
  const restore = useMutation({
    mutationFn: () => api!.restore(chosen!.json, name.trim() || undefined),
    onSuccess: (r) => {
      setChosen(null);
      if (demo) {
        void qc.invalidateQueries();
        toast(t('backups.restoredDemo'));
      } else setDone(r.name);
    },
    onError: (e) => {
      const problems = e instanceof ApiError && Array.isArray(e.details?.problems) ? (e.details.problems as string[]) : [];
      toast(problems.length ? t('backups.invalidWith', { first: problems[0] }) : e instanceof ApiError && e.status === 413 ? t('backups.tooBig') : t('backups.failed'), 'error');
    },
  });
  const pick = async (f: File) => {
    try {
      const json = JSON.parse(await f.text()) as unknown;
      const summary = api!.describe(json);
      if (!summary) return toast(t('backups.notBackup'), 'error');
      setName(demo ? '' : `${summary.name} (${t('backups.restoredSuffix')})`);
      setChosen({ json, summary });
    } catch {
      toast(t('backups.notBackup'), 'error');
    }
  };
  if (!api) return null;
  return (
    <Card className="p-5">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-ink-100 text-ink-600 dark:bg-ink-800 dark:text-ink-300" aria-hidden>
          <DatabaseBackup className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <h2 className="font-semibold">{t('backups.title')}</h2>
          <p className="text-sm text-ink-500">{t(demo ? 'backups.bodyDemo' : 'backups.body')}</p>
        </span>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="secondary" icon={<Download className="size-4" />} loading={download.isPending} onClick={() => download.mutate()}>
          {t('backups.download')}
        </Button>
        <input ref={input} type="file" accept="application/json,.json" className="sr-only" tabIndex={-1} aria-hidden data-testid="backup-file" onChange={(e) => e.target.files?.[0] && void pick(e.target.files[0]).finally(() => (e.target.value = ''))} />
        <Button variant="ghost" icon={<FileUp className="size-4" />} onClick={() => input.current?.click()}>
          {t('backups.restore')}
        </Button>
      </div>
      {done && <p className="mt-3 text-sm text-income">{t('backups.restored', { name: done })}</p>}
      {chosen && (
        <Modal
          open
          onClose={() => setChosen(null)}
          title={t('backups.restoreTitle')}
          description={t(demo ? 'backups.restoreBodyDemo' : 'backups.restoreBody')}
          footer={
            <>
              <Button variant="ghost" onClick={() => setChosen(null)}>
                {t('common.cancel')}
              </Button>
              <Button variant={demo ? 'danger' : 'primary'} loading={restore.isPending} disabled={!demo && name.trim().length < 2} onClick={() => restore.mutate()}>
                {t(demo ? 'backups.replaceDemo' : 'backups.restoreAsNew')}
              </Button>
            </>
          }
        >
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-ink-500">{t('backups.from')}</dt>
            <dd dir="auto">{chosen.summary.name}</dd>
            <dt className="text-ink-500">{t('backups.made')}</dt>
            <dd>{chosen.summary.exportedAt ? formatDate(chosen.summary.exportedAt, locale) : '—'}</dd>
            <dt className="text-ink-500">{t('backups.holds')}</dt>
            <dd>{t('backups.counts', { rows: chosen.summary.rows, tables: chosen.summary.tables })}</dd>
          </dl>
          {!demo && (
            <div className="mt-4">
              <TextField label={t('backups.newName')} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} dir="auto" />
            </div>
          )}
        </Modal>
      )}
    </Card>
  );
}
