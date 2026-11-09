import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { allocateOldestFirst, currencyDigits, toMinor, todayIn } from '@ledgernest/shared';
import { useTranslation } from 'react-i18next';
import { useAccountsApi } from '../accounts/useAccountsApi';
import { useContactsApi } from '../contacts/useContactsApi';
import { useIntlLocale } from '../i18n';
import { invoiceErrorMessage } from '../invoices/errors';
import { formatDate } from '../lib/format';
import { useSession } from '../layout/session';
import { useOrganizationSettings } from '../settings/useOrganizationSettings';
import Button from '../ui/Button';
import { SelectField, TextField } from '../ui/Field';
import Modal from '../ui/Modal';
import { useToast } from '../ui/toastContext';
import type { Payment, PaymentsApi } from './types';

/**
 * Record money received from a customer, allocated to their open invoices. Opened from an invoice it starts
 * with that invoice's balance; otherwise it suggests paying the oldest invoices first.
 */
export default function ReceiptDialog({ api, contactId: fixedContact, invoiceId, onClose, onDone }: { api: PaymentsApi; contactId?: string; invoiceId?: string; onClose: () => void; onDone: (p: Payment) => void }) {
  const { t } = useTranslation();
  const locale = useIntlLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const session = useSession();
  const settings = useOrganizationSettings().data;
  const role = session.role ?? session.customRoleName;
  const contactsApi = useContactsApi();
  const accountsApi = useAccountsApi();
  const customers = useQuery({ queryKey: ['contacts', session.organizationId, role, 'customers'], queryFn: () => contactsApi!.list({ type: 'customer', page: 1, pageSize: 100 }), enabled: !!contactsApi });
  const accounts = useQuery({ queryKey: ['accounts', session.organizationId, role, 'all'], queryFn: () => accountsApi!.list(true), enabled: !!accountsApi });
  const [contactId, setContactId] = useState(fixedContact ?? '');
  const contact = customers.data?.items.find((c) => c.id === contactId);
  const currency = contact?.currency ?? null;
  const code = currency ?? settings?.baseCurrency ?? 'INR';
  const digits = currencyDigits(code);
  const plain = (minor: number) => new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(minor / 10 ** digits);
  const open = useQuery({ queryKey: ['payments', session.organizationId, 'open', contactId], queryFn: () => api.openInvoices(contactId), enabled: !!contactId });

  const banks = useMemo(() => (accounts.data ?? []).filter((a) => a.type === 'asset' && (a.subtype === 'bank' || a.subtype === 'cash') && !a.archived && (!a.currency || a.currency === currency)), [accounts.data, currency]);
  const [bankAccountId, setBank] = useState('');
  const [date, setDate] = useState(() => todayIn(settings?.timeZone ?? 'Asia/Kolkata'));
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  // Allocation per invoice, as typed; filled from the invoice it was opened from, or oldest first
  const [allocs, setAllocs] = useState<Record<string, string>>({});
  const [seeded, setSeeded] = useState<string | null>(null);
  if (open.data && seeded !== contactId) {
    setSeeded(contactId);
    const start = invoiceId ? open.data.filter((i) => i.id === invoiceId) : [];
    const total = start.reduce((s, i) => s + i.balance, 0);
    setAllocs(Object.fromEntries(start.map((i) => [i.id, plain(i.balance)])));
    if (total) setAmount(plain(total));
  }
  const bank = bankAccountId || banks[0]?.id || '';
  const amt = toMinor(amount, digits);
  const parsedAllocs = (open.data ?? []).map((i) => ({ ...i, value: allocs[i.id]?.trim() ? toMinor(allocs[i.id]!, digits) : 0 }));
  const allocated = parsedAllocs.reduce((s, i) => s + (i.value ?? 0), 0);
  const problem = !contactId ? 'customer' : !bank ? 'bank' : !amt ? 'amount' : parsedAllocs.some((i) => i.value === null || (i.value ?? 0) > i.balance) ? 'allocation' : allocated > amt ? 'over' : null;

  const save = useMutation({
    mutationFn: () => api.receive({ contactId, date, bankAccountId: bank, amount: amt!, reference: reference || null, allocations: parsedAllocs.filter((i) => i.value).map((i) => ({ invoiceId: i.id, amount: i.value! })) }),
    onSuccess: (p) => {
      for (const k of ['payments', 'invoices', 'contacts', 'journals', 'reports']) void queryClient.invalidateQueries({ queryKey: [k] });
      toast(t('payments.received', { number: p.number }));
      onDone(p);
    },
    onError: (e) => toast(invoiceErrorMessage(e, t), 'error'),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (problem) return toast(t(`payments.problems.${problem}`), 'error');
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
      title={t('payments.receiveTitle')}
      description={t('payments.receiveBody')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="receipt-form" loading={save.isPending} disabled={!!problem}>
            {t('payments.record')}
          </Button>
        </>
      }
    >
      <form id="receipt-form" onSubmit={submit} noValidate className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField
            label={t('invoices.fields.customer')}
            value={contactId}
            onChange={(e) => setContactId(e.target.value)}
            disabled={!!fixedContact}
            options={[{ value: '', label: t('invoices.chooseCustomer') }, ...(customers.data?.items ?? []).map((c) => ({ value: c.id, label: c.currency ? `${c.name} (${c.currency})` : c.name }))]}
          />
          <TextField label={t('payments.fields.date')} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <SelectField label={t('payments.fields.bank')} value={bank} onChange={(e) => setBank(e.target.value)} options={banks.length ? banks.map((a) => ({ value: a.id, label: `${a.code} · ${a.name}${a.currency ? ` (${a.currency})` : ''}` })) : [{ value: '', label: t('payments.noBank') }]} />
          <TextField label={t('payments.fields.amount', { currency: code })} value={amount} onChange={(e) => setAmount(e.target.value)} onBlur={() => amt && setAmount(plain(amt))} inputMode="decimal" dir="ltr" className="text-end font-mono" data-autofocus />
          <div className="sm:col-span-2">
            <TextField label={t('payments.fields.reference')} value={reference} onChange={(e) => setReference(e.target.value)} placeholder="UTR 402918" dir="auto" />
          </div>
        </div>
        {contactId && (
          <fieldset className="space-y-2">
            <div className="flex items-center gap-2">
              <legend className="flex-1 text-sm font-semibold">{t('payments.allocate')}</legend>
              {!!open.data?.length && (
                <Button type="button" size="sm" variant="ghost" onClick={suggest} disabled={!amt}>
                  {t('payments.oldestFirst')}
                </Button>
              )}
            </div>
            {!open.data?.length ? (
              <p className="text-sm text-ink-500">{t('payments.nothingOpen')}</p>
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
                {allocated > amt ? t('payments.problems.over') : amt - allocated > 0 ? t('payments.leftOver', { amount: `${code} ${plain(amt - allocated)}` }) : t('payments.allAllocated')}
              </p>
            ) : null}
          </fieldset>
        )}
      </form>
    </Modal>
  );
}
