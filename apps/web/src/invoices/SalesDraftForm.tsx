import { useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { currencyDigits, findIndianState, INDIAN_STATES, invoiceAmounts, percentToPpm, parseQuantity, toMinor, todayIn } from '@ledgernest/shared';
import { Plus, Send, Trash2, X } from 'lucide-react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { useContactsApi } from '../contacts/useContactsApi';
import type { Contact } from '../contacts/types';
import CostCentreSelect from '../cost-centres/CostCentreSelect';
import { useCostCentres } from '../cost-centres/useCostCentresApi';
import { useIntlLocale } from '../i18n';
import { useItemsApi } from '../items/useItemsApi';
import { useSession } from '../layout/session';
import { useOrganizationSettings } from '../settings/useOrganizationSettings';
import { useTaxesApi } from '../taxes/useTaxesApi';
import Button from '../ui/Button';
import ConfirmDialog from '../ui/ConfirmDialog';
import { inputClass, SelectField, TextField } from '../ui/Field';
import { Card } from '../ui/Kit';
import { useToast } from '../ui/toastContext';
import { groupForSupply, supplyFor } from './gst';

/** What the form starts from: an invoice's or a quote's own fields under shared names */
export interface SalesDraft {
  contactId: string;
  /** Issue date, or quote date; none for a copy (dated today) */
  date?: string;
  /** Due date, or expiry date */
  until: string | null;
  reference: string | null;
  notes: string | null;
  placeOfSupply: string | null;
  currency: string | null;
  lines: { id: string; item: { id: string } | null; description: string; quantity: string; unitPrice: number; discount: number; taxGroup: { id: string } | null; account: { id: string } | null; costCentre?: { id: string } | null }[];
}
export interface SalesDraftPayload {
  contactId: string;
  date: string;
  until: string | null;
  reference: string;
  notes: string;
  placeOfSupply: string | null;
  lines: { itemId: string | null; description: string; quantity: string; unitPrice: number; discount: string | number; taxGroupId: string | null; accountId: string | null; costCentreId: string | null }[];
}
export interface SalesDraftConfig {
  initial: SalesDraft | null;
  /** Saves it, and with `extra` issues it (invoice) or marks it sent (quote); returns where to go and what to say */
  save: (payload: SalesDraftPayload, extra: boolean) => Promise<{ id: string; message: string }>;
  remove?: () => Promise<void>;
  errorMessage: (e: unknown) => string;
  path: (id: string) => string;
  listPath: string;
  /** Query keys to refresh after a change */
  invalidate: string[];
  /** The second date when left blank: the due date from payment terms, or the expiry date */
  autoUntil: (date: string, customer: Contact | null) => string;
  untilHint: (customer: Contact | null) => string | undefined;
  labels: { date: string; until: string; save: string; extra: string; delete: string; deleteTitle: string; deleteBody: string; deleted: string };
}

type Line = { key: string; itemId: string; description: string; quantity: string; unitPrice: string; discount: string; taxGroupId: string; accountId: string; costCentreId: string };
const blankLine = (): Line => ({ key: crypto.randomUUID(), itemId: '', description: '', quantity: '1', unitPrice: '', discount: '', taxGroupId: '', accountId: '', costCentreId: '' });

/**
 * A sales document being drafted (an invoice or a quote): choose the customer, add lines from items, see GST worked
 * out as you type. What it's saved as, and its second button (issue, or mark sent), come from `config`.
 */
export default function SalesDraftForm({ config }: { config: SalesDraftConfig }) {
  const invoice = config.initial;
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

  const [contactId, setContactId] = useState(invoice?.contactId ?? '');
  const customer = customers.data?.items.find((c) => c.id === contactId) ?? null;
  const currency = (invoice ? invoice.currency : customer?.currency) ?? settings?.baseCurrency ?? 'INR';
  const digits = currencyDigits(currency);
  const plain = (minor: number) => new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(minor / 10 ** digits);
  const [issueDate, setIssueDate] = useState(invoice?.date ?? todayIn(settings?.timeZone ?? 'Asia/Kolkata'));
  const [dueDate, setDueDate] = useState(invoice?.until ?? '');
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
  const autoDue = config.autoUntil(issueDate, customer);

  const payload = (): SalesDraftPayload => ({
    contactId,
    date: issueDate,
    until: dueDate || null,
    reference,
    notes,
    placeOfSupply: placeOfSupply || null,
    lines: filled.map((l) => ({ itemId: l.itemId || null, description: l.description, quantity: l.quantity, unitPrice: l.price ?? 0, discount: l.discount || 0, taxGroupId: l.group?.id ?? null, accountId: l.accountId || null, costCentreId: l.costCentreId || null })),
  });
  const save = useMutation({
    mutationFn: (extra: boolean) => config.save(payload(), extra),
    onSuccess: (r) => {
      for (const key of config.invalidate) void queryClient.invalidateQueries({ queryKey: [key] });
      toast(r.message);
      navigate(config.path(r.id), { replace: true });
    },
    onError: (e) => toast(config.errorMessage(e), 'error'),
  });
  const remove = useMutation({
    mutationFn: () => config.remove!(),
    onSuccess: () => {
      for (const key of config.invalidate) void queryClient.invalidateQueries({ queryKey: [key] });
      toast(config.labels.deleted);
      navigate(config.listPath);
    },
    onError: (e) => toast(config.errorMessage(e), 'error'),
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
        <TextField label={config.labels.date} type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} disabled={!canManage} />
        <TextField label={config.labels.until} type="date" value={dueDate || autoDue} onChange={(e) => setDueDate(e.target.value)} disabled={!canManage} hint={!dueDate ? config.untilHint(customer) : undefined} />
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
          {invoice && config.remove && (
            <Button type="button" variant="ghost" icon={<Trash2 className="size-4" />} onClick={() => setDeleting(true)}>
              {config.labels.delete}
            </Button>
          )}
          <span className="flex-1" />
          <Button type="submit" variant="secondary" loading={save.isPending && save.variables === false}>
            {config.labels.save}
          </Button>
          <Button type="button" icon={<Send className="size-4 rtl:-scale-x-100" />} disabled={!!problem} loading={save.isPending && save.variables === true} onClick={() => save.mutate(true)}>
            {config.labels.extra}
          </Button>
        </div>
      )}
      <ConfirmDialog open={deleting} title={config.labels.deleteTitle} body={config.labels.deleteBody} confirmLabel={config.labels.delete} tone="danger" busy={remove.isPending} onConfirm={() => remove.mutate()} onClose={() => setDeleting(false)} />
    </form>
  );
}
