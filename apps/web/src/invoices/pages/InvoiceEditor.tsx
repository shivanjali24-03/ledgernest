import { useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { motion } from 'motion/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { currencyDigits, dueDateFor, findIndianState, INDIAN_STATES, invoiceAmounts, percentToPpm, parseQuantity, toMinor, todayIn } from '@ledgernest/shared';
import { ArrowLeft, Ban, FileMinus, HandCoins, Plus, Printer, Repeat, Send, Trash2, X } from 'lucide-react';
import RecurringDialog from '../../recurring/RecurringDialog';
import { templateOf } from '../../recurring/templateOf';
import { useRecurringApi } from '../../recurring/useRecurringApi';
import CreditNoteDialog from '../../credit-notes/CreditNoteDialog';
import { useCreditNotesApi } from '../../credit-notes/useCreditNotesApi';
import ReceiptDialog from '../../payments/ReceiptDialog';
import { usePaymentsApi } from '../../payments/usePaymentsApi';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { useContactsApi } from '../../contacts/useContactsApi';
import { useIntlLocale } from '../../i18n';
import { useItemsApi } from '../../items/useItemsApi';
import { useSession } from '../../layout/session';
import { fadeUp, stagger } from '../../motion/tokens';
import { useOrganizationSettings } from '../../settings/useOrganizationSettings';
import { useTaxesApi } from '../../taxes/useTaxesApi';
import Button from '../../ui/Button';
import ConfirmDialog from '../../ui/ConfirmDialog';
import { inputClass, SelectField, TextField } from '../../ui/Field';
import { Card, ErrorState, PageHeader, Pill, SkeletonRows } from '../../ui/Kit';
import { useToast } from '../../ui/toastContext';
import InvoiceDocument from '../InvoiceDocument';
import { invoiceErrorMessage } from '../errors';
import { groupForSupply, supplyFor } from '../gst';
import { stateTone } from '../state';
import type { Invoice, InvoicesApi } from '../types';
import { useInvoicesApi } from '../useInvoicesApi';
import CostCentreSelect from '../../cost-centres/CostCentreSelect';
import { useCostCentres } from '../../cost-centres/useCostCentresApi';
import DocumentAttachments from '../../attachments/DocumentAttachments';

type Line = { key: string; itemId: string; description: string; quantity: string; unitPrice: string; discount: string; taxGroupId: string; accountId: string; costCentreId: string };
const blankLine = (): Line => ({ key: crypto.randomUUID(), itemId: '', description: '', quantity: '1', unitPrice: '', discount: '', taxGroupId: '', accountId: '', costCentreId: '' });

/** A draft: choose the customer, add lines from items, see GST worked out as you type, save or issue. */
function DraftForm({ invoice, api }: { invoice: Invoice | null; api: InvoicesApi }) {
  const { t } = useTranslation();
  const locale = useIntlLocale();
  const session = useSession();
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const settings = useOrganizationSettings().data;
  const contactsApi = useContactsApi();
  const itemsApi = useItemsApi();
  const taxesApi = useTaxesApi();
  const centres = useCostCentres(true).data ?? [];
  const role = session.role ?? session.customRoleName;
  const customers = useQuery({ queryKey: ['contacts', session.organizationId, role, 'customers'], queryFn: () => contactsApi!.list({ type: 'customer', page: 1, pageSize: 100 }), enabled: !!contactsApi });
  const items = useQuery({ queryKey: ['items', session.organizationId, role, 'active'], queryFn: () => itemsApi!.list({}), enabled: !!itemsApi });
  const taxes = useQuery({ queryKey: ['taxes', session.organizationId, role], queryFn: () => taxesApi!.list(), enabled: !!taxesApi });
  const canManage = session.permissions.has('invoices.manage');

  const [contactId, setContactId] = useState(invoice?.contact.id ?? '');
  const customer = customers.data?.items.find((c) => c.id === contactId) ?? null;
  const currency = (invoice ? invoice.currency : customer?.currency) ?? settings?.baseCurrency ?? 'INR';
  const digits = currencyDigits(currency);
  const plain = (minor: number) => new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(minor / 10 ** digits);
  const [issueDate, setIssueDate] = useState(invoice?.issueDate ?? todayIn(settings?.timeZone ?? 'Asia/Kolkata'));
  const [dueDate, setDueDate] = useState(invoice?.dueDate ?? '');
  const [reference, setReference] = useState(invoice?.reference ?? '');
  const [notes, setNotes] = useState(invoice?.notes ?? '');
  const [placeOfSupply, setPlaceOfSupply] = useState(invoice?.placeOfSupply ?? '');
  const [lines, setLines] = useState<Line[]>(
    invoice?.lines.length
      ? invoice.lines.map((l) => ({ key: l.id, itemId: l.item?.id ?? '', description: l.description, quantity: l.quantity, unitPrice: plain(l.unitPrice), discount: l.discount ? String(l.discount) : '', taxGroupId: l.taxGroup?.id ?? '', accountId: l.account?.id ?? '', costCentreId: l.costCentre?.id ?? '' }))
      : [blankLine()],
  );
  const [deleting, setDeleting] = useState(false);

  const india = settings?.country === 'IN';
  const orgState = india ? (findIndianState(settings?.address.region)?.code ?? null) : null;
  const pos = placeOfSupply || customer?.stateCode || null;
  const supply = supplyFor(orgState, pos);
  const groups = useMemo(() => taxes.data?.groups ?? [], [taxes.data]);
  const set = (key: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const pickItem = (key: string, itemId: string) => {
    const item = items.data?.find((x) => x.id === itemId);
    // An item fills in its description, price, tax and account; prices are in the base currency
    set(key, item ? { itemId, description: item.name, unitPrice: item.salePrice !== null && !customer?.currency ? plain(item.salePrice) : '', taxGroupId: item.taxGroupId ?? '', accountId: item.incomeAccountId ?? '' } : { itemId: '' });
  };

  const parsed = lines.map((l) => {
    const price = toMinor(l.unitPrice, digits);
    const qty = parseQuantity(l.quantity);
    const disc = l.discount.trim() ? percentToPpm(l.discount) : 0;
    const chosen = groups.find((g) => g.id === l.taxGroupId);
    const group = chosen ? groupForSupply(chosen, supply, groups) : null;
    return { ...l, price, qty, disc, group, invalid: price === null || qty === null || disc === null };
  });
  const filled = parsed.filter((l) => l.description.trim() || l.price);
  const amounts = invoiceAmounts(filled.filter((l) => !l.invalid).map((l) => ({ quantity: l.quantity, unitPrice: l.price!, discountPpm: l.disc!, rates: (l.group?.rates ?? []).map((r) => ({ rateId: r.id, ratePpm: r.ratePpm })) })));
  const breakdown = new Map<string, number>();
  filled
    .filter((l) => !l.invalid)
    .forEach((l, n) =>
      (l.group?.rates ?? []).forEach((r, k) => {
        const amount = amounts.lines[n]!.taxes[k]?.amount ?? 0;
        if (amount) breakdown.set(r.name, (breakdown.get(r.name) ?? 0) + amount);
      }),
    );
  const autoDue = customer ? dueDateFor(issueDate, customer.paymentTermsDays) : '';

  const payload = () => ({
    contactId,
    issueDate,
    dueDate: dueDate || null,
    reference,
    notes,
    placeOfSupply: placeOfSupply || null,
    lines: filled.map((l) => ({ itemId: l.itemId || null, description: l.description, quantity: l.quantity, unitPrice: l.price ?? 0, discount: l.discount || 0, taxGroupId: l.group?.id ?? null, accountId: l.accountId || null, costCentreId: l.costCentreId || null })),
  });
  const save = useMutation({
    mutationFn: async (andIssue: boolean) => {
      const saved = invoice ? await api.update(invoice.id, payload()) : await api.create(payload());
      return andIssue ? api.issue(saved.id) : saved;
    },
    onSuccess: (i, andIssue) => {
      for (const key of ['invoices', 'journals', 'journal', 'reports']) void queryClient.invalidateQueries({ queryKey: [key] });
      toast(andIssue ? t('invoices.issued', { number: i.number }) : t('invoices.saved'));
      navigate(`/invoices/${i.id}`, { replace: true });
    },
    onError: (e) => toast(invoiceErrorMessage(e, t), 'error'),
  });
  const remove = useMutation({
    mutationFn: () => api.remove(invoice!.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['invoices'] });
      toast(t('invoices.deleted'));
      navigate('/invoices');
    },
    onError: (e) => toast(invoiceErrorMessage(e, t), 'error'),
  });
  const problem = !contactId ? 'customer' : !filled.length ? 'lines' : filled.some((l) => l.invalid) ? 'amounts' : null;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (problem) return toast(t(`invoices.problems.${problem}`), 'error');
    save.mutate(false);
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <Card className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
        <div className="sm:col-span-2">
          <SelectField
            label={t('invoices.fields.customer')}
            value={contactId}
            onChange={(e) => setContactId(e.target.value)}
            disabled={!canManage}
            options={[{ value: '', label: t('invoices.chooseCustomer') }, ...(customers.data?.items ?? []).map((c) => ({ value: c.id, label: c.currency ? `${c.name} (${c.currency})` : c.name }))]}
            hint={customer?.currency ? t('invoices.foreignHint', { code: customer.currency }) : undefined}
          />
        </div>
        <TextField label={t('invoices.fields.issueDate')} type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} disabled={!canManage} />
        <TextField label={t('invoices.fields.dueDate')} type="date" value={dueDate || autoDue} onChange={(e) => setDueDate(e.target.value)} disabled={!canManage} hint={!dueDate && customer ? t('invoices.dueHint', { days: customer.paymentTermsDays }) : undefined} />
        <TextField label={t('invoices.fields.reference')} value={reference} onChange={(e) => setReference(e.target.value)} disabled={!canManage} placeholder="PO-4471" dir="auto" />
        {india && (
          <SelectField
            label={t('invoices.fields.placeOfSupply')}
            value={placeOfSupply || customer?.stateCode || ''}
            onChange={(e) => setPlaceOfSupply(e.target.value)}
            disabled={!canManage}
            options={[{ value: '', label: t('invoices.outsideIndia') }, ...INDIAN_STATES.map((s) => ({ value: s.code, label: `${s.code} · ${s.name}` }))]}
            hint={supply ? t(`invoices.supply.${supply}`) : undefined}
          />
        )}
      </Card>

      <Card className="overflow-hidden">
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[980px] text-sm">
            <thead className="border-b border-ink-100 text-xs uppercase tracking-wide text-ink-400 dark:border-ink-800">
              <tr>
                <th scope="col" className="w-48 px-3 py-2 text-start font-semibold">
                  {t('invoices.columns.item')}
                </th>
                <th scope="col" className="px-3 py-2 text-start font-semibold">
                  {t('invoices.columns.description')}
                </th>
                <th scope="col" className="w-20 px-3 py-2 text-end font-semibold">
                  {t('invoices.columns.qty')}
                </th>
                <th scope="col" className="w-32 px-3 py-2 text-end font-semibold">
                  {t('invoices.columns.price', { currency })}
                </th>
                <th scope="col" className="w-20 px-3 py-2 text-end font-semibold">
                  {t('invoices.columns.discount')}
                </th>
                <th scope="col" className="w-36 px-3 py-2 text-start font-semibold">
                  {t('invoices.columns.tax')}
                </th>
                <th scope="col" className="w-32 px-3 py-2 text-end font-semibold">
                  {t('invoices.columns.amount')}
                </th>
                <th scope="col" className="w-10">
                  <span className="sr-only">{t('journals.removeLine')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {parsed.map((l, n) => {
                const cell = clsx(inputClass, 'h-9 border-ink-200 dark:border-ink-700');
                const amount = !l.invalid && l.price !== null ? amounts.lines[filled.filter((x) => !x.invalid).indexOf(l)]?.net : undefined;
                return (
                  <tr key={l.key} className="align-top">
                    <td className="px-3 py-1.5">
                      <select aria-label={t('invoices.lineItem', { n: n + 1 })} value={l.itemId} disabled={!canManage} onChange={(e) => pickItem(l.key, e.target.value)} className={cell}>
                        <option value="">{t('invoices.noItem')}</option>
                        {(items.data ?? []).map((i) => (
                          <option key={i.id} value={i.id}>
                            {i.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-1.5">
                      <input aria-label={t('invoices.lineDescription', { n: n + 1 })} value={l.description} disabled={!canManage} onChange={(e) => set(l.key, { description: e.target.value })} dir="auto" className={cell} />
                      <CostCentreSelect centres={centres} value={l.costCentreId} onChange={(v) => set(l.key, { costCentreId: v })} label={t('costCentres.lineLabel', { n: n + 1 })} disabled={!canManage} />
                    </td>
                    <td className="px-3 py-1.5">
                      <input aria-label={t('invoices.lineQty', { n: n + 1 })} value={l.quantity} disabled={!canManage} onChange={(e) => set(l.key, { quantity: e.target.value })} inputMode="decimal" dir="ltr" className={clsx(cell, 'text-end font-mono', l.qty === null && 'border-expense')} />
                    </td>
                    <td className="px-3 py-1.5">
                      <input aria-label={t('invoices.linePrice', { n: n + 1 })} value={l.unitPrice} disabled={!canManage} onChange={(e) => set(l.key, { unitPrice: e.target.value })} onBlur={() => l.price && set(l.key, { unitPrice: plain(l.price) })} inputMode="decimal" dir="ltr" className={clsx(cell, 'text-end font-mono', l.price === null && 'border-expense')} />
                    </td>
                    <td className="px-3 py-1.5">
                      <input aria-label={t('invoices.lineDiscount', { n: n + 1 })} value={l.discount} disabled={!canManage} onChange={(e) => set(l.key, { discount: e.target.value })} inputMode="decimal" dir="ltr" placeholder="0" className={clsx(cell, 'text-end font-mono', l.disc === null && 'border-expense')} />
                    </td>
                    <td className="px-3 py-1.5">
                      <select aria-label={t('invoices.lineTax', { n: n + 1 })} value={l.group?.id ?? ''} disabled={!canManage} onChange={(e) => set(l.key, { taxGroupId: e.target.value })} className={cell}>
                        <option value="">{t('journals.tax.none')}</option>
                        {groups
                          .filter((g) => !g.archived && (!supply || !g.supply || g.supply === supply))
                          .map((g) => (
                            <option key={g.id} value={g.id}>
                              {g.name}
                            </option>
                          ))}
                      </select>
                    </td>
                    <td className="px-3 py-2.5 text-end font-mono tabular-nums" dir="ltr">
                      {amount !== undefined ? plain(amount) : ''}
                    </td>
                    <td className="py-1.5 pe-2">
                      {canManage && lines.length > 1 && (
                        <button type="button" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} aria-label={t('journals.removeLineN', { n: n + 1 })} className="grid size-9 place-items-center rounded-lg text-ink-400 hover:bg-ink-100 hover:text-expense dark:hover:bg-ink-800">
                          <X className="size-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-start gap-6 border-t border-ink-100 p-4 dark:border-ink-800">
          {canManage && (
            <Button type="button" size="sm" variant="ghost" icon={<Plus className="size-4" />} onClick={() => setLines((ls) => [...ls, blankLine()])}>
              {t('journals.addLine')}
            </Button>
          )}
          <dl className="ms-auto grid min-w-64 grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-sm" role="status" aria-label={t('invoices.totals')}>
            <dt className="text-ink-500">{t('invoices.subtotal')}</dt>
            <dd className="text-end font-mono tabular-nums" dir="ltr">
              {plain(amounts.subtotal)}
            </dd>
            {[...breakdown].map(([name, value]) => (
              <div key={name} className="contents">
                <dt className="text-ink-500">{name}</dt>
                <dd className="text-end font-mono tabular-nums" dir="ltr">
                  {plain(value)}
                </dd>
              </div>
            ))}
            <dt className="border-t border-ink-200 pt-1 font-semibold dark:border-ink-700">{t('invoices.total')}</dt>
            <dd className="border-t border-ink-200 pt-1 text-end font-mono font-semibold tabular-nums dark:border-ink-700" dir="ltr">
              {currency} {plain(amounts.total)}
            </dd>
          </dl>
        </div>
      </Card>

      <Card className="p-5">
        <TextField label={t('invoices.fields.notes')} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={!canManage} dir="auto" placeholder={t('invoices.notesPlaceholder')} />
      </Card>

      {canManage && (
        <div className="flex flex-wrap items-center gap-2">
          {invoice && (
            <Button type="button" variant="ghost" icon={<Trash2 className="size-4" />} onClick={() => setDeleting(true)}>
              {t('invoices.deleteDraft')}
            </Button>
          )}
          <span className="flex-1" />
          <Button type="submit" variant="secondary" loading={save.isPending && save.variables === false}>
            {t('invoices.saveDraft')}
          </Button>
          <Button type="button" icon={<Send className="size-4 rtl:-scale-x-100" />} disabled={!!problem} loading={save.isPending && save.variables === true} onClick={() => save.mutate(true)}>
            {t('invoices.issue')}
          </Button>
        </div>
      )}
      <ConfirmDialog open={deleting} title={t('invoices.deleteTitle')} body={t('invoices.deleteBody')} confirmLabel={t('invoices.deleteDraft')} tone="danger" busy={remove.isPending} onConfirm={() => remove.mutate()} onClose={() => setDeleting(false)} />
    </form>
  );
}

/** One invoice: a new or draft one to edit, or an issued one to read, print or void. */
export default function InvoiceEditor() {
  const { t } = useTranslation();
  const { id } = useParams();
  const session = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();
  const api = useInvoicesApi();
  const isNew = !id || id === 'new';
  const key = ['invoices', session.organizationId, 'one', id] as const;
  const query = useQuery({ queryKey: key, queryFn: () => api!.get(id!), enabled: !!api && !isNew });
  const invoice = query.data;
  const [voiding, setVoiding] = useState(false);
  const [receiving, setReceiving] = useState(false);
  const [crediting, setCrediting] = useState(false);
  const [repeating, setRepeating] = useState(false);
  const recurringApi = useRecurringApi();
  const creditNotesApi = useCreditNotesApi();
  const paymentsApi = usePaymentsApi();
  const canReceive = session.permissions.has('payments.manage');
  const voidIt = useMutation({
    mutationFn: (reason?: string) => api!.void(invoice!.id, { reason }),
    onSuccess: (i) => {
      setVoiding(false);
      queryClient.setQueryData(key, i);
      for (const k of ['invoices', 'journals', 'reports']) void queryClient.invalidateQueries({ queryKey: [k] });
      toast(t('invoices.voided', { number: i.number }));
    },
    onError: (e) => {
      setVoiding(false);
      toast(invoiceErrorMessage(e, t), 'error');
    },
  });
  const canManage = session.permissions.has('invoices.manage');
  const title = isNew ? t('invoices.newTitle') : (invoice?.number ?? t('invoices.draftTitle'));

  return (
    <motion.div variants={stagger(0.06)} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={fadeUp} className="print:hidden">
        <Link to="/invoices" className="mb-2 inline-flex items-center gap-1 text-sm text-ink-500 hover:text-ink-800 dark:hover:text-ink-200">
          <ArrowLeft className="size-4 rtl:-scale-x-100" aria-hidden /> {t('invoices.title')}
        </Link>
        <PageHeader
          title={title}
          description={invoice && invoice.status !== 'draft' ? undefined : t('invoices.draftHint')}
          actions={
            invoice ? (
              <>
                <Pill tone={invoice.status === 'issued' ? 'brand' : 'neutral'}>
                  <span className={stateTone(invoice.state)}>{t(`invoices.states.${invoice.state}`)}</span>
                </Pill>
                {invoice.status !== 'draft' && (
                  <Button variant="secondary" icon={<Printer className="size-4" />} onClick={() => window.print()}>
                    {t('invoices.print')}
                  </Button>
                )}
                {invoice.status === 'issued' && canReceive && invoice.balance > 0 && (
                  <Button icon={<HandCoins className="size-4" />} onClick={() => setReceiving(true)}>
                    {t('payments.recordPayment')}
                  </Button>
                )}
                {invoice.status !== 'void' && canManage && (
                  <Button variant="ghost" icon={<Repeat className="size-4" />} onClick={() => setRepeating(true)}>
                    {t('recurring.makeRecurring')}
                  </Button>
                )}
                {invoice.status === 'issued' && canManage && (
                  <Button variant="secondary" icon={<FileMinus className="size-4" />} onClick={() => setCrediting(true)}>
                    {t('creditNotes.new')}
                  </Button>
                )}
                {invoice.status === 'issued' && canManage && invoice.amountPaid === 0 && (
                  <Button variant="ghost" icon={<Ban className="size-4" />} onClick={() => setVoiding(true)}>
                    {t('invoices.void')}
                  </Button>
                )}
              </>
            ) : undefined
          }
        />
      </motion.div>
      <motion.div variants={fadeUp} className="space-y-4">
        {!api ? null : isNew ? (
          <DraftForm key="new" invoice={null} api={api} />
        ) : query.isPending ? (
          <Card>
            <SkeletonRows rows={6} />
          </Card>
        ) : query.isError ? (
          <Card>
            <ErrorState onRetry={() => void query.refetch()} />
          </Card>
        ) : invoice!.status === 'draft' ? (
          <DraftForm key={invoice!.id} invoice={invoice!} api={api} />
        ) : (
          <>
            <InvoiceDocument invoice={invoice!} />
            <p className="text-sm text-ink-500 print:hidden">
              {invoice!.journalEntry && (
                <>
                  {t('invoices.postedAs')}{' '}
                  <Link to={`/journals/${invoice!.journalEntry.id}`} className="font-mono font-semibold text-brand-700 hover:underline dark:text-brand-300" dir="ltr">
                    {invoice!.journalEntry.number}
                  </Link>
                </>
              )}
              {invoice!.payments.map((p) => (
                <span key={p.id}>
                  {' · '}
                  {t('payments.paidBy')}{' '}
                  <span className="font-mono" dir="ltr">
                    {p.number}
                  </span>
                </span>
              ))}
              {invoice!.recurring && (
                <>
                  {' · '}
                  {t('recurring.raisedBy')}{' '}
                  <Link to="/recurring" className="hover:underline" dir="auto">
                    {invoice!.recurring.name}
                  </Link>
                </>
              )}
              {invoice!.credits.map((c, n) => (
                <span key={`${c.id}-${n}`}>
                  {' · '}
                  {t('creditNotes.creditedBy')}{' '}
                  <Link to="/credit-notes" className="font-mono hover:underline" dir="ltr">
                    {c.number}
                  </Link>
                </span>
              ))}
              {invoice!.creditNotes
                .filter((c) => c.status === 'issued' && !invoice!.credits.some((x) => x.id === c.id))
                .map((c) => (
                  <span key={c.id}>
                    {' · '}
                    {t('creditNotes.creditedBy')}{' '}
                    <Link to="/credit-notes" className="font-mono hover:underline" dir="ltr">
                      {c.number}
                    </Link>
                  </span>
                ))}
              {invoice!.voidEntry && (
                <>
                  {' · '}
                  {t('invoices.voidedBy')}{' '}
                  <Link to={`/journals/${invoice!.voidEntry.id}`} className="font-mono font-semibold text-brand-700 hover:underline dark:text-brand-300" dir="ltr">
                    {invoice!.voidEntry.number}
                  </Link>
                </>
              )}
            </p>
          </>
        )}
        {invoice && <DocumentAttachments documentType="invoice" documentId={invoice.id} />}
      </motion.div>
      {repeating && invoice && recurringApi && <RecurringDialog api={recurringApi} template={templateOf(invoice)} onClose={() => setRepeating(false)} onSaved={() => setRepeating(false)} />}
      {crediting && invoice && creditNotesApi && (
        <CreditNoteDialog
          invoice={invoice}
          api={creditNotesApi}
          onClose={() => setCrediting(false)}
          onDone={() => {
            setCrediting(false);
            void queryClient.invalidateQueries({ queryKey: key });
          }}
        />
      )}
      {receiving && invoice && paymentsApi && (
        <ReceiptDialog
          api={paymentsApi}
          contactId={invoice.contact.id}
          documentId={invoice.id}
          onClose={() => setReceiving(false)}
          onDone={() => {
            setReceiving(false);
            void queryClient.invalidateQueries({ queryKey: key });
          }}
        />
      )}
      <ConfirmDialog
        open={voiding}
        title={invoice ? t('invoices.voidTitle', { number: invoice.number }) : ''}
        body={t('invoices.voidBody')}
        confirmLabel={t('invoices.void')}
        tone="danger"
        askReason
        busy={voidIt.isPending}
        onConfirm={(reason) => voidIt.mutate(reason)}
        onClose={() => setVoiding(false)}
      />
    </motion.div>
  );
}
