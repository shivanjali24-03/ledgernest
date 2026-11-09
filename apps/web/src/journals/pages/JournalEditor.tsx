import { Fragment, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { motion } from 'motion/react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCurrenciesApi } from '../../currencies/useCurrenciesApi';
import { ACCOUNT_TYPES, ATTACHMENT_MAX_BYTES, ATTACHMENT_TYPES, currencyDigits, enteredLines, normaliseRate, postingProblem, sniffAttachmentType, splitTax, toBase, toMinor, todayIn, totals, type AttachmentType } from '@ledgernest/shared';
import { ArrowLeft, CheckCircle2, Download, Paperclip, Plus, Send, Trash2, Undo2, X } from 'lucide-react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { useIntlLocale } from '../../i18n';
import { formatDate } from '../../lib/format';
import { useMoney } from '../../lib/useMoney';
import { useSession } from '../../layout/session';
import { fadeUp, stagger } from '../../motion/tokens';
import { useAccountsApi } from '../../accounts/useAccountsApi';
import { useOrganizationSettings } from '../../settings/useOrganizationSettings';
import { useTaxesApi } from '../../taxes/useTaxesApi';
import Button from '../../ui/Button';
import ConfirmDialog from '../../ui/ConfirmDialog';
import { inputClass, TextField } from '../../ui/Field';
import { Card, ErrorState, PageHeader, Pill, SkeletonRows } from '../../ui/Kit';
import Modal from '../../ui/Modal';
import { useToast } from '../../ui/toastContext';
import { journalErrorMessage } from '../errors';
import type { JournalEntry, JournalsApi } from '../types';
import { useJournalsApi } from '../useJournalsApi';
import CostCentreSelect from '../../cost-centres/CostCentreSelect';
import { useCostCentres } from '../../cost-centres/useCostCentresApi';
import { heldForApproval, heldMessage } from '../../approvals/errors';

/** For a line on a foreign-currency account, debit and credit are in that currency, and rate is typed or empty (= the day's rate) */
type Line = { key: string; accountId: string; description: string; debit: string; credit: string; taxGroupId: string; inclusive: boolean; rate: string; costCentreId: string };
const blankLine = (): Line => ({ key: crypto.randomUUID(), accountId: '', description: '', debit: '', credit: '', taxGroupId: '', inclusive: false, rate: '', costCentreId: '' });

/** An amount in a currency's smallest unit as plain digits, e.g. 100000 → "1,000.00" */
const plainIn = (minor: number, digits: number, locale: string) => new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(minor / 10 ** digits);

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Supporting documents: list, download, add (PDF or image up to 2 MB), remove while a draft. */
function Attachments({ entry, api, onChange }: { entry: JournalEntry; api: JournalsApi; onChange: (e: JournalEntry) => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const session = useSession();
  const input = useRef<HTMLInputElement>(null);
  const canAdd = session.permissions.has('journals.create');
  const add = useMutation({
    mutationFn: async (file: File) => {
      if (!(ATTACHMENT_TYPES as readonly string[]).includes(file.type)) throw new Error(t('journals.attachments.wrongType'));
      if (file.size > ATTACHMENT_MAX_BYTES) throw new Error(t('journals.attachments.tooLarge'));
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (sniffAttachmentType(bytes) !== file.type) throw new Error(t('journals.errors.type_mismatch'));
      let binary = '';
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return api.attach(entry.id, { fileName: file.name, type: file.type as AttachmentType, data: btoa(binary) });
    },
    onSuccess: (e) => {
      onChange(e);
      toast(t('journals.attachments.added'));
    },
    onError: (e) => toast(e instanceof Error && !('kind' in e) ? e.message : journalErrorMessage(e, t), 'error'),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.detach(entry.id, id),
    onSuccess: async () => onChange(await api.get(entry.id)),
    onError: (e) => toast(journalErrorMessage(e, t), 'error'),
  });
  return (
    <Card className="p-5">
      <div className="flex items-center gap-2">
        <h2 className="flex-1 font-semibold">{t('journals.attachments.title')}</h2>
        {canAdd && (
          <>
            <input
              ref={input}
              type="file"
              accept={ATTACHMENT_TYPES.join(',')}
              className="sr-only"
              tabIndex={-1}
              aria-hidden
              onChange={(e) => e.target.files?.[0] && add.mutate(e.target.files[0], { onSettled: () => (e.target.value = '') })}
            />
            <Button size="sm" variant="secondary" icon={<Paperclip className="size-4" />} loading={add.isPending} onClick={() => input.current?.click()}>
              {t('journals.attachments.add')}
            </Button>
          </>
        )}
      </div>
      <p className="mt-1 text-xs text-ink-500">{t('journals.attachments.hint')}</p>
      {entry.attachments.length > 0 && (
        <ul className="mt-3 divide-y divide-ink-100 rounded-xl border border-ink-100 dark:divide-ink-800 dark:border-ink-800">
          {entry.attachments.map((a) => (
            <li key={a.id} className="flex items-center gap-2 px-3 py-2 text-sm">
              <Paperclip className="size-4 text-ink-400" aria-hidden />
              <span className="min-w-0 flex-1 truncate" dir="auto">
                {a.fileName}
              </span>
              <span className="text-xs text-ink-400">{Math.ceil(a.size / 1024)} KB</span>
              <Button
                size="sm"
                variant="ghost"
                aria-label={t('journals.attachments.download', { name: a.fileName })}
                icon={<Download className="size-4" />}
                onClick={async () => {
                  const f = await api.download(entry.id, a.id);
                  saveBlob(f.blob, f.filename);
                }}
              />
              {entry.status === 'draft' && canAdd && (
                <Button size="sm" variant="ghost" aria-label={t('journals.attachments.remove', { name: a.fileName })} icon={<X className="size-4" />} onClick={() => remove.mutate(a.id)} />
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** A posted entry: final, with its number, who posted it, and its reversal if any. */
function PostedView({ entry, api, onChange }: { entry: JournalEntry; api: JournalsApi; onChange: (e: JournalEntry) => void }) {
  const { t } = useTranslation();
  const locale = useIntlLocale();
  const money = useMoney();
  const session = useSession();
  const toast = useToast();
  const navigate = useNavigate();
  const [reversing, setReversing] = useState(false);
  const [date, setDate] = useState(entry.date);
  const [memo, setMemo] = useState('');
  const canReverse = session.permissions.has('journals.reverse') && !entry.reversedBy && !entry.reversalOf;
  const reverse = useMutation({
    mutationFn: () => api.reverse(entry.id, { date, memo: memo || undefined }),
    onSuccess: (r) => {
      setReversing(false);
      toast(t('journals.reversed', { number: r.number }));
      navigate(`/journals/${r.id}`);
    },
    onError: (e) => toast(journalErrorMessage(e, t), 'error'),
  });

  return (
    <>
      <Card className="overflow-hidden">
        <dl className="grid grid-cols-2 gap-4 border-b border-ink-100 p-5 sm:grid-cols-4 dark:border-ink-800">
          <div>
            <dt className="text-xs text-ink-400">{t('journals.fields.date')}</dt>
            <dd className="mt-0.5 text-sm">{formatDate(`${entry.date}T00:00:00Z`, locale)}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-400">{t('journals.fields.reference')}</dt>
            <dd className="mt-0.5 text-sm" dir="auto">
              {entry.reference ?? '—'}
            </dd>
          </div>
          <div className="col-span-2">
            <dt className="text-xs text-ink-400">{t('journals.postedBy')}</dt>
            <dd className="mt-0.5 text-sm">
              {entry.postedBy?.name ?? '—'} · {entry.postedAt ? formatDate(entry.postedAt, locale) : ''}
            </dd>
          </div>
          {entry.memo && (
            <div className="col-span-full">
              <dt className="text-xs text-ink-400">{t('journals.fields.memo')}</dt>
              <dd className="mt-0.5 text-sm" dir="auto">
                {entry.memo}
              </dd>
            </div>
          )}
        </dl>
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="text-xs uppercase tracking-wide text-ink-400">
              <tr>
                <th scope="col" className="px-5 py-2 text-start font-semibold">
                  {t('journals.fields.account')}
                </th>
                <th scope="col" className="px-5 py-2 text-end font-semibold">
                  {t('journals.fields.debit')}
                </th>
                <th scope="col" className="px-5 py-2 text-end font-semibold">
                  {t('journals.fields.credit')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
              {entry.lines.map((l) => (
                <tr key={l.id} className={clsx((l.taxRate || l.fxSourceLine) && 'text-ink-500')}>
                  <td className={clsx('px-5 py-2', l.credit > 0 && 'ps-10')}>
                    <span dir="auto">
                      <code className="me-2 text-xs text-ink-400" dir="ltr">
                        {l.account.code}
                      </code>
                      {l.account.name}
                    </span>
                    {l.taxGroup && (
                      <span className="ms-2 inline-block">
                        <Pill tone="brand">{l.taxInclusive ? t('journals.tax.groupInclusive', { name: l.taxGroup.name }) : l.taxGroup.name}</Pill>
                      </span>
                    )}
                    {l.costCentre && (
                      <span className="ms-2 inline-block" title={t('costCentres.field')}>
                        <Pill>{l.costCentre.code}</Pill>
                      </span>
                    )}
                    {(l.description || l.taxRate) && (
                      <span className="block text-xs text-ink-400" dir="auto">
                        {l.taxRate ? t('journals.tax.lineFor', { name: l.taxRate.name, n: l.taxSourceLine }) : l.description}
                      </span>
                    )}
                    {l.currency && (l.foreignDebit > 0 || l.foreignCredit > 0) && (
                      <span className="block text-xs text-ink-500" dir="ltr">
                        {t('journals.fx.amountAt', { amount: `${l.currency} ${plainIn(l.foreignDebit || l.foreignCredit, currencyDigits(l.currency), locale)}`, rate: l.rate })}
                      </span>
                    )}
                    {l.fxSourceLine && <span className="block text-xs text-ink-500">{t('journals.fx.lineFor', { n: l.fxSourceLine })}</span>}
                  </td>
                  <td className="px-5 py-2 text-end font-mono tabular-nums" dir="ltr">
                    {l.debit ? money.plain(l.debit) : ''}
                  </td>
                  <td className="px-5 py-2 text-end font-mono tabular-nums" dir="ltr">
                    {l.credit ? money.plain(l.credit) : ''}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-ink-200 font-semibold dark:border-ink-700">
              <tr>
                <th scope="row" className="px-5 py-2 text-start">
                  {t('journals.total')}
                </th>
                <td className="px-5 py-2 text-end font-mono tabular-nums" dir="ltr">
                  {money.format(entry.totals.debit)}
                </td>
                <td className="px-5 py-2 text-end font-mono tabular-nums" dir="ltr">
                  {money.format(entry.totals.credit)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
        {(entry.reversalOf || entry.reversedBy || canReverse) && (
          <div className="flex flex-wrap items-center gap-3 border-t border-ink-100 p-4 dark:border-ink-800">
            {entry.reversalOf && (
              <p className="text-sm">
                {t('journals.reversalOf')}{' '}
                <Link className="font-mono font-semibold text-brand-700 hover:underline dark:text-brand-300" to={`/journals/${entry.reversalOf.id}`}>
                  {entry.reversalOf.number}
                </Link>
              </p>
            )}
            {entry.reversedBy && (
              <p className="text-sm">
                {t('journals.reversedBy')}{' '}
                <Link className="font-mono font-semibold text-brand-700 hover:underline dark:text-brand-300" to={`/journals/${entry.reversedBy.id}`}>
                  {entry.reversedBy.number}
                </Link>
              </p>
            )}
            {canReverse && (
              <Button variant="secondary" className="ms-auto" icon={<Undo2 className="size-4" />} onClick={() => setReversing(true)}>
                {t('journals.reverse')}
              </Button>
            )}
          </div>
        )}
      </Card>
      <Attachments entry={entry} api={api} onChange={onChange} />
      <Modal
        open={reversing}
        onClose={() => setReversing(false)}
        title={t('journals.reverseTitle', { number: entry.number })}
        description={t('journals.reverseBody')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setReversing(false)}>
              {t('common.cancel')}
            </Button>
            <Button loading={reverse.isPending} onClick={() => reverse.mutate()}>
              {t('journals.reverse')}
            </Button>
          </>
        }
      >
        <div className="grid gap-4">
          <TextField label={t('journals.fields.date')} type="date" value={date} onChange={(e) => setDate(e.target.value)} hint={t('journals.reverseDateHint')} data-autofocus />
          <TextField label={t('journals.fields.memo')} value={memo} onChange={(e) => setMemo(e.target.value)} placeholder={t('journals.reverseMemo', { number: entry.number })} dir="auto" />
        </div>
      </Modal>
    </>
  );
}

/** A draft: edit freely, save, then post when it balances. */
function DraftForm({ entry, api }: { entry: JournalEntry | null; api: JournalsApi }) {
  const { t } = useTranslation();
  const money = useMoney();
  const session = useSession();
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const settings = useOrganizationSettings().data;
  const accountsApi = useAccountsApi();
  const accounts = useQuery({ queryKey: ['accounts', session.organizationId, session.role ?? session.customRoleName, 'all'], queryFn: () => accountsApi!.list(true), enabled: !!accountsApi });
  const canPost = session.permissions.has('journals.post');
  const canEdit = session.permissions.has('journals.create');

  const fmt = (minor: number) => (minor ? money.plain(minor) : '');
  const locale = useIntlLocale();
  const accountById = useMemo(() => new Map((accounts.data ?? []).map((a) => [a.id, a])), [accounts.data]);
  const taxesApi = useTaxesApi();
  const centres = useCostCentres(true).data ?? [];
  const taxes = useQuery({ queryKey: ['taxes', session.organizationId, session.role ?? session.customRoleName], queryFn: () => taxesApi!.list(), enabled: !!taxesApi });
  const [date, setDate] = useState(entry?.date ?? todayIn(settings?.timeZone ?? 'Asia/Kolkata'));
  const [reference, setReference] = useState(entry?.reference ?? '');
  const [memo, setMemo] = useState(entry?.memo ?? '');
  const [lines, setLines] = useState<Line[]>(
    entry?.lines.length
      ? // Generated tax lines are left out: they're made again from each line's tax group
        enteredLines(entry.lines.map((l) => ({ ...l, taxGroupId: l.taxGroup?.id ?? null, taxRateId: l.taxRate?.id ?? null, costCentreId: l.costCentre?.id ?? null }))).map((l) => {
          // Foreign lines reopen in their currency, with the rate they were converted at
          const foreign = (minor: number | undefined) => (minor ? plainIn(minor, currencyDigits(l.currency!), locale) : '');
          return {
            key: crypto.randomUUID(),
            accountId: l.accountId,
            description: l.description ?? '',
            debit: l.currency ? foreign(l.foreignDebit) : fmt(l.debit),
            credit: l.currency ? foreign(l.foreignCredit) : fmt(l.credit),
            taxGroupId: l.taxGroupId ?? '',
            inclusive: !!l.taxInclusive,
            rate: l.currency ? (l.rate ?? '') : '',
            costCentreId: l.costCentreId ?? '',
          };
        })
      : [blankLine(), blankLine()],
  );
  const [deleting, setDeleting] = useState(false);

  // The day's rate for each foreign currency on the lines (the latest on or before the entry's date)
  const currenciesApi = useCurrenciesApi();
  const foreignCodes = [...new Set(lines.map((l) => accountById.get(l.accountId)?.currency).filter((c): c is string => !!c))].sort();
  const rateQueries = useQueries({
    queries: foreignCodes.map((code) => ({ queryKey: ['currencies', session.organizationId, 'rates', code], queryFn: () => currenciesApi!.rates(code), enabled: !!currenciesApi })),
  });
  const dayRate = (code: string) => rateQueries[foreignCodes.indexOf(code)]?.data?.find((r) => r.date <= date)?.rate ?? null;

  const taxGroups = taxes.data?.groups ?? [];
  const groupById = new Map(taxGroups.map((g) => [g.id, g]));
  // Each line's tax as the API will generate it: the net amount, then one amount per rate
  const parsed = lines.map((l) => {
    const currency = accountById.get(l.accountId)?.currency ?? null;
    const digits = currency ? currencyDigits(currency) : money.digits;
    const fd = toMinor(l.debit, digits);
    const fc = toMinor(l.credit, digits);
    // A foreign line's base amount, at the typed rate or the day's
    const typedRate = l.rate.trim() ? normaliseRate(l.rate) : null;
    const badRate = !!currency && !!l.rate.trim() && !typedRate;
    const rate = currency ? (typedRate ?? (l.rate.trim() ? null : dayRate(currency))) : null;
    const toBaseAmount = (minor: number | null) => (minor === null ? null : !minor ? 0 : rate ? toBase(minor, rate, digits, money.digits) : 0);
    const d = currency ? toBaseAmount(fd) : fd;
    const c = currency ? toBaseAmount(fc) : fc;
    const noRate = !!currency && !rate && !badRate && !!((fd ?? 0) || (fc ?? 0));
    const group = !currency && l.taxGroupId ? groupById.get(l.taxGroupId) : undefined;
    const amount = (d ?? 0) || (c ?? 0);
    const split =
      group && amount
        ? splitTax(
            amount,
            l.inclusive,
            group.rates.map((r) => ({ rateId: r.id, ratePpm: r.ratePpm })),
          )
        : null;
    const taxLines = split ? split.taxes.map((x, i) => ({ name: group!.rates[i]!.name, amount: x.amount })).filter((x) => x.amount) : [];
    return { ...l, currency, digits, fd, fc, effRate: rate, badRate, noRate, d, c, net: split?.net ?? amount, taxLines, onDebit: !!(currency ? fd : d) };
  });
  const filled = parsed.filter((l) => l.accountId || l.d || l.c || l.description);
  const invalid = parsed.some((l) => l.d === null || l.c === null || l.badRate);
  const missingRate = filled.find((l) => l.noRate);
  // Totals count the tax lines too
  const asStored = filled.flatMap((l) => [
    { debit: l.onDebit ? l.net : 0, credit: l.onDebit ? 0 : l.net },
    ...l.taxLines.map((x) => ({ debit: l.onDebit ? x.amount : 0, credit: l.onDebit ? 0 : x.amount })),
  ]);
  const t2 = totals(asStored);
  const problem = invalid ? 'invalid' : missingRate ? 'no_rate' : postingProblem(filled.length < 2 ? filled.map((l) => ({ debit: l.d ?? 0, credit: l.c ?? 0 })) : asStored);
  const hasTaxes = taxGroups.length > 0 || lines.some((l) => l.taxGroupId);
  const missingAccount = filled.some((l) => !l.accountId);

  const set = (key: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const payload = () => ({
    date,
    reference,
    memo,
    lines: filled.map((l) =>
      l.currency
        ? { accountId: l.accountId, description: l.description, currency: l.currency, foreignDebit: l.fd ?? 0, foreignCredit: l.fc ?? 0, costCentreId: l.costCentreId || null, ...(l.rate && l.rate.trim() && normaliseRate(l.rate) && l.rate !== dayRate(l.currency) ? { rate: normaliseRate(l.rate)! } : {}) }
        : { accountId: l.accountId, description: l.description, debit: l.d ?? 0, credit: l.c ?? 0, taxGroupId: l.taxGroupId || null, taxInclusive: !!l.taxGroupId && l.inclusive, costCentreId: l.costCentreId || null },
    ),
  });

  const groups = useMemo(() => {
    const list = (accounts.data ?? []).filter((a) => !a.archived || lines.some((l) => l.accountId === a.id));
    return ACCOUNT_TYPES.map((type) => ({ type, accounts: list.filter((a) => a.type === type) }));
  }, [accounts.data, lines]);

  const save = useMutation({
    mutationFn: async (andPost: boolean) => {
      const saved = entry ? await api.update(entry.id, payload()) : await api.create(payload());
      if (!andPost) return { e: saved, held: null };
      // Held for approval: it stays a draft, saved, with the request sent
      return api.post(saved.id).then(
        (e) => ({ e, held: null }),
        (err: unknown) => {
          if (heldForApproval(err)) return { e: saved, held: err };
          throw err;
        },
      );
    },
    onSuccess: ({ e, held }, andPost) => {
      void queryClient.invalidateQueries({ queryKey: ['journals'] });
      void queryClient.invalidateQueries({ queryKey: ['journal'] });
      // Posting can lock the base currency in settings
      if (andPost) void queryClient.invalidateQueries({ queryKey: ['settings'] });
      toast(held ? heldMessage(held, t) : andPost ? t('journals.posted', { number: e.number }) : t('journals.saved'));
      if (held) void queryClient.invalidateQueries({ queryKey: ['approvals'] });
      navigate(`/journals/${e.id}`, { replace: true });
    },
    onError: (e) => toast(journalErrorMessage(e, t), 'error'),
  });
  const remove = useMutation({
    mutationFn: () => api.remove(entry!.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['journals'] });
      toast(t('journals.deleted'));
      navigate('/journals');
    },
    onError: (e) => toast(journalErrorMessage(e, t), 'error'),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (invalid || missingAccount) return toast(t(invalid ? 'journals.errors.invalid_amount' : 'journals.errors.missing_account'), 'error');
    save.mutate(false);
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <Card className="grid gap-4 p-5 sm:grid-cols-[12rem_12rem_1fr]">
        <TextField label={t('journals.fields.date')} type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={!canEdit} />
        <TextField label={t('journals.fields.reference')} value={reference} onChange={(e) => setReference(e.target.value)} disabled={!canEdit} dir="auto" placeholder="INV-1042" />
        <TextField label={t('journals.fields.memo')} value={memo} onChange={(e) => setMemo(e.target.value)} disabled={!canEdit} dir="auto" />
      </Card>

      <Card className="overflow-hidden">
        <div className="relative overflow-x-auto">
          <table className={clsx('w-full text-sm', hasTaxes ? 'min-w-[940px]' : 'min-w-[760px]')}>
            <thead className="border-b border-ink-100 text-xs uppercase tracking-wide text-ink-400 dark:border-ink-800">
              <tr>
                <th scope="col" className="w-[38%] px-3 py-2 text-start font-semibold">
                  {t('journals.fields.account')}
                </th>
                <th scope="col" className="px-3 py-2 text-start font-semibold">
                  {t('journals.fields.description')}
                </th>
                {hasTaxes && (
                  <th scope="col" className="w-44 px-3 py-2 text-start font-semibold">
                    {t('journals.tax.column')}
                  </th>
                )}
                <th scope="col" className="w-36 px-3 py-2 text-end font-semibold">
                  {t('journals.fields.debit')}
                </th>
                <th scope="col" className="w-36 px-3 py-2 text-end font-semibold">
                  {t('journals.fields.credit')}
                </th>
                <th scope="col" className="w-10">
                  <span className="sr-only">{t('journals.removeLine')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {parsed.map((l, i) => (
                <Fragment key={l.key}>
                  <tr className="align-top">
                    <td className="px-3 py-1.5">
                      <select
                        aria-label={t('journals.lineAccount', { n: i + 1 })}
                        value={l.accountId}
                        disabled={!canEdit}
                        onChange={(e) => set(l.key, { accountId: e.target.value })}
                        className={clsx(inputClass, 'h-9 border-ink-200 dark:border-ink-700')}
                      >
                        <option value="">{t('journals.pickAccount')}</option>
                        {groups.map((g) =>
                          g.accounts.length ? (
                            <optgroup key={g.type} label={t(`accounts.typesPlural.${g.type}`)}>
                              {g.accounts.map((a) => (
                                <option key={a.id} value={a.id} disabled={a.archived}>
                                  {a.code} · {a.name}
                                </option>
                              ))}
                            </optgroup>
                          ) : null,
                        )}
                      </select>
                    </td>
                    <td className="px-3 py-1.5">
                      <input
                        aria-label={t('journals.lineDescription', { n: i + 1 })}
                        value={l.description}
                        disabled={!canEdit}
                        onChange={(e) => set(l.key, { description: e.target.value })}
                        dir="auto"
                        className={clsx(inputClass, 'h-9 border-ink-200 dark:border-ink-700')}
                      />
                      <CostCentreSelect centres={centres} value={l.costCentreId} onChange={(v) => set(l.key, { costCentreId: v })} label={t('costCentres.lineLabel', { n: i + 1 })} disabled={!canEdit} />
                    </td>
                    {hasTaxes && (
                      <td className="px-3 py-1.5">
                        <select
                          aria-label={t('journals.tax.lineTax', { n: i + 1 })}
                          value={l.currency ? '' : l.taxGroupId}
                          disabled={!canEdit || !!l.currency}
                          onChange={(e) => set(l.key, { taxGroupId: e.target.value, inclusive: e.target.value ? l.inclusive : false })}
                          className={clsx(inputClass, 'h-9 border-ink-200 dark:border-ink-700')}
                        >
                          <option value="">{t('journals.tax.none')}</option>
                          {taxGroups
                            .filter((g) => !g.archived || g.id === l.taxGroupId)
                            .map((g) => (
                              <option key={g.id} value={g.id} disabled={g.archived}>
                                {g.name}
                              </option>
                            ))}
                        </select>
                        {l.taxGroupId && (
                          <label className="mt-1 flex items-center gap-1.5 text-xs text-ink-500">
                            <input
                              type="checkbox"
                              checked={l.inclusive}
                              disabled={!canEdit}
                              onChange={(e) => set(l.key, { inclusive: e.target.checked })}
                              className="size-3.5 rounded accent-brand-600"
                            />
                            {t('journals.tax.inclusive')}
                          </label>
                        )}
                      </td>
                    )}
                    {(['debit', 'credit'] as const).map((side) => {
                      const value = side === 'debit' ? l.d : l.c;
                      return (
                        <td key={side} className="relative px-3 py-1.5">
                          {l.currency && (
                            <span className="pointer-events-none absolute start-5 top-1/2 -translate-y-1/2 text-[11px] font-semibold text-ink-400" aria-hidden>
                              {l.currency}
                            </span>
                          )}
                          <input
                            aria-label={t(side === 'debit' ? 'journals.lineDebit' : 'journals.lineCredit', { n: i + 1 })}
                            inputMode="decimal"
                            dir="ltr"
                            value={l[side]}
                            disabled={!canEdit}
                            aria-invalid={(l.currency ? (side === 'debit' ? l.fd : l.fc) : value) === null || undefined}
                            onChange={(e) =>
                              set(l.key, side === 'debit' ? { debit: e.target.value, credit: e.target.value ? '' : l.credit } : { credit: e.target.value, debit: e.target.value ? '' : l.debit })
                            }
                            onBlur={() => {
                              const minor = l.currency ? (side === 'debit' ? l.fd : l.fc) : value;
                              if (minor) set(l.key, { [side]: l.currency ? plainIn(minor, l.digits, locale) : money.plain(minor) });
                            }}
                            className={clsx(inputClass, 'h-9 text-end font-mono tabular-nums', l.currency && 'ps-12', (l.currency ? (side === 'debit' ? l.fd : l.fc) : value) === null ? 'border-expense' : 'border-ink-200 dark:border-ink-700')}
                          />
                        </td>
                      );
                    })}
                    <td className="py-1.5 pe-2">
                      {canEdit && lines.length > 2 && (
                        <button
                          type="button"
                          onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                          aria-label={t('journals.removeLineN', { n: i + 1 })}
                          className="grid size-9 place-items-center rounded-lg text-ink-400 hover:bg-ink-100 hover:text-expense dark:hover:bg-ink-800"
                        >
                          <X className="size-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                  {l.currency && (
                    <tr className="text-xs text-ink-500" data-testid="fx-row">
                      <td className="px-3 pb-2 ps-6" colSpan={hasTaxes ? 3 : 2}>
                        <label className="inline-flex items-center gap-2 whitespace-nowrap">
                          <span dir="ltr">1 {l.currency} =</span>
                          <input
                            aria-label={t('journals.fx.lineRate', { n: i + 1, code: l.currency })}
                            value={l.rate}
                            placeholder={dayRate(l.currency) ?? ''}
                            disabled={!canEdit}
                            inputMode="decimal"
                            dir="ltr"
                            onChange={(e) => set(l.key, { rate: e.target.value })}
                            className={clsx(
                              'h-7 w-28 rounded-lg border bg-white px-2 text-end font-mono text-xs outline-none placeholder:text-ink-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15 disabled:opacity-60 dark:bg-ink-900',
                              l.badRate ? 'border-expense' : 'border-ink-200 dark:border-ink-700',
                            )}
                          />
                          <span dir="ltr">{money.currency}</span>
                        </label>
                        <span className="ms-2">{l.noRate ? t('journals.fx.noRate', { code: l.currency, date }) : l.rate.trim() ? t('journals.fx.typedRate') : t('journals.fx.dayRate')}</span>
                      </td>
                      <td className="px-3 pb-2 text-end font-mono tabular-nums" dir="ltr">
                        {l.onDebit && l.d ? money.plain(l.d) : ''}
                      </td>
                      <td className="px-3 pb-2 text-end font-mono tabular-nums" dir="ltr">
                        {!l.onDebit && l.c ? money.plain(l.c) : ''}
                      </td>
                      <td />
                    </tr>
                  )}
                  {l.taxLines.length > 0 && (
                    <>
                      {l.inclusive && (
                        <tr className="text-xs text-ink-500">
                          <td className="px-3 pb-1 ps-6" colSpan={3}>
                            {t('journals.tax.net')}
                          </td>
                          <td className="px-3 pb-1 text-end font-mono tabular-nums" dir="ltr">
                            {l.onDebit ? money.plain(l.net) : ''}
                          </td>
                          <td className="px-3 pb-1 text-end font-mono tabular-nums" dir="ltr">
                            {l.onDebit ? '' : money.plain(l.net)}
                          </td>
                          <td />
                        </tr>
                      )}
                      {l.taxLines.map((x) => (
                        <tr key={x.name} className="text-xs text-ink-500" data-testid="tax-preview">
                          <td className="px-3 pb-1 ps-6" colSpan={3}>
                            ↳ {x.name}
                          </td>
                          <td className="px-3 pb-1 text-end font-mono tabular-nums" dir="ltr">
                            {l.onDebit ? money.plain(x.amount) : ''}
                          </td>
                          <td className="px-3 pb-1 text-end font-mono tabular-nums" dir="ltr">
                            {l.onDebit ? '' : money.plain(x.amount)}
                          </td>
                          <td />
                        </tr>
                      ))}
                    </>
                  )}
                </Fragment>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-ink-200 dark:border-ink-700">
              <tr>
                <td className="px-3 py-2" colSpan={hasTaxes ? 3 : 2}>
                  {canEdit && (
                    <Button type="button" size="sm" variant="ghost" icon={<Plus className="size-4" />} onClick={() => setLines((ls) => [...ls, blankLine()])}>
                      {t('journals.addLine')}
                    </Button>
                  )}
                </td>
                <td className="px-3 py-2 text-end font-mono font-semibold tabular-nums" dir="ltr">
                  {money.plain(t2.debit)}
                </td>
                <td className="px-3 py-2 text-end font-mono font-semibold tabular-nums" dir="ltr">
                  {money.plain(t2.credit)}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
        <div role="status" className={clsx('flex items-center gap-2 border-t border-ink-100 px-4 py-3 text-sm dark:border-ink-800', problem ? 'text-warning' : 'text-income')}>
          {problem ? null : <CheckCircle2 className="size-4" aria-hidden />}
          {problem === 'unbalanced' ? t('journals.outBy', { amount: money.format(Math.abs(t2.difference)) }) : problem ? t(`journals.problems.${problem}`) : t('journals.balanced')}
        </div>
      </Card>

      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          {entry && (
            <Button type="button" variant="ghost" icon={<Trash2 className="size-4" />} onClick={() => setDeleting(true)}>
              {t('journals.deleteDraft')}
            </Button>
          )}
          <span className="flex-1" />
          <Button type="submit" variant="secondary" loading={save.isPending && save.variables === false}>
            {t('journals.saveDraft')}
          </Button>
          {canPost && (
            <Button
              type="button"
              icon={<Send className="size-4 rtl:-scale-x-100" />}
              disabled={!!problem || missingAccount}
              loading={save.isPending && save.variables === true}
              onClick={() => save.mutate(true)}
            >
              {t('journals.post')}
            </Button>
          )}
        </div>
      )}
      <ConfirmDialog
        open={deleting}
        title={t('journals.deleteTitle')}
        body={t('journals.deleteBody')}
        confirmLabel={t('journals.deleteDraft')}
        tone="danger"
        busy={remove.isPending}
        onConfirm={() => remove.mutate()}
        onClose={() => setDeleting(false)}
      />
    </form>
  );
}

/** One journal entry: a new or draft one to edit, or a posted one to read and reverse. */
export default function JournalEditor() {
  const { t } = useTranslation();
  const { id } = useParams();
  const session = useSession();
  const api = useJournalsApi();
  const queryClient = useQueryClient();
  const isNew = !id || id === 'new';
  const key = ['journal', session.organizationId, id] as const;
  const query = useQuery({ queryKey: key, queryFn: () => api!.get(id!), enabled: !!api && !isNew });
  const entry = query.data;

  const title = isNew ? t('journals.newTitle') : (entry?.number ?? t('journals.draftTitle'));
  return (
    <motion.div variants={stagger(0.06)} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={fadeUp}>
        <Link to="/journals" className="mb-2 inline-flex items-center gap-1 text-sm text-ink-500 hover:text-ink-800 dark:hover:text-ink-200">
          <ArrowLeft className="size-4 rtl:-scale-x-100" aria-hidden /> {t('journals.title')}
        </Link>
        <PageHeader
          title={title}
          description={entry?.status === 'posted' ? t('journals.postedHint') : t('journals.draftHint')}
          actions={entry ? <Pill tone={entry.status === 'posted' ? 'brand' : 'neutral'}>{t(`journals.status.${entry.status}`)}</Pill> : undefined}
        />
      </motion.div>
      <motion.div variants={fadeUp} className="space-y-4">
        {!api ? null : isNew ? (
          <DraftForm key="new" entry={null} api={api} />
        ) : query.isPending ? (
          <Card>
            <SkeletonRows rows={5} />
          </Card>
        ) : query.isError ? (
          <Card>
            <ErrorState onRetry={() => void query.refetch()} />
          </Card>
        ) : entry!.status === 'posted' ? (
          <PostedView key={entry!.id} entry={entry!} api={api} onChange={(e) => queryClient.setQueryData(key, e)} />
        ) : (
          <>
            <DraftForm key={`${entry!.id}-${entry!.lines.length}-${entry!.date}`} entry={entry!} api={api} />
            <Attachments entry={entry!} api={api} onChange={(e) => queryClient.setQueryData(key, e)} />
          </>
        )}
      </motion.div>
    </motion.div>
  );
}
