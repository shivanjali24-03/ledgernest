import { useState, type FormEvent } from 'react';
import { motion } from 'motion/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarX, Pencil, Percent, Plus, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import { gstSlabCreateSchema } from '@ledgernest/shared';
import { useTranslation } from 'react-i18next';
import { useIntlLocale } from '../../i18n';
import { fadeUp, stagger } from '../../motion/tokens';
import Button from '../../ui/Button';
import ConfirmDialog from '../../ui/ConfirmDialog';
import { TextField } from '../../ui/Field';
import { Card, EmptyState, ErrorState, PageHeader, Pill, SkeletonRows } from '../../ui/Kit';
import Modal from '../../ui/Modal';
import RowMenu from '../../ui/RowMenu';
import { useToast } from '../../ui/toastContext';
import { dayLabel, todayIso } from '../format';
import { taxErrorMessage } from '../errors';
import type { GstSlab, GstSlabsApi } from '../types';
import { useGstSlabsApi } from '../useTaxesApi';

const statusOf = (s: GstSlab, today: string) => (s.effectiveFrom > today ? 'upcoming' : s.effectiveTo !== null && s.effectiveTo < today ? 'retired' : 'inForce');

/**
 * The Super Admin's list of India's GST slabs, which every Indian organisation sets its GST up from.
 * A slab's rate never changes: when the GST Council changes rates, give the old slab an end date and add the new one.
 */
