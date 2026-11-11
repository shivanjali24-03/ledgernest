import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { motion } from 'motion/react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { currencyDigits, toMinor, todayIn } from '@ledgernest/shared';
import { ArrowLeft, Check, CheckCircle2, EyeOff, HandCoins, Link2, Plus, Undo2 } from 'lucide-react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { useAccountsApi } from '../../accounts/useAccountsApi';
import { useIntlLocale } from '../../i18n';
import { formatDate } from '../../lib/format';
import { useSession } from '../../layout/session';
import { fadeUp, stagger } from '../../motion/tokens';
import { useOrganizationSettings } from '../../settings/useOrganizationSettings';
import { useTaxesApi } from '../../taxes/useTaxesApi';
import Button from '../../ui/Button';
import ConfirmDialog from '../../ui/ConfirmDialog';
import { inputClass, TextField } from '../../ui/Field';
import { Card, EmptyState, ErrorState, PageHeader, Pill, SkeletonRows } from '../../ui/Kit';
import { useToast } from '../../ui/toastContext';
import { bankingErrorMessage } from '../errors';
import type { BookLine, Reconciliation } from '../types';
import { useBankingApi } from '../useBankingApi';

/**
 * Reconciling an account: the bank's lines on one side and the books' on the other. Match what agrees (suggested
 * where it's clear), record what the books are missing, set aside what doesn't belong, then agree the balance.
 */
