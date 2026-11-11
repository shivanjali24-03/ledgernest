import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Hash } from 'lucide-react';
import { DOC_NUMBER_MAX, formatDocNumber, NUMBERED_DOCUMENTS, seriesPreview, type NumberSeries, type NumberedDocument } from '@ledgernest/shared';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../auth/client';
import { useSession } from '../layout/session';
import { apiErrorMessage } from '../platform/errors';
import Button from '../ui/Button';
import { SelectField, TextField } from '../ui/Field';
import { Card, Pill } from '../ui/Kit';
import Modal from '../ui/Modal';
import { useToast } from '../ui/toastContext';
import type { NumberingApi } from './types';
import { useNumberingApi } from './useNumberingApi';

type Form = { type: NumberedDocument; name: string; prefix: string; suffix: string; digits: string; startNumber: string; resetYearly: boolean; isDefault: boolean };

/** Add or change a series, with the numbers it would give shown as you type */
function SeriesDialog({ api, series, type, yearName, onClose }: { api: NumberingApi; series?: NumberSeries; type: NumberedDocument; yearName: string; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [v, setV] = useState<Form>(() => ({ type: series?.type ?? type, name: series?.name ?? '', prefix: series?.prefix ?? '', suffix: series?.suffix ?? '', digits: String(series?.digits ?? 4), startNumber: String(series?.startNumber ?? 1), resetYearly: series?.resetYearly ?? true, isDefault: series?.isDefault ?? false }));
  const [errors, setErrors] = useState<Partial<Record<keyof Form, string>>>({});
  const set = (patch: Partial<Form>) => setV((x) => ({ ...x, ...patch }));
  const digits = Math.min(8, Math.max(1, Number(v.digits) || 1));
  const start = Math.max(1, Number(v.startNumber) || 1);
  const fmt = { prefix: v.prefix.trim(), suffix: v.suffix.trim(), digits };
  const first = seriesPreview({ ...fmt, startNumber: start }, yearName);
  const longest = formatDocNumber(fmt, yearName, Math.max(10 ** digits - 1, start));
  const tooLong = longest.length > DOC_NUMBER_MAX;
  const save = useMutation({
    mutationFn: () => {
      const body = { name: v.name, prefix: v.prefix, suffix: v.suffix, digits, startNumber: start, resetYearly: v.resetYearly, isDefault: v.isDefault };
      return series ? api.update(series.id, body) : api.create({ type: v.type, ...body });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['numberSeries'] });
      toast(t('numbering.saved'));
      onClose();
    },
    onError: (e) => {
      const reason = e instanceof ApiError ? String(e.details?.reason ?? '') : '';
      if (['name_taken', 'too_long', 'no_room'].includes(reason)) setErrors({ [reason === 'name_taken' ? 'name' : reason === 'too_long' ? 'prefix' : 'startNumber']: t(`numbering.errors.${reason}`) });
      else if (reason === 'default_needed') toast(t('numbering.errors.default_needed'), 'error');
      else if (e instanceof ApiError && e.status === 400) setErrors({ prefix: t('numbering.errors.characters') });
      else toast(apiErrorMessage(e, t), 'error');
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={series ? t('numbering.editTitle', { name: series.name }) : t('numbering.addTitle')}
      description={series && series.used > 0 ? t('numbering.keptHint') : undefined}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={save.isPending} disabled={!v.name.trim() || tooLong} onClick={() => save.mutate()}>
            {t('numbering.save')}
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {!series && <SelectField label={t('numbering.type')} value={v.type} onChange={(e) => set({ type: e.target.value as NumberedDocument })} options={NUMBERED_DOCUMENTS.map((d) => ({ value: d, label: t(`numbering.types.${d}`) }))} />}
        <TextField label={t('numbering.name')} value={v.name} onChange={(e) => set({ name: e.target.value })} error={errors.name} placeholder={t('numbering.namePlaceholder')} dir="auto" />
        <TextField label={t('numbering.prefix')} value={v.prefix} onChange={(e) => set({ prefix: e.target.value })} error={errors.prefix} hint={t('numbering.tokens')} dir="ltr" />
        <TextField label={t('numbering.suffix')} value={v.suffix} onChange={(e) => set({ suffix: e.target.value })} dir="ltr" />
        <TextField label={t('numbering.digits')} type="number" min={1} max={8} value={v.digits} onChange={(e) => set({ digits: e.target.value })} dir="ltr" />
        <TextField label={t('numbering.startNumber')} type="number" min={1} value={v.startNumber} onChange={(e) => set({ startNumber: e.target.value })} error={errors.startNumber} dir="ltr" />
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" checked={v.resetYearly} onChange={(e) => set({ resetYearly: e.target.checked })} className="size-4 rounded accent-brand-600" />
          {t('numbering.resetYearly')}
        </label>
        {!series?.isDefault && (
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" checked={v.isDefault} onChange={(e) => set({ isDefault: e.target.checked })} className="size-4 rounded accent-brand-600" />
            {t('numbering.makeDefault')}
          </label>
        )}
      </div>
      <p className="mt-4 rounded-xl bg-ink-50 px-4 py-3 text-sm dark:bg-ink-900" aria-live="polite">
        {t('numbering.preview')}{' '}
        <span className="font-mono font-semibold" dir="ltr">
          {first}
        </span>
        {tooLong && <span className="mt-1 block text-expense">{t('numbering.errors.too_long')}</span>}
      </p>
    </Modal>
  );
}

/** Settings: how invoices, credit notes and debit notes are numbered, with more than one series per type if wanted */
export default function NumberSeriesCard() {
  const { t } = useTranslation();
  const toast = useToast();
  const api = useNumberingApi();
  const session = useSession();
  const queryClient = useQueryClient();
  const canManage = session.permissions.has('org.settings.manage');
  const list = useQuery({ queryKey: ['numberSeries', session.organizationId], queryFn: () => api!.list(), enabled: !!api });
  const [editing, setEditing] = useState<{ series?: NumberSeries; type: NumberedDocument } | null>(null);
  const change = useMutation({
    mutationFn: ({ s, patch }: { s: NumberSeries; patch: { archived?: boolean; isDefault?: boolean } }) => api!.update(s.id, patch),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['numberSeries'] }),
    onError: (e) => toast(e instanceof ApiError && e.details?.reason === 'default_needed' ? t('numbering.errors.default_needed') : apiErrorMessage(e, t), 'error'),
  });
  const remove = useMutation({
    mutationFn: (s: NumberSeries) => api!.remove(s.id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['numberSeries'] }),
    onError: (e) => toast(e instanceof ApiError && e.details?.reason ? t(`numbering.errors.${String(e.details.reason)}`, { defaultValue: apiErrorMessage(e, t) }) : apiErrorMessage(e, t), 'error'),
  });
  if (!api || !list.data) return null;
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-semibold">
            <Hash className="size-5 text-brand-600" aria-hidden /> {t('numbering.title')}
          </h2>
          <p className="mt-1 text-sm text-ink-500">{t('numbering.body')}</p>
        </div>
        {canManage && (
          <Button variant="secondary" size="sm" onClick={() => setEditing({ type: 'invoice' })}>
            {t('numbering.add')}
          </Button>
        )}
      </div>
      {NUMBERED_DOCUMENTS.map((type) => {
        const rows = list.data.items.filter((s) => s.type === type);
        return (
          <section key={type} className="mt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-400">{t(`numbering.types.${type}`)}</h3>
            <ul className="mt-1 divide-y divide-ink-100 dark:divide-ink-800">
              {rows.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                  <span className={s.archived ? 'text-ink-400 line-through' : 'font-medium'}>{s.name}</span>
                  <span className="font-mono text-ink-600 dark:text-ink-300" dir="ltr">
                    {s.preview}
                  </span>
                  {s.isDefault && <Pill tone="brand">{t('numbering.default')}</Pill>}
                  {s.used > 0 && <span className="text-xs text-ink-400">{t('numbering.used', { count: s.used })}</span>}
                  {canManage && (
                    <span className="ms-auto flex gap-1">
                      <Button variant="ghost" size="sm" onClick={() => setEditing({ series: s, type })}>
                        {t('numbering.edit')}
                      </Button>
                      {!s.isDefault && !s.archived && (
                        <Button variant="ghost" size="sm" onClick={() => change.mutate({ s, patch: { isDefault: true } })}>
                          {t('numbering.makeDefaultShort')}
                        </Button>
                      )}
                      {!s.isDefault && s.used > 0 && (
                        <Button variant="ghost" size="sm" onClick={() => change.mutate({ s, patch: { archived: !s.archived } })}>
                          {s.archived ? t('numbering.restore') : t('numbering.archive')}
                        </Button>
                      )}
                      {!s.isDefault && s.used === 0 && (
                        <Button variant="ghost" size="sm" onClick={() => remove.mutate(s)}>
                          {t('numbering.delete')}
                        </Button>
                      )}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      {editing && <SeriesDialog api={api} series={editing.series} type={editing.type} yearName={list.data.yearName} onClose={() => setEditing(null)} />}
    </Card>
  );
}
