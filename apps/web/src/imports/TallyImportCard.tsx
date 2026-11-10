import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, FileUp } from 'lucide-react';
import { fiscalYearOf, fiscalYearSpan, parseTallyXml, todayIn, tallyImportPlan, type ImportKind, type TallyImportPlan } from '@ledgernest/shared';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useAccountsApi } from '../accounts/useAccountsApi';
import { useMoney } from '../lib/useMoney';
import { useOrganizationSettings } from '../settings/useOrganizationSettings';
import Button from '../ui/Button';
import { TextField } from '../ui/Field';
import { Card } from '../ui/Kit';
import { useToast } from '../ui/toastContext';
import type { ImportResult, ImportsApi } from './types';
import { readTallyFile } from './readTallyFile';


type Failure = { step: ImportKind; result: ImportResult };

/**
 * Moving from Tally in one go: the "List of Accounts" exported as XML becomes accounts, customers and vendors (with
 * GSTIN and address) and a draft entry of opening balances, each checked like any other import.
 */
export default function TallyImportCard({ api }: { api: ImportsApi }) {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const money = useMoney();
  const accountsApi = useAccountsApi();
  const settings = useOrganizationSettings().data;
  const input = useRef<HTMLInputElement>(null);
  const [plan, setPlan] = useState<{ name: string; plan: TallyImportPlan } | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [done, setDone] = useState<{ journalEntryId: string | null } | null>(null);
  // Opening balances are usually on the first day of this financial year
  const [date, setDate] = useState(() => {
    const today = todayIn(settings?.timeZone ?? 'Asia/Kolkata');
    const month = settings?.fiscalYearStartMonth ?? 4;
    return fiscalYearSpan(fiscalYearOf(today, month), month).periods[0]!.startDate;
  });

  const load = async (f: File) => {
    setFailure(null);
    setDone(null);
    try {
      const masters = parseTallyXml(await readTallyFile(f));
      if (!masters.ledgers.length) return toast(t('imports.tally.noLedgers'), 'error');
      const existing = (await accountsApi!.list(true)).map((a) => ({ code: a.code, name: a.name, type: a.type, subtype: a.subtype }));
      setPlan({ name: f.name, plan: tallyImportPlan(masters, existing) });
    } catch {
      toast(t('imports.unreadable'), 'error');
    }
  };
  const run = useMutation({
    mutationFn: async () => {
      const p = plan!.plan;
      const steps: [ImportKind, Record<string, string>[]][] = [
        ['accounts', p.accounts],
        ['contacts', p.contacts],
        ['opening_balances', p.openings],
      ];
      // Check what can be checked before anything is saved (opening balances need their accounts first)
      for (const [step, rows] of steps.slice(0, 2)) {
        if (!rows.length) continue;
        const result = await api.preview(step, rows);
        if (result.results.some((r) => !r.ok)) return { failure: { step, result } };
      }
      let journalEntryId: string | null = null;
      for (const [step, rows] of steps) {
        if (!rows.length) continue;
        const result = await api.run(step, rows, step === 'opening_balances' ? date : undefined);
        if (!result.saved) return { failure: { step, result } };
        if (result.journalEntry) journalEntryId = result.journalEntry.id;
      }
      return { journalEntryId };
    },
    onSuccess: (r) => {
      for (const k of ['accounts', 'contacts', 'journals']) void qc.invalidateQueries({ queryKey: [k] });
      if ('failure' in r && r.failure) {
        setFailure(r.failure);
        toast(t('imports.tally.stopped'), 'error');
      } else {
        setDone({ journalEntryId: 'journalEntryId' in r ? (r.journalEntryId ?? null) : null });
        setPlan(null);
        toast(t('imports.tally.done'));
      }
    },
    onError: () => toast(t('imports.failed'), 'error'),
  });
  const p = plan?.plan;
  return (
    <Card className="space-y-4 p-5">
      <div>
        <h2 className="font-semibold">{t('imports.tally.title')}</h2>
        <p className="mt-1 text-sm text-ink-500">{t('imports.tally.body')}</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <input ref={input} type="file" accept=".xml,text/xml,application/xml" className="hidden" data-testid="tally-file" onChange={(e) => e.target.files?.[0] && void load(e.target.files[0])} />
        <Button variant="secondary" icon={<FileUp className="size-4" />} onClick={() => input.current?.click()} disabled={!accountsApi}>
          {t('imports.tally.choose')}
        </Button>
        {plan && <span className="text-sm text-ink-500">{plan.name}</span>}
      </div>
      {p && (
        <div className="space-y-3 rounded-xl bg-ink-50 p-4 text-sm dark:bg-ink-900">
          <ul className="space-y-1" aria-label={t('imports.tally.planLabel')}>
            <li>{t('imports.tally.accounts', { count: p.accounts.length })}{p.matched.length ? ` · ${t('imports.tally.matched', { count: p.matched.length })}` : ''}</li>
            <li>{t('imports.tally.parties', { customers: p.totals.customers, vendors: p.totals.vendors })}</li>
            <li>{t('imports.tally.openings', { debit: money.format(p.totals.debit), credit: money.format(p.totals.credit) })}</li>
            {p.skipped.length > 0 && <li className="text-ink-500">{t('imports.tally.skipped', { names: p.skipped.map((s) => s.name).join(', ') })}</li>}
          </ul>
          <p className="text-xs text-ink-500">{t('imports.tally.partyNote')}</p>
          {p.openings.length > 0 && (
            <div className="w-48">
              <TextField label={t('imports.tally.date')} type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
            </div>
          )}
          <Button loading={run.isPending} onClick={() => run.mutate()}>
            {t('imports.tally.import')}
          </Button>
        </div>
      )}
      {failure && (
        <div role="alert" className="rounded-xl border border-expense/40 p-3 text-sm">
          <p className="font-medium text-expense">{t('imports.tally.failedStep', { step: t(`imports.kinds.${failure.step}`) })}</p>
          <ul className="mt-1 list-disc ps-5 text-ink-600 dark:text-ink-300">
            {failure.result.results
              .filter((r) => !r.ok)
              .slice(0, 5)
              .map((r) => (
                <li key={r.row}>{t('imports.tally.rowError', { row: r.row, message: r.errors.map((e) => e.message).join(' ') })}</li>
              ))}
          </ul>
        </div>
      )}
      {done && (
        <p role="status" className="flex items-center gap-2 text-sm font-medium text-income">
          <CheckCircle2 className="size-4" aria-hidden /> {t('imports.tally.finished')}
          {done.journalEntryId && (
            <Link to={`/journals/${done.journalEntryId}`} className="text-brand-700 hover:underline dark:text-brand-300">
              {t('imports.tally.review')}
            </Link>
          )}
        </p>
      )}
    </Card>
  );
}