export default function GstSlabs() {
  const { t } = useTranslation();
  const locale = useIntlLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const api = useGstSlabsApi();
  const query = useQuery({ queryKey: ['gstSlabs'], queryFn: () => api.list() });
  const [editing, setEditing] = useState<GstSlab | 'new' | null>(null);
  const [deleting, setDeleting] = useState<GstSlab | null>(null);
  const [today] = useState(todayIso);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['gstSlabs'] });

  const remove = useMutation({
    mutationFn: (s: GstSlab) => api.remove(s.id),
    onSuccess: (_r, s) => {
      setDeleting(null);
      toast(t('gstSlabs.deleted', { rate: s.rate }));
      refresh();
    },
    onError: (e) => {
      setDeleting(null);
      toast(taxErrorMessage(e, t), 'error');
    },
  });

  return (
    <motion.div variants={stagger(0.06)} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={fadeUp}>
        <PageHeader
          eyebrow={t('platform.eyebrow')}
          title={t('gstSlabs.title')}
          description={t('gstSlabs.description')}
          actions={
            <Button icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
              {t('gstSlabs.add')}
            </Button>
          }
        />
      </motion.div>
      <motion.div variants={fadeUp}>
        <Card className="overflow-hidden">
          {query.isPending ? (
            <SkeletonRows rows={8} />
          ) : query.isError ? (
            <ErrorState onRetry={() => void query.refetch()} />
          ) : !query.data.length ? (
            <EmptyState icon={<Percent className="size-5" />} title={t('gstSlabs.empty')} />
          ) : (
            <ul className="divide-y divide-ink-100 dark:divide-ink-800">
              {query.data.map((s) => {
                const status = statusOf(s, today);
                return (
                  <li key={s.id} className={clsx('flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3', status === 'retired' && 'opacity-70')}>
                    <span className="w-16 shrink-0 text-lg font-semibold tabular-nums">{s.rate}</span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{s.label}</span>
                        <Pill tone={status === 'inForce' ? 'brand' : 'neutral'}>{t(`gstSlabs.status.${status}`)}</Pill>
                      </span>
                      {s.description && <span className="block text-sm text-ink-500">{s.description}</span>}
                      <span className="block text-xs text-ink-500">
                        {s.effectiveTo ? t('taxes.gst.appliedUntil', { from: dayLabel(s.effectiveFrom, locale), to: dayLabel(s.effectiveTo, locale) }) : t('taxes.gst.appliesFrom', { from: dayLabel(s.effectiveFrom, locale) })}
                        {' · '}
                        {t('gstSlabs.usage', { count: s.usage })}
                      </span>
                    </span>
                    <RowMenu
                      label={t('gstSlabs.actionsFor', { rate: s.rate })}
                      items={[
                        { key: 'edit', label: t('gstSlabs.edit'), icon: Pencil, onSelect: () => setEditing(s) },
                        ...(s.effectiveTo === null ? [{ key: 'retire', label: t('gstSlabs.retire'), icon: CalendarX, onSelect: () => setEditing({ ...s, effectiveTo: today }) }] : []),
                        { key: 'delete', label: t('gstSlabs.delete'), icon: Trash2, danger: true, disabled: s.usage > 0, onSelect: () => setDeleting(s) },
                      ]}
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </motion.div>
      {editing && (
        <SlabDialog
          slab={editing === 'new' ? undefined : editing}
          api={api}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refresh();
          }}
        />
      )}
      <ConfirmDialog
        open={!!deleting}
        title={deleting ? t('gstSlabs.deleteTitle', { rate: deleting.rate }) : ''}
        body={t('gstSlabs.deleteBody')}
        confirmLabel={t('gstSlabs.delete')}
        tone="danger"
        busy={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting)}
        onClose={() => setDeleting(null)}
      />
    </motion.div>
  );
}

function SlabDialog({ slab, api, onClose, onSaved }: { slab?: GstSlab; api: GstSlabsApi; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [rate, setRate] = useState(slab ? slab.rate.replace('%', '') : '');
  const [label, setLabel] = useState(slab?.label ?? '');
  const [description, setDescription] = useState(slab?.description ?? '');
  const [from, setFrom] = useState(() => slab?.effectiveFrom ?? todayIso());
  const [to, setTo] = useState(slab?.effectiveTo ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const save = useMutation({
    mutationFn: () =>
      slab
        ? api.update(slab.id, { label: label.trim(), description: description.trim() || null, effectiveFrom: from, effectiveTo: to || null })
        : api.create({ rate, label: label.trim(), description: description.trim() || null, effectiveFrom: from, effectiveTo: to || null }),
    onSuccess: (s) => {
      toast(slab ? t('gstSlabs.saved', { rate: s.rate }) : t('gstSlabs.created', { rate: s.rate }));
      onSaved();
    },
    onError: (e) => {
      const message = taxErrorMessage(e, t);
      if (message === t('taxes.errors.overlap')) setErrors({ effectiveFrom: message });
      else toast(message, 'error');
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const r = gstSlabCreateSchema.safeParse({ rate: slab ? '0' : rate, label, description, effectiveFrom: from, effectiveTo: to || null });
    if (!r.success) {
      const next: Record<string, string> = {};
      for (const issue of r.error.issues) {
        const f = String(issue.path[0]);
        next[f] = t(`gstSlabs.validation.${f}`, { defaultValue: t('settings.errors.invalid') });
      }
      setErrors(next);
      return;
    }
    setErrors({});
    save.mutate();
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={slab ? t('gstSlabs.editTitle', { rate: slab.rate }) : t('gstSlabs.newTitle')}
      description={slab ? t('gstSlabs.fixedRate') : t('gstSlabs.newBody')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="gst-slab-form" loading={save.isPending}>
            {slab ? t('common.save') : t('gstSlabs.add')}
          </Button>
        </>
      }
    >
      <form id="gst-slab-form" onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        <TextField label={t('gstSlabs.fields.rate')} value={rate} onChange={(e) => setRate(e.target.value)} disabled={!!slab} error={errors.rate} inputMode="decimal" dir="ltr" hint={t('gstSlabs.hints.rate')} data-autofocus={!slab || undefined} />
        <TextField label={t('gstSlabs.fields.label')} value={label} onChange={(e) => setLabel(e.target.value)} error={errors.label} data-autofocus={!!slab || undefined} />
        <div className="sm:col-span-2">
          <TextField label={t('gstSlabs.fields.description')} value={description} onChange={(e) => setDescription(e.target.value)} error={errors.description} hint={t('gstSlabs.hints.description')} />
        </div>
        <TextField type="date" label={t('gstSlabs.fields.effectiveFrom')} value={from} onChange={(e) => setFrom(e.target.value)} error={errors.effectiveFrom} />
        <TextField type="date" label={t('gstSlabs.fields.effectiveTo')} value={to} onChange={(e) => setTo(e.target.value)} error={errors.effectiveTo} hint={t('gstSlabs.hints.effectiveTo')} />
      </form>
    </Modal>
  );
}
