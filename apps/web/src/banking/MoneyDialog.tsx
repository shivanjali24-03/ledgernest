import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { currencyDigits, splitTax, toMinor, todayIn } from '@ledgernest/shared';
import { Plus, X } from 'lucide-react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { useAccountsApi } from '../accounts/useAccountsApi';
import { useIntlLocale } from '../i18n';
import { useSession } from '../layout/session';
import { useOrganizationSettings } from '../settings/useOrganizationSettings';
import { useTaxesApi } from '../taxes/useTaxesApi';
import Button from '../ui/Button';
import { inputClass, SelectField, TextField } from '../ui/Field';
import Modal from '../ui/Modal';
import { useToast } from '../ui/toastContext';
import { bankingErrorMessage } from './errors';
import type { BankAccount, BankingApi } from './types';

type Line = { key: string; accountId: string; amount: string; taxGroupId: string; description: string };
const blank = (): Line => ({ key: crypto.randomUUID(), accountId: '', amount: '', taxGroupId: '', description: '' });

/** Spend or receive money that isn't an invoice or bill: what it was for, its tax, and from or into which account. */
export default function MoneyDialog({ api, kind, banks, bankAccountId: initial, onClose }: { api: BankingApi; kind: 'spend' | 'receive'; banks: BankAccount[]; bankAccountId?: string; onClose: () => void }) {
  const { t } = useTranslation();
  const locale = useIntlLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const session = useSession();
  const settings = useOrganizationSettings().data;
  const role = session.role ?? session.customRoleName;
  const accountsApi = useAccountsApi();
  const taxesApi = useTaxesApi();
  const accounts = useQuery({ queryKey: ['accounts', session.organizationId, role, 'all'], queryFn: () => accountsApi!.list(true), enabled: !!accountsApi });
  const taxes = useQuery({ queryKey: ['taxes', session.organizationId, role], queryFn: () => taxesApi!.list(), enabled: !!taxesApi });
  const usable = banks.filter((b) => !b.archived && !b.hasChildren);
  const [bankAccountId, setBank] = useState(initial ?? usable[0]?.id ?? '');
  const bank = usable.find((b) => b.id === bankAccountId);
  const code = bank?.currency ?? settings?.baseCurrency ?? 'INR';
  const digits = currencyDigits(code);
  const plain = (minor: number) => new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(minor / 10 ** digits);
  const [date, setDate] = useState(() => todayIn(settings?.timeZone ?? 'Asia/Kolkata'));
  const [description, setDescription] = useState('');
  const [reference, setReference] = useState('');
  const [taxInclusive, setInclusive] = useState(false);
  const [lines, setLines] = useState<Line[]>([blank()]);
  const set = (key: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  // Anything but bank and cash, customers and vendors (they have invoices and bills), and headings
  const bankCurrency = bank?.currency ?? null;
  const targets = (accounts.data ?? []).filter((a) => !a.archived && a.childCount === 0 && !['bank', 'cash', 'accounts_receivable', 'accounts_payable'].includes(a.subtype) && (!a.currency || a.currency === bankCurrency));
  const groups = (taxes.data?.groups ?? []).filter((g) => !g.archived);
  const parsed = lines.map((l) => {
    const minor = l.amount.trim() ? toMinor(l.amount, digits) : 0;
    const g = groups.find((x) => x.id === l.taxGroupId);
    const tax = g && minor ? splitTax(minor, taxInclusive, g.rates.map((r) => ({ rateId: r.id, ratePpm: r.ratePpm }))).taxes.reduce((s, x) => s + x.amount, 0) : 0;
    return { ...l, minor, tax, gross: minor === null ? 0 : taxInclusive ? minor : minor + tax };
  });
  const filled = parsed.filter((l) => l.accountId || l.minor);
  const total = filled.reduce((s, l) => s + l.gross, 0);
  const taxTotal = filled.reduce((s, l) => s + l.tax, 0);
  const problem = !bank ? 'bank' : !filled.length ? 'lines' : filled.some((l) => !l.accountId) ? 'account' : filled.some((l) => !l.minor) ? 'amount' : null;

  const save = useMutation({
    mutationFn: () => api.money({ kind, bankAccountId, date, description: description || null, reference: reference || null, taxInclusive, lines: filled.map((l) => ({ accountId: l.accountId, amount: l.minor!, taxGroupId: l.taxGroupId || null, description: l.description || null })) }),
    onSuccess: () => {
      for (const k of ['banking', 'journals', 'reports']) void queryClient.invalidateQueries({ queryKey: [k] });
      toast(t(kind === 'spend' ? 'banking.spent' : 'banking.received', { amount: `${code} ${plain(total)}` }));
      onClose();
    },
    onError: (e) => toast(bankingErrorMessage(e, t), 'error'),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (problem) return toast(t(`banking.problems.${problem}`), 'error');
    save.mutate();
  };
  const cell = clsx(inputClass, 'h-9 border-ink-200 dark:border-ink-700');

  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title={t(kind === 'spend' ? 'banking.spendTitle' : 'banking.receiveTitle')}
      description={t(kind === 'spend' ? 'banking.spendBody' : 'banking.receiveBody')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="money-form" loading={save.isPending} disabled={!!problem}>
            {t(kind === 'spend' ? 'banking.recordSpend' : 'banking.recordReceive')}
          </Button>
        </>
      }
    >
      <form id="money-form" onSubmit={submit} noValidate className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField label={t(kind === 'spend' ? 'banking.fields.from' : 'banking.fields.into')} value={bankAccountId} onChange={(e) => setBank(e.target.value)} options={usable.map((b) => ({ value: b.id, label: `${b.code} · ${b.name}${b.currency ? ` (${b.currency})` : ''}` }))} />
          <TextField label={t('banking.fields.date')} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <TextField label={t('banking.fields.description')} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t(kind === 'spend' ? 'banking.spendPlaceholder' : 'banking.receivePlaceholder')} dir="auto" data-autofocus />
          <TextField label={t('banking.fields.reference')} value={reference} onChange={(e) => setReference(e.target.value)} dir="auto" />
        </div>
        <table className="w-full text-sm">
          <thead className="text-xs uppercase tracking-wide text-ink-400">
            <tr>
              <th scope="col" className="py-1.5 text-start font-semibold">
                {t('banking.columns.account')}
              </th>
              <th scope="col" className="w-36 py-1.5 text-start font-semibold">
                {t('invoices.columns.tax')}
              </th>
              <th scope="col" className="w-32 py-1.5 text-end font-semibold">
                {t('banking.columns.amount', { currency: code })}
              </th>
              <th scope="col" className="w-9">
                <span className="sr-only">{t('journals.removeLine')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {parsed.map((l, n) => (
              <tr key={l.key}>
                <td className="py-1 pe-2">
                  <select aria-label={t('banking.lineAccount', { n: n + 1 })} value={l.accountId} onChange={(e) => set(l.key, { accountId: e.target.value })} className={cell}>
                    <option value="">{t('bills.chooseAccount')}</option>
                    {targets.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.code} · {a.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-1 pe-2">
                  <select aria-label={t('banking.lineTax', { n: n + 1 })} value={l.taxGroupId} onChange={(e) => set(l.key, { taxGroupId: e.target.value })} disabled={!!bankCurrency} className={cell}>
                    <option value="">{t('journals.tax.none')}</option>
                    {groups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-1">
                  <input aria-label={t('banking.lineAmount', { n: n + 1 })} value={l.amount} onChange={(e) => set(l.key, { amount: e.target.value })} onBlur={() => l.minor && set(l.key, { amount: plain(l.minor) })} inputMode="decimal" dir="ltr" className={clsx(cell, 'text-end font-mono', l.minor === null && 'border-expense')} />
                </td>
                <td className="py-1 ps-1">
                  {lines.length > 1 && (
                    <button type="button" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} aria-label={t('journals.removeLineN', { n: n + 1 })} className="grid size-9 place-items-center rounded-lg text-ink-400 hover:bg-ink-100 hover:text-expense dark:hover:bg-ink-800">
                      <X className="size-4" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex flex-wrap items-start gap-4">
          <Button type="button" size="sm" variant="ghost" icon={<Plus className="size-4" />} onClick={() => setLines((ls) => [...ls, blank()])}>
            {t('journals.addLine')}
          </Button>
          {!bankCurrency && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={taxInclusive} onChange={(e) => setInclusive(e.target.checked)} className="size-4 rounded accent-brand-600" />
              {t('banking.taxInclusive')}
            </label>
          )}
          <dl className="ms-auto grid min-w-56 grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-sm" role="status" aria-label={t('invoices.totals')}>
            <dt className="text-ink-500">{t('creditNotes.tax')}</dt>
            <dd className="text-end font-mono tabular-nums" dir="ltr">
              {plain(taxTotal)}
            </dd>
            <dt className="border-t border-ink-200 pt-1 font-semibold dark:border-ink-700">{t(kind === 'spend' ? 'banking.totalOut' : 'banking.totalIn')}</dt>
            <dd className="border-t border-ink-200 pt-1 text-end font-mono font-semibold tabular-nums dark:border-ink-700" dir="ltr">
              {code} {plain(total)}
            </dd>
          </dl>
        </div>
      </form>
    </Modal>
  );
}
