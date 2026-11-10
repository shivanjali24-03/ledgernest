import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { reminderPolicySchema, type ReminderPolicy } from '@ledgernest/shared';
import { BellRing } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSession } from '../layout/session';
import { apiErrorMessage } from '../platform/errors';
import Button from '../ui/Button';
import { TextField } from '../ui/Field';
import { Card, SkeletonRows } from '../ui/Kit';
import { useToast } from '../ui/toastContext';
import { useInvoicesApi } from './useInvoicesApi';

/** Automatic payment reminders for overdue invoices: on or off, when the first goes, how often, how many. In Settings. */
export default function ReminderPolicyCard() {
  const { t } = useTranslation();
  const session = useSession();
  const toast = useToast();
  const qc = useQueryClient();
  const api = useInvoicesApi();
  const canManage = session.permissions.has('invoices.manage');
  const key = ['reminder-policy', session.organizationId] as const;
  const query = useQuery({ queryKey: key, queryFn: () => api!.reminderPolicy(), enabled: !!api });
  const save = useMutation({
    mutationFn: (p: ReminderPolicy) => api!.setReminderPolicy(p),
    onSuccess: (p) => {
      qc.setQueryData(key, p);
      toast(t(p.enabled ? 'invoices.reminderPolicy.savedOn' : 'invoices.reminderPolicy.savedOff'));
    },
    onError: (e) => toast(apiErrorMessage(e, t), 'error'),
  });
  if (!api) return null;
  return (
    <Card className="p-5">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300">
          <BellRing className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">{t('invoices.reminderPolicy.title')}</h2>
          <p className="mt-1 text-sm text-ink-500">{t(session.mode === 'demo' ? 'invoices.reminderPolicy.bodyDemo' : 'invoices.reminderPolicy.body')}</p>
        </div>
      </div>
      {!query.data ? (
        <SkeletonRows rows={2} />
      ) : (
        <PolicyForm initial={query.data} canManage={canManage} saving={save.isPending} onSave={(p) => save.mutate(p)} />
      )}
    </Card>
  );
}

function PolicyForm({ initial, canManage, saving, onSave }: { initial: ReminderPolicy; canManage: boolean; saving: boolean; onSave: (p: ReminderPolicy) => void }) {
  const { t } = useTranslation();
  const [form, setForm] = useState({ enabled: initial.enabled, firstAfterDays: String(initial.firstAfterDays), repeatEveryDays: String(initial.repeatEveryDays), maxReminders: String(initial.maxReminders) });
  const parsed = reminderPolicySchema.safeParse({ enabled: form.enabled, firstAfterDays: Number(form.firstAfterDays), repeatEveryDays: Number(form.repeatEveryDays), maxReminders: Number(form.maxReminders) });
  const problem = (field: keyof ReminderPolicy) => (!parsed.success && parsed.error.issues.some((i) => i.path[0] === field) ? t(`invoices.reminderPolicy.bad.${field}`) : undefined);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (parsed.success) onSave(parsed.data);
  };
  return (
        <form onSubmit={submit} noValidate className="mt-4 space-y-4">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={form.enabled} disabled={!canManage} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} className="size-4 rounded accent-brand-600" />
            {t('invoices.reminderPolicy.enabled')}
          </label>
          <div className="grid gap-3 sm:grid-cols-3">
            <TextField label={t('invoices.reminderPolicy.firstAfterDays')} type="number" inputMode="numeric" min={0} max={90} value={form.firstAfterDays} disabled={!canManage || !form.enabled} onChange={(e) => setForm({ ...form, firstAfterDays: e.target.value })} error={problem('firstAfterDays')} />
            <TextField label={t('invoices.reminderPolicy.repeatEveryDays')} type="number" inputMode="numeric" min={1} max={90} value={form.repeatEveryDays} disabled={!canManage || !form.enabled} onChange={(e) => setForm({ ...form, repeatEveryDays: e.target.value })} error={problem('repeatEveryDays')} />
            <TextField label={t('invoices.reminderPolicy.maxReminders')} type="number" inputMode="numeric" min={1} max={10} value={form.maxReminders} disabled={!canManage || !form.enabled} onChange={(e) => setForm({ ...form, maxReminders: e.target.value })} error={problem('maxReminders')} />
          </div>
          <p className="text-xs text-ink-500">{t('invoices.reminderPolicy.hint')}</p>
          {canManage && (
            <Button type="submit" loading={saving} disabled={!parsed.success}>
              {t('invoices.reminderPolicy.save')}
            </Button>
          )}
        </form>
  );
}
