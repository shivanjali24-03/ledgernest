import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { motion } from 'motion/react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { todayIn } from '@ledgernest/shared';
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Ban, Banknote, Building2, FileUp, Landmark, Paperclip, Scale, Undo2, Wallet } from 'lucide-react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { useIntlLocale } from '../../i18n';
import { formatDate, formatMoney } from '../../lib/format';
import { useMoney } from '../../lib/useMoney';
import { useSession } from '../../layout/session';
import { fadeUp, stagger } from '../../motion/tokens';
import { useOrganizationSettings } from '../../settings/useOrganizationSettings';
import Button from '../../ui/Button';
import ConfirmDialog from '../../ui/ConfirmDialog';
import { TextField } from '../../ui/Field';
import { Card, EmptyState, ErrorState, PageHeader, Pill, SkeletonRows } from '../../ui/Kit';
import RowMenu from '../../ui/RowMenu';
import { useToast } from '../../ui/toastContext';
import ImportStatementDialog from '../ImportStatementDialog';
import MoneyDialog from '../MoneyDialog';
import TransferDialog from '../TransferDialog';
import { bankingErrorMessage } from '../errors';
import type { BankTransaction, StatementImport } from '../types';
import { useBankingApi } from '../useBankingApi';
import DocumentAttachments from '../../attachments/DocumentAttachments';
import Modal from '../../ui/Modal';

