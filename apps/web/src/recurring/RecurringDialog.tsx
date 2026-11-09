import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RECURRING_FREQUENCIES, todayIn, type RecurringFrequency } from '@ledgernest/shared';
import { useTranslation } from 'react-i18next';
import { useInvoicesApi } from '../invoices/useInvoicesApi';
import { useSession } from '../layout/session';
import { useOrganizationSettings } from '../settings/useOrganizationSettings';
import Button from '../ui/Button';
import { SelectField, TextField } from '../ui/Field';
import Modal from '../ui/Modal';
import { useToast } from '../ui/toastContext';
import { recurringErrorMessage } from './errors';
import { templateOf, type RecurringTemplate } from './templateOf';
import type { RecurringApi, RecurringSchedule } from './types';

/**
 * A schedule: how often, from when, until when, and whether to issue. Its invoice comes from a template:
 * the invoice it was started from, an invoice chosen here, or (when editing) what it already has.
 */
export default function RecurringDialog({ api, schedule, template: given, onClose, onSaved }: { api: RecurringApi; schedule?: RecurringSchedule; template?: RecurringTemplate; onClose: () => void; onSaved: (s: RecurringSchedule) => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const session = useSession();
  const settings = useOrganizationSettings().data;
  const invoicesApi = useInvoicesApi();
  const [invoiceId, setInvoiceId] = useState('');
  const pickable = useQuery({ queryKey: ['invoices', session.organizationId, session.role ?? session.customRoleName, 'templates'], queryFn: () => invoicesApi!.list({ page: 1, pageSize: 100 }), enabled: !!invoicesApi && !schedule && !given });
  const chosen = useQuery({ queryKey: ['invoices', session.organizationId, 'one', invoiceId], queryFn: () => invoicesApi!.get(invoiceId), enabled: !!invoicesApi && !!invoiceId });
  const template: RecurringTemplate | null = schedule ? { contact: schedule.contact, reference: schedule.reference, notes: schedule.notes, placeOfSupply: schedule.placeOfSupply, lines: schedule.lines as RecurringTemplate['lines'] } : (given ?? (chosen.data ? templateOf(chosen.data) : null));

  const today = todayIn(settings?.timeZone ?? 'Asia/Kolkata');
  const [typedName, setName] = useState(schedule?.name ?? '');
  // Until a name is typed, the customer and the first line
  const name = typedName || (template ? `${template.contact.name} · ${template.lines[0]?.description ?? ''}`.slice(0, 120) : '');
  const [frequency, setFrequency] = useState<RecurringFrequency>(schedule?.frequency ?? 'monthly');
  const [interval, setEvery] = useState(String(schedule?.interval ?? 1));
  const [startDate, setStartDate] = useState(schedule?.startDate ?? today);
  const [ends, setEnds] = useState<'never' | 'date' | 'count'>(schedule?.endDate ? 'date' : schedule?.maxCount ? 'count' : 'never');
  const [endDate, setEndDate] = useState(schedule?.endDate ?? '');
  const [maxCount, setMaxCount] = useState(schedule?.maxCount ? String(schedule.maxCount) : '12');
  const [autoIssue, setAutoIssue] = useState(schedule?.autoIssue ?? false);
  const every = Number(interval);
  const problem = !template ? 'template' : !name.trim() ? 'name' : !Number.isInteger(every) || every < 1 || every > 12 ? 'interval' : ends === 'date' && (!endDate || endDate < startDate) ? 'endDate' : ends === 'count' && !(Number(maxCount) >= 1) ? 'count' : null;

  const save = useMutation({
    mutationFn: () => {
      const input = {
        name: name.trim(),
        contactId: template!.contact.id,
        frequency,
        interval: every,
        startDate,
        endDate: ends === 'date' ? endDate : null,
        maxCount: ends === 'count' ? Number(maxCount) : null,
        autoIssue,
        reference: template!.reference,
        notes: template!.notes,
        placeOfSupply: template!.placeOfSupply,
        lines: template!.lines,
      };
      return schedule ? api.update(schedule.id, input) : api.create(input);
    },
    onSuccess: (s) => {
      void queryClient.invalidateQueries({ queryKey: ['recurring'] });
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
      title={t(schedule ? 'recurring.editTitle' : 'recurring.newTitle')}
      description={template ? t('recurring.templateFrom', { name: template.contact.name, count: template.lines.length }) : t('recurring.pickTemplate')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="recurring-form" loading={save.isPending} disabled={!!problem}>
            {t(schedule ? 'common.save' : 'recurring.create')}
          </Button>
        </>
      }
    >
      <form id="recurring-form" onSubmit={submit} noValidate className="grid gap-3 sm:grid-cols-2">
        {!schedule && !given && (
          <div className="sm:col-span-2">
            <SelectField label={t('recurring.fields.template')} value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)} options={[{ value: '', label: t('recurring.chooseInvoice') }, ...(pickable.data?.items ?? []).filter((i) => i.status !== 'void').map((i) => ({ value: i.id, label: `${i.number ?? t('invoices.draft')} · ${i.contact.name}` }))]} />
          </div>
        )}
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
          <input type="checkbox" checked={autoIssue} onChange={(e) => setAutoIssue(e.target.checked)} className="mt-0.5 size-4 rounded accent-brand-600" />
          <span>
            <span className="font-medium">{t('recurring.fields.autoIssue')}</span>
            <span className="block text-ink-500">{t('recurring.autoIssueHint')}</span>
          </span>
        </label>
      </form>
    </Modal>
  );
}
