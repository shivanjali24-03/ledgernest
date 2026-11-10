import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RECURRING_FREQUENCIES, todayIn, type RecurringFrequency } from '@ledgernest/shared';
import { useTranslation } from 'react-i18next';
import { useOrganizationSettings } from '../settings/useOrganizationSettings';
import Button from '../ui/Button';
import { SelectField, TextField } from '../ui/Field';
import Modal from '../ui/Modal';
import { useToast } from '../ui/toastContext';
import { recurringErrorMessage } from '../recurring/errors';
import type { RecurringBillSchedule, RecurringBillsApi, RecurringBillTemplate } from './types';

/** A schedule of bills: how often, from when, until when, and whether to record them. Its bill comes from the bill it was started from, or what it already has. */
export default function RecurringBillDialog({ api, schedule, template: given, onClose, onSaved }: { api: RecurringBillsApi; schedule?: RecurringBillSchedule; template?: RecurringBillTemplate; onClose: () => void; onSaved: (s: RecurringBillSchedule) => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const settings = useOrganizationSettings().data;
  const template: RecurringBillTemplate | null = schedule ? { contact: schedule.contact, notes: schedule.notes, placeOfSupply: schedule.placeOfSupply, lines: schedule.lines as RecurringBillTemplate['lines'] } : (given ?? null);
  const today = todayIn(settings?.timeZone ?? 'Asia/Kolkata');
  const [typedName, setName] = useState(schedule?.name ?? '');
  // Until a name is typed, the vendor and the first line
  const name = typedName || (template ? `${template.contact.name} · ${template.lines[0]?.description ?? ''}`.slice(0, 120) : '');
  const [frequency, setFrequency] = useState<RecurringFrequency>(schedule?.frequency ?? 'monthly');
  const [interval, setEvery] = useState(String(schedule?.interval ?? 1));
  const [startDate, setStartDate] = useState(schedule?.startDate ?? today);
  const [ends, setEnds] = useState<'never' | 'date' | 'count'>(schedule?.endDate ? 'date' : schedule?.maxCount ? 'count' : 'never');
  const [endDate, setEndDate] = useState(schedule?.endDate ?? '');
  const [maxCount, setMaxCount] = useState(schedule?.maxCount ? String(schedule.maxCount) : '12');
  const [autoRecord, setAutoRecord] = useState(schedule?.autoRecord ?? false);
  const every = Number(interval);
  const problem = !template ? 'template' : !name.trim() ? 'name' : !Number.isInteger(every) || every < 1 || every > 12 ? 'interval' : ends === 'date' && (!endDate || endDate < startDate) ? 'endDate' : ends === 'count' && !(Number(maxCount) >= 1) ? 'count' : null;
  const save = useMutation({
    mutationFn: () => {
      const input = { name: name.trim(), contactId: template!.contact.id, frequency, interval: every, startDate, endDate: ends === 'date' ? endDate : null, maxCount: ends === 'count' ? Number(maxCount) : null, autoRecord, notes: template!.notes, placeOfSupply: template!.placeOfSupply, lines: template!.lines };
      return schedule ? api.update(schedule.id, input) : api.create(input);
    },
    onSuccess: (s) => {
      void queryClient.invalidateQueries({ queryKey: ['recurring-bills'] });
      toast(t(schedule ? 'recurring.saved' : 'recurring.created', { name: s.name }));
      onSaved(s);
    },
    onError: (e) => toast(recurringErrorMessage(e, t), 'error'),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (problem) return toast(t(`recurring.problems.${problem}`), 'error');
    save.mutate();
  };
  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title={t(schedule ? 'recurringBills.editTitle' : 'recurringBills.newTitle')}
      description={template ? t('recurringBills.templateFrom', { name: template.contact.name, count: template.lines.length }) : undefined}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="recurring-bill-form" loading={save.isPending} disabled={!!problem}>
            {t(schedule ? 'common.save' : 'recurring.create')}
          </Button>
        </>
      }
    >
      <form id="recurring-bill-form" onSubmit={submit} noValidate className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <TextField label={t('recurring.fields.name')} value={name} onChange={(e) => setName(e.target.value)} dir="auto" data-autofocus />
        </div>
        <SelectField label={t('recurring.fields.frequency')} value={frequency} onChange={(e) => setFrequency(e.target.value as RecurringFrequency)} options={RECURRING_FREQUENCIES.map((f) => ({ value: f, label: t(`recurring.frequencies.${f}`) }))} />
        <TextField label={t('recurring.fields.interval')} value={interval} onChange={(e) => setEvery(e.target.value)} inputMode="numeric" dir="ltr" hint={t(`recurring.intervalHint.${frequency}`, { n: every || 1 })} />
        <TextField label={t('recurring.fields.startDate')} type="date" value={startDate} disabled={!!schedule && schedule.count > 0} onChange={(e) => setStartDate(e.target.value)} />
        <SelectField label={t('recurring.fields.ends')} value={ends} onChange={(e) => setEnds(e.target.value as typeof ends)} options={(['never', 'date', 'count'] as const).map((v) => ({ value: v, label: t(`recurring.ends.${v}`) }))} />
        {ends === 'date' && <TextField label={t('recurring.fields.endDate')} type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} />}
        {ends === 'count' && <TextField label={t('recurring.fields.maxCount')} value={maxCount} onChange={(e) => setMaxCount(e.target.value)} inputMode="numeric" dir="ltr" />}
        <label className="flex items-start gap-2 text-sm sm:col-span-2">
          <input type="checkbox" checked={autoRecord} onChange={(e) => setAutoRecord(e.target.checked)} className="mt-0.5 size-4 rounded accent-brand-600" />
          <span>
            <span className="font-medium">{t('recurringBills.autoRecord')}</span>
            <span className="block text-ink-500">{t('recurringBills.autoRecordHint')}</span>
          </span>
        </label>
      </form>
    </Modal>
  );
}