export default function Reconcile() {
  const { t } = useTranslation();
  const { accountId = '' } = useParams();
  const locale = useIntlLocale();
  const session = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();
  const settings = useOrganizationSettings().data;
  const api = useBankingApi();
  const accountsApi = useAccountsApi();
  const taxesApi = useTaxesApi();
  const role = session.role ?? session.customRoleName;
  const canReconcile = session.permissions.has('banking.reconcile');
  const canCreate = session.permissions.has('banking.manage');
  // Recording a customer's receipt from a line needs both banking and payments
  const canReceive = canCreate && session.permissions.has('payments.manage');
  const [date, setDate] = useState(() => todayIn(settings?.timeZone ?? 'Asia/Kolkata'));
  const [typedBalance, setBalance] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState<{ lineId: string; accountId: string; taxGroupId: string } | null>(null);
  const [undoing, setUndoing] = useState<Reconciliation | null>(null);
  const key = ['banking', session.organizationId, role, 'reconcile', accountId] as const;
  const ws = useQuery({ queryKey: [...key, date], queryFn: () => api!.reconcileWorkspace(accountId, date), enabled: !!api && !!accountId, placeholderData: keepPreviousData });
  const history = useQuery({ queryKey: [...key, 'history'], queryFn: () => api!.reconciliations(accountId), enabled: !!api && !!accountId });
  const accounts = useQuery({ queryKey: ['accounts', session.organizationId, role, 'all'], queryFn: () => accountsApi!.list(true), enabled: !!accountsApi && canCreate });
  const taxes = useQuery({ queryKey: ['taxes', session.organizationId, role], queryFn: () => taxesApi!.list(), enabled: !!taxesApi && canCreate });
  const refresh = () => {
    setSelected(null);
    setPicked(new Set());
    setCreating(null);
    void queryClient.invalidateQueries({ queryKey: ['banking'] });
    void queryClient.invalidateQueries({ queryKey: ['journals'] });
  };
  const run = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: refresh,
    onError: (e) => toast(bankingErrorMessage(e, t), 'error'),
  });

  const data = ws.data;
  const currency = data?.account.currency ?? settings?.baseCurrency ?? 'INR';
  const digits = currencyDigits(currency);
  const plain = (minor: number) => new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(minor / 10 ** digits);
  const day = (d: string) => formatDate(`${d}T00:00:00Z`, locale);
  const balanceText = typedBalance ?? (data?.summary.statementBalance !== null && data?.summary.statementBalance !== undefined ? plain(data.summary.statementBalance) : '');
  const statementBalance = balanceText.trim() ? toMinor(balanceText, digits) : null;
  const difference = data && statementBalance !== null ? statementBalance - data.summary.cleared : null;
  const ready = !!data && difference === 0 && data.summary.unmatchedToDate === 0;
  const reconcile = useMutation({
    mutationFn: () => api!.reconcile({ bankAccountId: accountId, statementDate: date, statementBalance: statementBalance! }),
    onSuccess: (r) => {
      refresh();
      toast(t('banking.rec.done', { date: day(r.statementDate) }));
    },
    onError: (e) => toast(bankingErrorMessage(e, t), 'error'),
  });

  if (!api) return null;
  const bankLine = data?.bankLines.find((l) => l.id === selected);
  const pickedTotal = (data?.bookLines ?? []).filter((b) => picked.has(b.id)).reduce((s, b) => s + b.amount, 0);
  const book = (b: BookLine) => (
    <>
      <span className="block truncate" dir="auto">
        {b.memo ?? b.description}
      </span>
      <span className="block text-xs text-ink-500">
        {day(b.date)} ·{' '}
        <Link to={`/journals/${b.entryId}`} className="font-mono hover:underline" dir="ltr">
          {b.number}
        </Link>
        {b.reference && ` · ${b.reference}`}
      </span>
    </>
  );
  const targets = (accounts.data ?? []).filter((a) => !a.archived && a.childCount === 0 && !['bank', 'cash', 'accounts_receivable', 'accounts_payable'].includes(a.subtype));
  const amountCell = (minor: number) => (
    <span className={clsx('font-mono tabular-nums', minor > 0 && 'text-income')} dir="ltr">
      {plain(minor)}
    </span>
  );

  return (
    <motion.div variants={stagger(0.06)} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={fadeUp}>
        <Link to={`/banking?account=${accountId}`} className="mb-2 inline-flex items-center gap-1 text-sm text-ink-500 hover:text-ink-800 dark:hover:text-ink-200">
          <ArrowLeft className="size-4 rtl:-scale-x-100" aria-hidden /> {t('banking.title')}
        </Link>
        <PageHeader title={data ? t('banking.rec.title', { name: data.account.name }) : t('banking.rec.titlePlain')} description={t('banking.rec.description')} />
      </motion.div>

      {ws.isPending ? (
        <Card>
          <SkeletonRows rows={6} />
        </Card>
      ) : ws.isError ? (
        <Card>
          <ErrorState onRetry={() => void ws.refetch()} />
        </Card>
      ) : (
        <>
          <motion.div variants={fadeUp}>
            <Card className="grid gap-6 p-5 lg:grid-cols-[18rem_minmax(0,1fr)]">
              <div className="space-y-3">
                <TextField label={t('banking.rec.statementDate')} type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
                <TextField label={t('banking.rec.statementBalance', { currency })} value={balanceText} onChange={(e) => setBalance(e.target.value)} inputMode="decimal" dir="ltr" className="text-end font-mono" hint={data!.summary.statementBalance !== null && typedBalance === null ? t('banking.rec.fromStatement') : undefined} />
                {data!.lastReconciliation && <p className="text-xs text-ink-500">{t('banking.rec.lastDone', { date: day(data!.lastReconciliation.statementDate) })}</p>}
              </div>
              <dl className="grid grid-cols-[1fr_auto] content-start gap-x-6 gap-y-1.5 text-sm" aria-label={t('banking.rec.where')}>
                <dt className="text-ink-500">{t('banking.rec.bookBalance', { date: day(date) })}</dt>
                <dd className="text-end font-mono tabular-nums" dir="ltr">
                  {plain(data!.summary.bookBalance)}
                </dd>
                <dt className="text-ink-500">{t('banking.rec.inTransit')}</dt>
                <dd className="text-end font-mono tabular-nums" dir="ltr">
                  {data!.summary.outstandingIn ? '−' : ''}{plain(data!.summary.outstandingIn)}
                </dd>
                <dt className="text-ink-500">{t('banking.rec.unpresented')}</dt>
                <dd className="text-end font-mono tabular-nums" dir="ltr">
                  {data!.summary.outstandingOut ? '+' : ''}{plain(data!.summary.outstandingOut)}
                </dd>
                <dt className="border-t border-ink-200 pt-1.5 font-semibold dark:border-ink-700">{t('banking.rec.cleared')}</dt>
                <dd className="border-t border-ink-200 pt-1.5 text-end font-mono font-semibold tabular-nums dark:border-ink-700" dir="ltr">
                  {plain(data!.summary.cleared)}
                </dd>
                <dt className="text-ink-500">{t('banking.rec.difference')}</dt>
                <dd className={clsx('text-end font-mono font-semibold tabular-nums', difference ? 'text-expense' : 'text-income')} dir="ltr" role="status">
                  {difference === null ? '—' : plain(difference)}
                </dd>
                <dd className="col-span-2 mt-2 flex flex-wrap items-center gap-3">
                  {data!.summary.unmatchedToDate > 0 ? <span className="text-sm text-ink-600 dark:text-ink-300">{t('banking.rec.stillToDo', { count: data!.summary.unmatchedToDate })}</span> : difference === 0 ? <span className="flex items-center gap-1.5 text-sm text-income"><CheckCircle2 className="size-4" aria-hidden /> {t('banking.rec.agrees')}</span> : null}
                  <span className="flex-1" />
                  {canReconcile && (
                    <Button icon={<Check className="size-4" />} disabled={!ready} loading={reconcile.isPending} onClick={() => reconcile.mutate()}>
                      {t('banking.rec.reconcile')}
                    </Button>
                  )}
                </dd>
              </dl>
            </Card>
          </motion.div>

          <motion.div variants={fadeUp} className="grid gap-6 xl:grid-cols-2">
            <Card className="overflow-hidden">
              <h2 className="border-b border-ink-100 p-4 font-semibold dark:border-ink-800">{t('banking.rec.bankSide', { count: data!.bankLines.length })}</h2>
              {!data!.bankLines.length ? (
                <EmptyState icon={<CheckCircle2 className="size-5" />} title={t('banking.rec.bankDone')} body={data!.summary.since ? undefined : t('banking.rec.importFirst')} />
              ) : (
                <ul className="divide-y divide-ink-100 dark:divide-ink-800">
                  {data!.bankLines.map((l) => {
                    const s = data!.suggestions.find((x) => x.statementLineId === l.id);
                    const suggested = s ? data!.bookLines.filter((b) => s.journalLineIds.includes(b.id)) : [];
                    const hint = data!.hints?.find((h) => h.statementLineId === l.id);
                    const receipt = !s ? data!.receipts?.find((r) => r.statementLineId === l.id) : undefined;
                    const isSel = selected === l.id;
                    return (
                      <li key={l.id} className={clsx('space-y-2 p-4', isSel && 'bg-brand-50/60 dark:bg-brand-950/30')}>
                        <div className="flex items-start gap-3">
                          {canReconcile && <input type="radio" name="bank-line" checked={isSel} onChange={() => (setSelected(l.id), setPicked(new Set()))} aria-label={t('banking.rec.chooseLine', { description: l.description })} className="mt-1 size-4 accent-brand-600" />}
                          <span className="min-w-0 flex-1">
                            <span className="block truncate" dir="auto">
                              {l.description}
                            </span>
                            <span className="block text-xs text-ink-500">
                              {day(l.date)}
                              {l.reference && ` · ${l.reference}`}
                            </span>
                          </span>
                          {amountCell(l.amount)}
                        </div>
                        {suggested.length > 0 && (
                          <div className="ms-7 flex items-center gap-3 rounded-lg border border-brand-200 bg-white p-2 text-sm dark:border-brand-900 dark:bg-ink-900">
                            <Pill tone="brand">{t(`banking.rec.confidence.${s!.confidence}`)}</Pill>
                            <span className="min-w-0 flex-1">{book(suggested[0]!)}</span>
                            {canReconcile && (
                              <Button size="sm" icon={<Link2 className="size-4" />} onClick={() => run.mutate(() => api.match(l.id, s!.journalLineIds))}>
                                {t('banking.rec.match')}
                              </Button>
                            )}
                          </div>
                        )}
                        {receipt && (
                          <div className="ms-7 flex flex-wrap items-center gap-3 rounded-lg border border-income/40 bg-white p-2 text-sm dark:bg-ink-900" data-testid="line-receipt">
                            <Pill tone="brand">{t(`banking.rec.confidence.${receipt.confidence}`)}</Pill>
                            <span className="min-w-0 flex-1">
                              {t('banking.rec.paysInvoice', { number: receipt.invoiceNumber, name: receipt.contact.name, balance: plain(receipt.balance) })}
                            </span>
                            {canReceive && (
                              <Button
                                size="sm"
                                icon={<HandCoins className="size-4" />}
                                disabled={run.isPending}
                                onClick={() =>
                                  run.mutate(async () => {
                                    const p = await api.receiveFromLine(l.id, receipt.invoiceId);
                                    toast(t('banking.rec.received', { number: p.number, invoice: receipt.invoiceNumber }));
                                    for (const k of ['invoices', 'payments', 'contacts', 'journals', 'reports']) void queryClient.invalidateQueries({ queryKey: [k] });
                                  })
                                }
                              >
                                {t('banking.rec.recordReceipt')}
                              </Button>
                            )}
                          </div>
                        )}
                        {hint && !suggested.length && (
                          <p className="ms-7 text-xs text-ink-500" data-testid="line-hint">
                            {t('banking.rec.lastTime', { account: `${hint.account.code} · ${hint.account.name}` })}
                          </p>
                        )}
                        {(canReconcile || canCreate) && (
                          <div className="ms-7 flex flex-wrap gap-2">
                            {canCreate && (
                              <Button size="sm" variant="ghost" icon={<Plus className="size-4" />} onClick={() => setCreating({ lineId: l.id, accountId: hint?.accountId ?? '', taxGroupId: (!data!.account.currency && hint?.taxGroupId) || '' })}>
                                {t('banking.rec.create')}
                              </Button>
                            )}
                            {canReconcile && (
                              <Button size="sm" variant="ghost" icon={<EyeOff className="size-4" />} onClick={() => run.mutate(() => api.ignore(l.id, true))}>
                                {t('banking.rec.setAside')}
                              </Button>
                            )}
                          </div>
                        )}
                        {creating?.lineId === l.id && (
                          <div className="ms-7 grid gap-2 rounded-lg border border-ink-200 p-3 sm:grid-cols-[1fr_10rem_auto] dark:border-ink-700">
                            <select aria-label={t('banking.rec.createAccount')} value={creating.accountId} onChange={(e) => setCreating({ ...creating, accountId: e.target.value })} className={clsx(inputClass, 'h-9')}>
                              <option value="">{t('bills.chooseAccount')}</option>
                              {targets.map((a) => (
                                <option key={a.id} value={a.id}>
                                  {a.code} · {a.name}
                                </option>
                              ))}
                            </select>
                            <select aria-label={t('banking.rec.createTax')} value={creating.taxGroupId} disabled={!!data!.account.currency} onChange={(e) => setCreating({ ...creating, taxGroupId: e.target.value })} className={clsx(inputClass, 'h-9')}>
                              <option value="">{t('journals.tax.none')}</option>
                              {(taxes.data?.groups ?? [])
                                .filter((g) => !g.archived)
                                .map((g) => (
                                  <option key={g.id} value={g.id}>
                                    {g.name}
                                  </option>
                                ))}
                            </select>
                            <Button size="sm" disabled={!creating.accountId} loading={run.isPending} onClick={() => run.mutate(() => api.createFromLine({ statementLineId: l.id, accountId: creating.accountId, taxGroupId: creating.taxGroupId || null, description: null }))}>
                              {t('banking.rec.createAndMatch')}
                            </Button>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>

            <Card className="overflow-hidden">
              <div className="flex items-center gap-3 border-b border-ink-100 p-4 dark:border-ink-800">
                <h2 className="flex-1 font-semibold">{t('banking.rec.bookSide', { count: data!.bookLines.length })}</h2>
                {bankLine && (
                  <Button size="sm" icon={<Link2 className="size-4" />} disabled={!picked.size || pickedTotal !== bankLine.amount} onClick={() => run.mutate(() => api.match(bankLine.id, [...picked]))}>
                    {t('banking.rec.matchPicked', { picked: plain(pickedTotal), wanted: plain(bankLine.amount) })}
                  </Button>
                )}
              </div>
              {!bankLine && canReconcile && data!.bankLines.length > 0 && <p className="border-b border-ink-100 px-4 py-2 text-xs text-ink-500 dark:border-ink-800">{t('banking.rec.pickHint')}</p>}
              <ul className="divide-y divide-ink-100 dark:divide-ink-800">
                {data!.bookLines.map((b) => (
                  <li key={b.id} className="flex items-start gap-3 p-4 text-sm">
                    {bankLine && (
                      <input
                        type="checkbox"
                        checked={picked.has(b.id)}
                        onChange={(e) => setPicked((p) => (e.target.checked ? new Set([...p, b.id]) : new Set([...p].filter((x) => x !== b.id))))}
                        aria-label={t('banking.rec.pickBook', { what: b.memo ?? b.description ?? b.number ?? '' })}
                        className="mt-1 size-4 accent-brand-600"
                      />
                    )}
                    <span className="min-w-0 flex-1">{book(b)}</span>
                    {amountCell(b.amount)}
                  </li>
                ))}
              </ul>
            </Card>
          </motion.div>

          <motion.div variants={fadeUp} className="grid gap-6 xl:grid-cols-3">
            <Card className="p-5 xl:col-span-2">
              <h2 className="font-semibold">{t('banking.rec.matched')}</h2>
              {!data!.matched.length ? (
                <p className="mt-2 text-sm text-ink-500">{t('banking.rec.noneMatched')}</p>
              ) : (
                <ul className="mt-3 divide-y divide-ink-100 text-sm dark:divide-ink-800">
                  {data!.matched.map((m) => (
                    <li key={m.id} className="flex items-start gap-3 py-2">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate" dir="auto">
                          {m.description}
                        </span>
                        <span className="block text-xs text-ink-500">
                          {day(m.date)} → {m.bookLines.map((b) => b.number).join(', ')}
                        </span>
                      </span>
                      {amountCell(m.amount)}
                      {canReconcile && (
                        <Button size="sm" variant="ghost" onClick={() => run.mutate(() => api.unmatch(m.id))}>
                          {t('banking.rec.unmatch')}
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {data!.ignored.length > 0 && (
                <>
                  <h3 className="mt-5 text-sm font-semibold">{t('banking.rec.setAsideList')}</h3>
                  <ul className="mt-2 divide-y divide-ink-100 text-sm dark:divide-ink-800">
                    {data!.ignored.map((m) => (
                      <li key={m.id} className="flex items-center gap-3 py-2">
                        <span className="min-w-0 flex-1 truncate" dir="auto">
                          {day(m.date)} · {m.description}
                        </span>
                        {amountCell(m.amount)}
                        {canReconcile && (
                          <Button size="sm" variant="ghost" onClick={() => run.mutate(() => api.ignore(m.id, false))}>
                            {t('banking.rec.bringBack')}
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </Card>
            <Card className="self-start p-5">
              <h2 className="font-semibold">{t('banking.rec.history')}</h2>
              {history.data && !history.data.length ? (
                <p className="mt-2 text-sm text-ink-500">{t('banking.rec.noHistory')}</p>
              ) : (
                <ul className="mt-3 divide-y divide-ink-100 text-sm dark:divide-ink-800">
                  {(history.data ?? []).map((r, n) => (
                    <li key={r.id} className="flex items-center gap-3 py-2">
                      <span className="min-w-0 flex-1">
                        <span className="block">{day(r.statementDate)}</span>
                        <span className="block text-xs text-ink-500">{t('banking.rec.historyLine', { balance: plain(r.statementBalance), matches: r.matches })}</span>
                      </span>
                      {canReconcile && n === 0 && (
                        <Button size="sm" variant="ghost" icon={<Undo2 className="size-4" />} onClick={() => setUndoing(r)}>
                          {t('banking.rec.undo')}
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </motion.div>
        </>
      )}
      <ConfirmDialog
        open={!!undoing}
        title={undoing ? t('banking.rec.undoTitle', { date: day(undoing.statementDate) }) : ''}
        body={t('banking.rec.undoBody')}
        confirmLabel={t('banking.rec.undo')}
        tone="danger"
        busy={run.isPending}
        onConfirm={() => undoing && run.mutate(async () => (await api.undoReconciliation(undoing.id), setUndoing(null)))}
        onClose={() => setUndoing(null)}
      />
    </motion.div>
  );
}
