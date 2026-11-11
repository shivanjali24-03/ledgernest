import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { allocateOldestFirst, currencyDigits, PAYMENT_MODES, tdsOn, TDS_SECTIONS, toMinor, todayIn, type PaymentKind, type PaymentMode, type TdsSection } from '@ledgernest/shared';
import { useTranslation } from 'react-i18next';
import { useAccountsApi } from '../accounts/useAccountsApi';
import { useContactsApi } from '../contacts/useContactsApi';
import { useIntlLocale } from '../i18n';
import { billErrorMessage } from '../bills/errors';
import { formatDate } from '../lib/format';
import { useSession } from '../layout/session';
import { useOrganizationSettings } from '../settings/useOrganizationSettings';
import Button from '../ui/Button';
import { SelectField, TextField } from '../ui/Field';
import Modal from '../ui/Modal';
import { useToast } from '../ui/toastContext';
import type { Payment, PaymentsApi } from './types';
import { heldForApproval, heldMessage } from '../approvals/errors';

/**
 * Record money received from a customer against their open invoices, or paid to a vendor against their open
 * bills. Opened from a document it starts with that document's balance; otherwise it suggests the oldest first.
 */
export default function ReceiptDialog({ api, kind = 'receipt', contactId: fixedContact, documentId, onClose, onDone }: { api: PaymentsApi; kind?: PaymentKind; contactId?: string; documentId?: string; onClose: () => void; onDone: (p: Payment) => void }) {
  const { t } = useTranslation();
  const locale = useIntlLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const session = useSession();
  const settings = useOrganizationSettings().data;
  const role = session.role ?? session.customRoleName;
  const contactsApi = useContactsApi();
  const accountsApi = useAccountsApi();
  const receipt = kind === 'receipt';
  const customers = useQuery({ queryKey: ['contacts', session.organizationId, role, receipt ? 'customers' : 'vendors'], queryFn: () => contactsApi!.list({ type: receipt ? 'customer' : 'vendor', page: 1, pageSize: 100 }), enabled: !!contactsApi });
  const accounts = useQuery({ queryKey: ['accounts', session.organizationId, role, 'all'], queryFn: () => accountsApi!.list(true), enabled: !!accountsApi });
  const [contactId, setContactId] = useState(fixedContact ?? '');
  const contact = customers.data?.items.find((c) => c.id === contactId);
  const currency = contact?.currency ?? null;
  const code = currency ?? settings?.baseCurrency ?? 'INR';
  const digits = currencyDigits(code);
  const plain = (minor: number) => new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(minor / 10 ** digits);
  const open = useQuery({ queryKey: ['payments', session.organizationId, 'open', kind, contactId], queryFn: () => (receipt ? api.openInvoices(contactId) : api.openBills(contactId)), enabled: !!contactId });

  const banks = useMemo(() => (accounts.data ?? []).filter((a) => a.type === 'asset' && (a.subtype === 'bank' || a.subtype === 'cash') && !a.archived && (!a.currency || a.currency === currency)), [accounts.data, currency]);
  const [bankAccountId, setBank] = useState('');
  const [date, setDate] = useState(() => todayIn(settings?.timeZone ?? 'Asia/Kolkata'));
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [mode, setMode] = useState<PaymentMode | ''>('');
  const [instrumentNo, setInstrumentNo] = useState('');
  const [instrumentDate, setInstrumentDate] = useState('');
  const [drawnOn, setDrawnOn] = useState('');
  // Allocation per invoice, as typed; filled from the invoice it was opened from, or oldest first
  const [allocs, setAllocs] = useState<Record<string, string>>({});
  const [seeded, setSeeded] = useState<string | null>(null);
  if (open.data && seeded !== contactId) {
    setSeeded(contactId);
    const start = documentId ? open.data.filter((i) => i.id === documentId) : [];
    const total = start.reduce((s, i) => s + i.balance, 0);
    setAllocs(Object.fromEntries(start.map((i) => [i.id, plain(i.balance)])));
    if (total) setAmount(plain(total));
  }
  // TDS on a vendor payment in rupees: kept back from the bank, owed to the government on a tax liability account
  const canTds = !!contactId && !currency;
  // Kept back from a vendor: owed on a tax liability. Kept back by a customer: claimed back from a current asset
  const tdsAccounts = useMemo(() => (accounts.data ?? []).filter((a) => !a.archived && (receipt ? a.type === 'asset' && (a.subtype === 'current_asset' || a.subtype === 'other_asset') : a.type === 'liability' && (a.subtype === 'tax_payable' || a.subtype === 'current_liability'))).sort((a, b) => Number(/tds/i.test(b.name)) - Number(/tds/i.test(a.name))), [accounts.data, receipt]);
  const [tdsWanted, setTdsWanted] = useState(false);
  const [section, setSection] = useState<TdsSection>('194C');
  const [ratePct, setRatePct] = useState('1');
  const [tdsBase, setTdsBase] = useState('');
  const [tdsAmount, setTdsAmount] = useState('');
  const [tdsTouched, setTdsTouched] = useState(false);
  const [tdsAccountId, setTdsAccountId] = useState('');
  const bank = bankAccountId || banks[0]?.id || '';
  // A cash account takes cash only
  const isCash = (accounts.data ?? []).find((a) => a.id === bank)?.subtype === 'cash';
  const amt = toMinor(amount, digits);
  const parsedAllocs = (open.data ?? []).map((i) => ({ ...i, value: allocs[i.id]?.trim() ? toMinor(allocs[i.id]!, digits) : 0 }));
  const allocated = parsedAllocs.reduce((s, i) => s + (i.value ?? 0), 0);
  const tdsActive = canTds && tdsWanted;
  const ratePpm = Math.round(Number(ratePct.replace(',', '.')) * 10_000);
  // What TDS is on: the bills before GST, in proportion to what's paid of each; the payment itself when nothing's allocated
  const suggestedBase = parsedAllocs.reduce((s, i) => s + (i.value && i.total ? Math.round(((i.subtotal ?? i.total) * i.value) / i.total) : 0), 0) || amt || 0;
  const baseMinor = tdsBase.trim() ? toMinor(tdsBase, digits) : suggestedBase;
  const tdsMinor = tdsTouched && tdsAmount.trim() ? toMinor(tdsAmount, digits) : baseMinor && ratePpm > 0 ? tdsOn(baseMinor, ratePpm) : 0;
  const tdsAccount = tdsAccountId || tdsAccounts[0]?.id || '';
  const tdsProblem = tdsActive && (!(ratePpm > 0 && ratePpm <= 300_000) || !baseMinor || !tdsMinor || !tdsAccount || (amt !== null && tdsMinor >= amt));
  const problem = !contactId ? (receipt ? 'customer' : 'vendor') : !bank ? 'bank' : !amt ? 'amount' : parsedAllocs.some((i) => i.value === null || (i.value ?? 0) > i.balance) ? 'allocation' : allocated > amt ? 'over' : tdsProblem ? 'tds' : null;

  const save = useMutation({
    mutationFn: () => {
      const instrument = mode === 'cheque' || mode === 'dd';
      const base = { contactId, date, bankAccountId: bank, amount: amt!, reference: reference || null, mode: (isCash ? 'cash' : mode) || null, instrumentNo: isCash ? null : instrumentNo || null, instrumentDate: instrument ? instrumentDate || null : null, drawnOn: instrument ? drawnOn || null : null };
      const chosen = parsedAllocs.filter((i) => i.value);
      const tds = tdsActive ? { section, ratePpm, base: baseMinor!, amount: tdsMinor!, accountId: tdsAccount } : null;
      return receipt ? api.receive({ ...base, tds, allocations: chosen.map((i) => ({ invoiceId: i.id, amount: i.value! })) }) : api.pay({ ...base, tds, allocations: chosen.map((i) => ({ billId: i.id, amount: i.value! })) });
    },
    onSuccess: (p) => {
      for (const k of ['payments', 'invoices', 'bills', 'contacts', 'journals', 'reports']) void queryClient.invalidateQueries({ queryKey: [k] });
      toast(t(receipt ? 'payments.received' : 'payments.paidOut', { number: p.number }));
      onDone(p);
    },
    onError: (e) => {
      if (!heldForApproval(e)) return toast(billErrorMessage(e, t), 'error');
      void queryClient.invalidateQueries({ queryKey: ['approvals'] });
      toast(heldMessage(e, t));
      onClose();
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (problem) return toast(t(`payments.problems.${!receipt && ['amount', 'allocation', 'over'].includes(problem) ? `${problem}Paid` : problem}`), 'error');
    save.mutate();
  };
  const suggest = () => {
    if (!amt || !open.data) return;
    setAllocs(Object.fromEntries(allocateOldestFirst(amt, open.data).map((a) => [a.invoiceId, plain(a.amount)])));
  };

  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title={t(receipt ? 'payments.receiveTitle' : 'payments.payTitle')}
      description={t(receipt ? 'payments.receiveBody' : 'payments.payBody')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="receipt-form" loading={save.isPending} disabled={!!problem}>
            {t(receipt ? 'payments.record' : 'payments.recordPay')}
          </Button>
        </>
      }
    >
      <form id="receipt-form" onSubmit={submit} noValidate className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField
            label={t(receipt ? 'invoices.fields.customer' : 'bills.fields.vendor')}
            value={contactId}
            onChange={(e) => {
              setContactId(e.target.value);
              // The vendor's usual TDS section, with its first rate
              const usual = customers.data?.items.find((c) => c.id === e.target.value)?.tdsSection;
              if (usual) {
                setSection(usual);
                setRatePct(String(TDS_SECTIONS.find((x) => x.code === usual)!.rates[0].ppm / 10_000));
                setTdsTouched(false);
              }
            }}
            disabled={!!fixedContact}
            options={[{ value: '', label: t(receipt ? 'invoices.chooseCustomer' : 'bills.chooseVendor') }, ...(customers.data?.items ?? []).map((c) => ({ value: c.id, label: c.currency ? `${c.name} (${c.currency})` : c.name }))]}
          />
          <TextField label={t(receipt ? 'payments.fields.date' : 'payments.fields.datePaid')} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <SelectField label={t(receipt ? 'payments.fields.bank' : 'payments.fields.from')} value={bank} onChange={(e) => setBank(e.target.value)} options={banks.length ? banks.map((a) => ({ value: a.id, label: `${a.code} · ${a.name}${a.currency ? ` (${a.currency})` : ''}` })) : [{ value: '', label: t('payments.noBank') }]} />
          <TextField label={t('payments.fields.amount', { currency: code })} value={amount} onChange={(e) => setAmount(e.target.value)} onBlur={() => amt && setAmount(plain(amt))} inputMode="decimal" dir="ltr" className="text-end font-mono" data-autofocus />
          {!isCash && (
            <>
              <SelectField label={t('payments.fields.mode')} value={mode} onChange={(e) => setMode(e.target.value as PaymentMode | '')} options={[{ value: '', label: t('payments.modes.none') }, ...PAYMENT_MODES.filter((m) => m !== 'cash').map((m) => ({ value: m, label: t(`payments.modes.${m}`) }))]} />
              {mode && mode !== 'card' && mode !== 'other' && <TextField label={t(mode === 'cheque' || mode === 'dd' ? 'payments.fields.chequeNo' : mode === 'upi' ? 'payments.fields.upiRef' : 'payments.fields.utr')} value={instrumentNo} onChange={(e) => setInstrumentNo(e.target.value.toUpperCase())} dir="ltr" className="font-mono" inputMode={mode === 'cheque' || mode === 'dd' || mode === 'upi' ? 'numeric' : undefined} />}
              {(mode === 'cheque' || mode === 'dd') && (
                <>
                  <TextField label={t('payments.fields.chequeDate')} type="date" value={instrumentDate} onChange={(e) => setInstrumentDate(e.target.value)} />
                  <TextField label={t('payments.fields.drawnOn')} value={drawnOn} onChange={(e) => setDrawnOn(e.target.value)} dir="auto" />
                </>
              )}
            </>
          )}
          <div className="sm:col-span-2">
            <TextField label={t('payments.fields.reference')} value={reference} onChange={(e) => setReference(e.target.value)} dir="auto" />
          </div>
        </div>
        {canTds && (
          <fieldset className="space-y-3 rounded-xl border border-ink-200 p-3 dark:border-ink-700">
            <label className="flex items-center gap-2 text-sm font-semibold">
              <input type="checkbox" checked={tdsWanted} onChange={(e) => setTdsWanted(e.target.checked)} className="size-4 rounded accent-brand-600" />
              {t(receipt ? 'payments.tds.deductedByCustomer' : 'payments.tds.deduct')}
            </label>
            {tdsWanted && (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <SelectField
                    label={t('payments.tds.section')}
                    value={section}
                    onChange={(e) => {
                      const next = e.target.value as TdsSection;
                      setSection(next);
                      setRatePct(String(TDS_SECTIONS.find((x) => x.code === next)!.rates[0].ppm / 10_000));
                      setTdsTouched(false);
                    }}
                    options={TDS_SECTIONS.map((x) => ({ value: x.code, label: `${x.code} · ${t(`payments.tds.sections.${x.code}`)}` }))}
                  />
                  <TextField
                    label={t('payments.tds.rate')}
                    value={ratePct}
                    onChange={(e) => {
                      setRatePct(e.target.value);
                      setTdsTouched(false);
                    }}
                    inputMode="decimal"
                    dir="ltr"
                    className="text-end font-mono"
                    hint={TDS_SECTIONS.find((x) => x.code === section)!.rates.map((r) => `${t(`payments.tds.rates.${r.key}`)} ${r.ppm / 10_000}%`).join(' · ')}
                  />
                  <TextField
                    label={t('payments.tds.base', { currency: code })}
                    value={tdsBase}
                    placeholder={plain(suggestedBase)}
                    onChange={(e) => {
                      setTdsBase(e.target.value);
                      setTdsTouched(false);
                    }}
                    inputMode="decimal"
                    dir="ltr"
                    className="text-end font-mono"
                    hint={t('payments.tds.baseHint')}
                  />
                  <TextField label={t(receipt ? 'payments.tds.amountByCustomer' : 'payments.tds.amount', { currency: code })} value={tdsTouched ? tdsAmount : tdsMinor ? plain(tdsMinor) : ''} onChange={(e) => { setTdsAmount(e.target.value); setTdsTouched(true); }} inputMode="decimal" dir="ltr" className="text-end font-mono" />
                  <div className="sm:col-span-2">
                    <SelectField label={t(receipt ? 'payments.tds.accountReceivable' : 'payments.tds.account')} value={tdsAccount} onChange={(e) => setTdsAccountId(e.target.value)} options={tdsAccounts.length ? tdsAccounts.map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` })) : [{ value: '', label: t(receipt ? 'payments.tds.noAccountReceivable' : 'payments.tds.noAccount') }]} />
                  </div>
                </div>
                {amt && tdsMinor ? (
                  <p role="status" className={`text-sm ${tdsMinor >= amt ? 'text-expense' : 'text-ink-600 dark:text-ink-300'}`}>
                    {tdsMinor >= amt ? t('payments.tds.tooMuch') : t(receipt ? 'payments.tds.bankGets' : 'payments.tds.bankPays', { bank: `${code} ${plain(amt - tdsMinor)}`, tds: `${code} ${plain(tdsMinor)}` })}
                  </p>
                ) : null}
              </>
            )}
          </fieldset>
        )}
        {contactId && (
          <fieldset className="space-y-2">
            <div className="flex items-center gap-2">
              <legend className="flex-1 text-sm font-semibold">{t(receipt ? 'payments.allocate' : 'payments.allocateBills')}</legend>
              {!!open.data?.length && (
                <Button type="button" size="sm" variant="ghost" onClick={suggest} disabled={!amt}>
                  {t('payments.oldestFirst')}
                </Button>
              )}
            </div>
            {!open.data?.length ? (
              <p className="text-sm text-ink-500">{t(receipt ? 'payments.nothingOpen' : 'payments.nothingToPay')}</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-wide text-ink-400">
                  <tr>
                    <th scope="col" className="py-1.5 text-start font-semibold">
                      {t('invoices.columns.number')}
                    </th>
                    <th scope="col" className="py-1.5 text-start font-semibold">
                      {t('invoices.fields.dueDate')}
                    </th>
                    <th scope="col" className="py-1.5 text-end font-semibold">
                      {t('invoices.balanceDue')}
                    </th>
                    <th scope="col" className="w-36 py-1.5 text-end font-semibold">
                      {t('payments.fields.apply')}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
                  {parsedAllocs.map((i) => (
                    <tr key={i.id}>
                      <td className="py-1.5 font-mono" dir="ltr">
                        {i.number}
                        {i.vendorReference && <span className="block font-sans text-xs text-ink-500">{i.vendorReference}</span>}
                      </td>
                      <td className="py-1.5 text-ink-600 dark:text-ink-300">{formatDate(`${i.dueDate}T00:00:00Z`, locale)}</td>
                      <td className="py-1.5 text-end font-mono tabular-nums" dir="ltr">
                        {plain(i.balance)}
                      </td>
                      <td className="py-1">
                        <input
                          aria-label={t('payments.applyTo', { number: i.number })}
                          value={allocs[i.id] ?? ''}
                          onChange={(e) => setAllocs((a) => ({ ...a, [i.id]: e.target.value }))}
                          inputMode="decimal"
                          dir="ltr"
                          className={`h-8 w-full rounded-lg border bg-white px-2 text-end font-mono text-sm dark:bg-ink-900 ${i.value === null || (i.value ?? 0) > i.balance ? 'border-expense' : 'border-ink-200 dark:border-ink-700'}`}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {amt ? (
              <p role="status" className={`text-sm ${allocated > amt ? 'text-expense' : 'text-ink-500'}`}>
                {allocated > amt ? t(receipt ? 'payments.problems.over' : 'payments.problems.overPaid') : amt - allocated > 0 ? t('payments.leftOver', { amount: `${code} ${plain(amt - allocated)}` }) : t('payments.allAllocated')}
              </p>
            ) : null}
          </fieldset>
        )}
      </form>
    </Modal>
  );
}