const daysAgo = (today: string, n: number) => new Date(Date.parse(`${today}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);

/** The money itself: every bank and cash account, what moved through it, and money in, out and between them. */
export default function Banking() {
  const { t } = useTranslation();
  const locale = useIntlLocale();
  const money = useMoney();
  const session = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();
  const settings = useOrganizationSettings().data;
  const api = useBankingApi();
  const canManage = session.permissions.has('banking.manage');
  const today = todayIn(settings?.timeZone ?? 'Asia/Kolkata');
  const [params, setParams] = useSearchParams();
  const [dialog, setDialog] = useState<'spend' | 'receive' | 'transfer' | 'import' | null>(null);
  const [undoing, setUndoing] = useState<StatementImport | null>(null);
  const [voiding, setVoiding] = useState<BankTransaction | null>(null);
  const [files, setFiles] = useState<BankTransaction | null>(null);
  const key = ['banking', session.organizationId, session.role ?? session.customRoleName] as const;
  const accounts = useQuery({ queryKey: [...key, 'accounts'], queryFn: () => api!.accounts(), enabled: !!api });
  const usable = (accounts.data ?? []).filter((a) => !a.hasChildren);
  const selectedId = params.get('account') ?? usable[0]?.id ?? '';
  const selected = accounts.data?.find((a) => a.id === selectedId);
  const from = params.get('from') ?? daysAgo(today, 30);
  const to = params.get('to') ?? today;
  const set = (patch: Record<string, string | null>) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        for (const [k, v] of Object.entries(patch)) if (v) n.set(k, v);
        else n.delete(k);
        return n;
      },
      { replace: true },
    );
  const activity = useQuery({ queryKey: [...key, 'activity', selectedId, from, to], queryFn: () => api!.activity(selectedId, from, to), enabled: !!api && !!selectedId && from <= to, placeholderData: keepPreviousData });
  const txs = useQuery({ queryKey: [...key, 'transactions', selectedId], queryFn: () => api!.transactions({ bankAccountId: selectedId, page: 1, pageSize: 20 }), enabled: !!api && !!selectedId });
  const bankLines = useQuery({ queryKey: [...key, 'statement-lines', selectedId], queryFn: () => api!.statementLines({ bankAccountId: selectedId, page: 1, pageSize: 20 }), enabled: !!api && !!selectedId });
  const imports = useQuery({ queryKey: [...key, 'imports', selectedId], queryFn: () => api!.statementImports(selectedId), enabled: !!api && !!selectedId });
  const undo = useMutation({
    mutationFn: (i: StatementImport) => api!.undoImport(i.id),
    onSuccess: (_r, i) => {
      setUndoing(null);
      void queryClient.invalidateQueries({ queryKey: ['banking'] });
      toast(t('banking.import.undone', { file: i.fileName }));
    },
    onError: (e) => {
      setUndoing(null);
      toast(bankingErrorMessage(e, t), 'error');
    },
  });
  const voidIt = useMutation({
    mutationFn: ({ tx, reason }: { tx: BankTransaction; reason?: string }) => api!.void(tx.id, reason),
    onSuccess: () => {
      setVoiding(null);
      for (const k of ['banking', 'journals', 'reports']) void queryClient.invalidateQueries({ queryKey: [k] });
      toast(t('banking.voided'));
    },
    onError: (e) => {
      setVoiding(null);
      toast(bankingErrorMessage(e, t), 'error');
    },
  });

  if (!api) {
    return (
      <Card>
        <EmptyState icon={<Building2 className="size-5" />} title={t('team.noOrganization')} body={t('team.noOrganizationBody')} />
      </Card>
    );
  }
  const day = (d: string) => formatDate(`${d}T00:00:00Z`, locale);
  const fx = activity.data?.foreign;
  const inForeign = (minor: number) => formatMoney(minor, fx!.currency, locale);
  const cell = (minor: number) => (minor ? (fx ? '' : money.plain(minor)) : '');
  const txAmount = (tx: BankTransaction) => (tx.currency ? formatMoney(tx.amount, tx.currency, locale) : money.format(tx.amount));
  const txLabel = (tx: BankTransaction) =>
    tx.kind === 'transfer' ? t('banking.kinds.transferBetween', { from: tx.bankAccount.name, to: tx.toAccount?.name ?? '' }) : (tx.description ?? t(`banking.kinds.${tx.kind}`));

  return (
    <motion.div variants={stagger(0.06)} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={fadeUp}>
        <PageHeader
          eyebrow={<span dir="auto">{session.organization}</span>}
          title={t('banking.title')}
          description={t('banking.description')}
          actions={
            canManage && usable.length ? (
              <>
                <Button variant="secondary" icon={<ArrowUpRight className="size-4" />} onClick={() => setDialog('spend')}>
                  {t('banking.spend')}
                </Button>
                <Button variant="secondary" icon={<ArrowDownLeft className="size-4" />} onClick={() => setDialog('receive')}>
                  {t('banking.receive')}
                </Button>
                {selected && (
                  <Button variant="secondary" icon={<FileUp className="size-4" />} onClick={() => setDialog('import')}>
                    {t('banking.import.button')}
                  </Button>
                )}
                {usable.length > 1 && (
                  <Button icon={<ArrowLeftRight className="size-4" />} onClick={() => setDialog('transfer')}>
                    {t('banking.transfer')}
                  </Button>
                )}
              </>
            ) : undefined
          }
        />
      </motion.div>

      <motion.div variants={fadeUp}>
        {accounts.isPending ? (
          <Card>
            <SkeletonRows rows={3} />
          </Card>
        ) : accounts.isError ? (
          <Card>
            <ErrorState onRetry={() => void accounts.refetch()} />
          </Card>
        ) : !usable.length ? (
          <Card>
            <EmptyState icon={<Landmark className="size-5" />} title={t('banking.empty')} body={t('banking.emptyBody')} />
          </Card>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label={t('banking.accounts')}>
            {usable.map((a) => (
              <li key={a.id}>
                <button type="button" onClick={() => set({ account: a.id })} aria-pressed={a.id === selectedId} className={clsx('w-full rounded-2xl border bg-white p-4 text-start shadow-sm transition hover:border-brand-300 dark:bg-ink-900', a.id === selectedId ? 'border-brand-500 ring-2 ring-brand-500/20' : 'border-ink-200 dark:border-ink-800')}>
                  <span className="flex items-center gap-2 text-sm text-ink-500">
                    {a.subtype === 'cash' ? <Wallet className="size-4" aria-hidden /> : <Banknote className="size-4" aria-hidden />}
                    <span className="font-mono">{a.code}</span>
                    {a.currency && <Pill>{a.currency}</Pill>}
                  </span>
                  <span className="mt-1 block font-medium" dir="auto">
                    {a.name}
                  </span>
                  <span className={clsx('mt-2 block font-mono text-xl font-semibold tabular-nums', a.balance < 0 && 'text-expense')} dir="ltr">
                    {a.currency && a.foreignBalance !== null ? formatMoney(a.foreignBalance, a.currency, locale) : money.format(a.balance)}
                  </span>
                  {a.currency && (
                    <span className="block text-xs text-ink-500" dir="ltr">
                      {money.format(a.balance)}
                    </span>
                  )}
                  <span className="mt-1 block text-xs text-ink-500">{a.lastActivity ? t('banking.lastMoved', { date: day(a.lastActivity), count: a.recentMovements }) : t('banking.noMovements')}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </motion.div>

      {selected && (
        <motion.div variants={fadeUp} className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-end gap-3 border-b border-ink-100 p-4 dark:border-ink-800">
              <h2 className="flex-1 font-semibold" dir="auto">
                {t('banking.statement', { name: selected.name })}
              </h2>
              <div className="w-40">
                <TextField label={t('reports.from')} type="date" value={from} onChange={(e) => e.target.value && set({ from: e.target.value })} />
              </div>
              <div className="w-40">
                <TextField label={t('reports.to')} type="date" value={to} min={from} onChange={(e) => e.target.value && set({ to: e.target.value })} />
              </div>
            </div>
            {activity.isPending ? (
              <SkeletonRows rows={5} />
            ) : activity.isError ? (
              <ErrorState onRetry={() => void activity.refetch()} />
            ) : (
              <div className="relative overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="text-xs uppercase tracking-wide text-ink-400">
                    <tr>
                      <th scope="col" className="px-4 py-2 text-start font-semibold">
                        {t('banking.columns.date')}
                      </th>
                      <th scope="col" className="px-4 py-2 text-start font-semibold">
                        {t('banking.columns.what')}
                      </th>
                      <th scope="col" className="px-4 py-2 text-end font-semibold">
                        {t('banking.columns.in')}
                      </th>
                      <th scope="col" className="px-4 py-2 text-end font-semibold">
                        {t('banking.columns.out')}
                      </th>
                      <th scope="col" className="px-4 py-2 text-end font-semibold">
                        {t('banking.columns.balance')}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
                    <tr className="text-ink-500">
                      <td className="px-4 py-2" colSpan={4}>
                        {t('banking.opening', { date: day(from) })}
                      </td>
                      <td className="px-4 py-2 text-end font-mono tabular-nums" dir="ltr">
                        {fx ? inForeign(fx.openingBalance) : money.plain(activity.data!.openingBalance)}
                      </td>
                    </tr>
                    {activity.data!.rows.map((r) => (
                      <tr key={r.lineId}>
                        <td className="px-4 py-2 whitespace-nowrap text-ink-600 dark:text-ink-300">{day(r.date)}</td>
                        <td className="px-4 py-2">
                          <span dir="auto">{r.memo ?? r.description}</span>
                          <Link to={`/journals/${r.entryId}`} className="ms-2 font-mono text-xs text-brand-700 hover:underline dark:text-brand-300" dir="ltr">
                            {r.number}
                          </Link>
                          {r.reference && <span className="block text-xs text-ink-500">{r.reference}</span>}
                        </td>
                        <td className="px-4 py-2 text-end font-mono tabular-nums text-income" dir="ltr">
                          {fx ? (r.foreignDebit ? inForeign(r.foreignDebit) : '') : cell(r.debit)}
                        </td>
                        <td className="px-4 py-2 text-end font-mono tabular-nums" dir="ltr">
                          {fx ? (r.foreignCredit ? inForeign(r.foreignCredit) : '') : cell(r.credit)}
                        </td>
                        <td className="px-4 py-2 text-end font-mono tabular-nums" dir="ltr">
                          {fx ? inForeign(r.foreignBalance ?? 0) : money.plain(r.balance)}
                        </td>
                      </tr>
                    ))}
                    {!activity.data!.rows.length && (
                      <tr>
                        <td className="px-4 py-6 text-center text-ink-500" colSpan={5}>
                          {t('banking.nothingMoved')}
                        </td>
                      </tr>
                    )}
                  </tbody>
                  <tfoot className="border-t-2 border-ink-200 font-semibold dark:border-ink-700">
                    <tr>
                      <td className="px-4 py-2.5" colSpan={4}>
                        {t('banking.closing', { date: day(to) })}
                      </td>
                      <td className="px-4 py-2.5 text-end font-mono tabular-nums" dir="ltr">
                        {fx ? inForeign(fx.closingBalance) : money.plain(activity.data!.closingBalance)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </Card>
          <Card className="self-start p-5">
            <h2 className="font-semibold">{t('banking.recorded')}</h2>
            <p className="mt-0.5 text-sm text-ink-500">{t('banking.recordedHint')}</p>
            {txs.data && !txs.data.items.length ? (
              <p className="mt-4 text-sm text-ink-500">{t('banking.noneRecorded')}</p>
            ) : (
              <ul className="mt-3 divide-y divide-ink-100 text-sm dark:divide-ink-800">
                {(txs.data?.items ?? []).map((tx) => {
                  const incoming = tx.kind === 'receive' || (tx.kind === 'transfer' && tx.toAccount?.id === selectedId);
                  return (
                    <li key={tx.id} className={clsx('flex items-start gap-3 py-2', tx.status === 'void' && 'opacity-60')}>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate" dir="auto">
                          {txLabel(tx)}
                        </span>
                        <span className="block text-xs text-ink-500">
                          {day(tx.date)}
                          {tx.reference && ` · ${tx.reference}`}
                          {tx.status === 'void' && ` · ${t('payments.void')}`}
                        </span>
                      </span>
                      <span className={clsx('font-mono tabular-nums', incoming ? 'text-income' : 'text-ink-800 dark:text-ink-100')} dir="ltr">
                        {incoming ? '+' : '−'}
                        {tx.kind === 'transfer' && incoming && tx.toCurrency !== tx.currency ? formatMoney(tx.toAmount ?? 0, tx.toCurrency ?? settings?.baseCurrency ?? 'INR', locale) : txAmount(tx)}
                      </span>
                      <RowMenu label={t('banking.actionsFor', { what: txLabel(tx) })} items={[{ key: 'files', label: t('attachments.title'), icon: Paperclip, onSelect: () => setFiles(tx) }, ...(canManage && tx.status === 'posted' ? [{ key: 'void', label: t('banking.void'), icon: Ban, danger: true, onSelect: () => setVoiding(tx) }] : [])]} />
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </motion.div>
      )}

      {selected && (
        <motion.div variants={fadeUp} className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-center gap-3 border-b border-ink-100 p-4 dark:border-ink-800">
              <span className="flex-1">
                <h2 className="font-semibold">{t('banking.fromBank')}</h2>
                <p className="mt-0.5 text-sm text-ink-500">{bankLines.data?.total ? t('banking.fromBankCount', { count: bankLines.data.total }) : t('banking.fromBankHint')}</p>
              </span>
              {!!bankLines.data?.total && (
                <Link to={`/banking/reconcile/${selected.id}`} className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700">
                  <Scale className="size-4" aria-hidden /> {t('banking.rec.open')}
                </Link>
              )}
            </div>
            {bankLines.data && bankLines.data.items.length > 0 && (
              <table className="w-full text-sm">
                <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
                  {bankLines.data.items.map((l) => (
                    <tr key={l.id}>
                      <td className="px-4 py-2 whitespace-nowrap text-ink-600 dark:text-ink-300">{day(l.date)}</td>
                      <td className="px-4 py-2" dir="auto">
                        {l.description}
                        {l.reference && <span className="block text-xs text-ink-500">{l.reference}</span>}
                      </td>
                      <td className="px-4 py-2">
                        <Pill tone={l.status === 'unmatched' ? 'neutral' : 'brand'}>{t(`banking.lineStatus.${l.status}`)}</Pill>
                      </td>
                      <td className={clsx('px-4 py-2 text-end font-mono tabular-nums', l.amount > 0 && 'text-income')} dir="ltr">
                        {selected.currency ? formatMoney(l.amount, selected.currency, locale) : money.format(l.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
          <Card className="self-start p-5">
            <h2 className="font-semibold">{t('banking.import.history')}</h2>
            {imports.data && !imports.data.length ? (
              <p className="mt-2 text-sm text-ink-500">{t('banking.import.noneYet')}</p>
            ) : (
              <ul className="mt-3 divide-y divide-ink-100 text-sm dark:divide-ink-800">
                {(imports.data ?? []).map((i) => (
                  <li key={i.id} className="flex items-start gap-3 py-2">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{i.fileName}</span>
                      <span className="block text-xs text-ink-500">
                        {t('banking.import.historyLine', { added: i.added, duplicates: i.duplicates })}
                        {i.firstDate && i.lastDate && ` · ${day(i.firstDate)} – ${day(i.lastDate)}`}
                      </span>
                    </span>
                    {canManage && !i.reconciled && <RowMenu label={t('banking.actionsFor', { what: i.fileName })} items={[{ key: 'undo', label: t('banking.import.undo'), icon: Undo2, danger: true, onSelect: () => setUndoing(i) }]} />}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </motion.div>
      )}

      {dialog === 'import' && selected && <ImportStatementDialog api={api} account={selected} onClose={() => setDialog(null)} />}
      <ConfirmDialog open={!!undoing} title={undoing ? t('banking.import.undoTitle', { file: undoing.fileName }) : ''} body={t('banking.import.undoBody')} confirmLabel={t('banking.import.undo')} tone="danger" busy={undo.isPending} onConfirm={() => undoing && undo.mutate(undoing)} onClose={() => setUndoing(null)} />
      {dialog === 'transfer' && <TransferDialog api={api} banks={accounts.data ?? []} fromAccountId={selectedId} onClose={() => setDialog(null)} />}
      {(dialog === 'spend' || dialog === 'receive') && <MoneyDialog api={api} kind={dialog} banks={accounts.data ?? []} bankAccountId={selectedId} onClose={() => setDialog(null)} />}
      <ConfirmDialog
        open={!!voiding}
        title={voiding ? t('banking.voidTitle', { what: txLabel(voiding) }) : ''}
        body={t('banking.voidBody')}
        confirmLabel={t('banking.void')}
        tone="danger"
        askReason
        busy={voidIt.isPending}
        onConfirm={(reason) => voiding && voidIt.mutate({ tx: voiding, reason })}
        onClose={() => setVoiding(null)}
      />
      {files && (
        <Modal open onClose={() => setFiles(null)} title={t('attachments.titleFor', { what: txLabel(files) })}>
          <DocumentAttachments documentType="bank_transaction" documentId={files.id} bare />
        </Modal>
      )}
    </motion.div>
  );
}
