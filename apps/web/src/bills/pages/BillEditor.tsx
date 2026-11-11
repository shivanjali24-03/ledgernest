import { useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { formatDate } from '../../lib/format';
import { ApiError } from '../../auth/client';
import { motion } from 'motion/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ITC_KINDS, type ItcKind, currencyDigits, dueDateFor, parseSerials, findIndianState, INDIAN_STATES, invoiceAmounts, percentToPpm, parseQuantity, toMinor, todayIn } from '@ledgernest/shared';
import { ArrowLeft, Ban, BookCheck, FileDown, FileMinus, Plus, Repeat, Send, Trash2, X } from 'lucide-react';
import { saveBlob } from '../../lib/saveBlob';
import DebitNoteDialog from '../../debit-notes/DebitNoteDialog';
import { useDebitNotesApi } from '../../debit-notes/useDebitNotesApi';
import ReceiptDialog from '../../payments/ReceiptDialog';
import { usePaymentsApi } from '../../payments/usePaymentsApi';
import { useAccountsApi } from '../../accounts/useAccountsApi';
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
import WarehouseSelect from '../../inventory/WarehouseSelect';
import RegistrationSelect from '../../gst-registrations/RegistrationSelect';
import { Card, ErrorState, PageHeader, Pill, SkeletonRows } from '../../ui/Kit';
import { useToast } from '../../ui/toastContext';
import { groupForSupply, supplyFor } from '../../invoices/gst';
import { stateTone } from '../../invoices/state';
import BillDocument from '../BillDocument';
import { billErrorMessage } from '../errors';
import type { Bill, BillDuplicate, BillsApi } from '../types';
import { useBillsApi } from '../useBillsApi';
import SerialsInput from '../../inventory/SerialsInput';
import UnitSelect from '../../items/UnitSelect';
import { priceInUnit } from '../../items/unitPrice';
import CostCentreSelect from '../../cost-centres/CostCentreSelect';
import { useCostCentres } from '../../cost-centres/useCostCentresApi';
import { heldForApproval, heldMessage } from '../../approvals/errors';
import DocumentAttachments from '../../attachments/DocumentAttachments';
import RecurringBillDialog from '../../recurring-bills/RecurringBillDialog';
import { billTemplateOf } from '../../recurring-bills/types';
import { useRecurringBillsApi } from '../../recurring-bills/useRecurringBillsApi';

type Line = {
  key: string;
  itemId: string;
  description: string;
  quantity: string;
  unitPrice: string;
  discount: string;
  taxGroupId: string;
  accountId: string;
  costCentreId: string;
  batchNo: string;
  mfgDate: string;
  expiryDate: string;
  serials: string;
  inAltUnit: boolean;
  itc: ItcKind;
};
const blankLine = (): Line => ({
  key: crypto.randomUUID(),
  itemId: '',
  description: '',
  quantity: '1',
  unitPrice: '',
  discount: '',
  taxGroupId: '',
  accountId: '',
  costCentreId: '',
  batchNo: '',
  mfgDate: '',
  expiryDate: '',
  serials: '',
  inAltUnit: false,
  itc: 'eligible',
});

/** A draft: choose the vendor, add what was bought and where it's booked, see input GST as you type, save or record. */
function DraftForm({ bill: invoice, api }: { bill: Bill | null; api: BillsApi }) {
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
  const accountsApi = useAccountsApi();
  const role = session.role ?? session.customRoleName;
  const customers = useQuery({
    queryKey: ['contacts', session.organizationId, role, 'vendors'],
    queryFn: () => contactsApi!.list({ type: 'vendor', page: 1, pageSize: 100 }),
    enabled: !!contactsApi,
  });
  const accounts = useQuery({
    queryKey: ['accounts', session.organizationId, role, 'all'],
    queryFn: () => accountsApi!.list(true),
    enabled: !!accountsApi,
  });
  const costAccounts = useMemo(() => (accounts.data ?? []).filter((a) => (a.type === 'expense' || a.type === 'asset') && !a.archived && !['bank', 'cash', 'accounts_receivable'].includes(a.subtype)), [accounts.data]);
  const items = useQuery({
    queryKey: ['items', session.organizationId, role, 'active'],
    queryFn: () => itemsApi!.list({}),
    enabled: !!itemsApi,
  });
  const batched = (itemId: string) => !!items.data?.find((x) => x.id === itemId)?.trackBatches;
  const serialed = (itemId: string) => !!items.data?.find((x) => x.id === itemId)?.trackSerials;
  const taxes = useQuery({
    queryKey: ['taxes', session.organizationId, role],
    queryFn: () => taxesApi!.list(),
    enabled: !!taxesApi,
  });
  const canManage = session.permissions.has('bills.manage');

  const [contactId, setContactId] = useState(invoice?.contact.id ?? '');
  const customer = customers.data?.items.find((c) => c.id === contactId) ?? null;
  const currency = (invoice ? invoice.currency : customer?.currency) ?? settings?.baseCurrency ?? 'INR';
  const digits = currencyDigits(currency);
  const plain = (minor: number) =>
    new Intl.NumberFormat(locale, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(minor / 10 ** digits);
  const [issueDate, setIssueDate] = useState(invoice?.billDate ?? todayIn(settings?.timeZone ?? 'Asia/Kolkata'));
  const [dueDate, setDueDate] = useState(invoice?.dueDate ?? '');
  const [reference, setReference] = useState(invoice?.vendorReference ?? '');
  const [vendorDate, setVendorDate] = useState(invoice?.vendorBillDate ?? '');
  const [reverseCharge, setReverseCharge] = useState(!!invoice?.reverseCharge);
  const [boe, setBoe] = useState<{ number: string; date: string; portCode: string } | null>(invoice?.billOfEntry ?? null);
  const [notes, setNotes] = useState(invoice?.notes ?? '');
  const [placeOfSupply, setPlaceOfSupply] = useState(invoice?.placeOfSupply ?? '');
  const [gstRegistrationId, setGstRegistrationId] = useState((invoice as { gstRegistration?: { id: string } | null } | null)?.gstRegistration?.id ?? '');
  const [warehouseId, setWarehouseId] = useState((invoice as { warehouse?: { id: string } | null } | null)?.warehouse?.id ?? '');
  const [lines, setLines] = useState<Line[]>(
    invoice?.lines.length
      ? invoice.lines.map((l) => ({
          key: l.id,
          itemId: l.item?.id ?? '',
          description: l.description,
          quantity: l.quantity,
          unitPrice: plain(l.unitPrice),
          discount: l.discount ? String(l.discount) : '',
          taxGroupId: (l.taxGroup ?? l.rcmTaxGroup)?.id ?? '',
          accountId: l.account?.id ?? '',
          costCentreId: l.costCentre?.id ?? '',
          batchNo: l.batchNo ?? '',
          mfgDate: l.mfgDate ?? '',
          expiryDate: l.expiryDate ?? '',
          serials: (l.serials ?? []).join('\n'),
          inAltUnit: l.inAltUnit ?? false,
          itc: (l as { itc?: ItcKind }).itc ?? 'eligible',
        }))
      : [blankLine()],
  );
  const [deleting, setDeleting] = useState(false);
  // The vendor's bill number is recorded already: ask before recording it again
  const [dupes, setDupes] = useState<BillDuplicate[] | null>(null);
  const allowDuplicate = useRef(false);
  // A new bill is saved before it's recorded: a retry updates that draft rather than making another
  const [savedId, setSavedId] = useState<string | null>(null);
  const draftId = invoice?.id ?? savedId;
  const likely = useQuery({ queryKey: ['bills', 'duplicates', draftId], queryFn: () => api.duplicates(draftId!), enabled: !!draftId });

  const india = settings?.country === 'IN';
  const orgState = india ? (findIndianState(settings?.address.region)?.code ?? null) : null;
  // Until a vendor is chosen, the organisation's own state (not "Outside India")
  const pos = placeOfSupply || customer?.stateCode || (customer ? null : orgState);
  // Services bought from abroad under reverse charge are an import: IGST
  const supply = (reverseCharge && !pos) || boe ? 'inter' : supplyFor(orgState, pos);
  const groups = useMemo(() => taxes.data?.groups ?? [], [taxes.data]);
  const set = (key: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const pickItem = (key: string, itemId: string) => {
    const item = items.data?.find((x) => x.id === itemId);
    // An item fills in its description, price, tax and account; prices are in the base currency
    set(
      key,
      item
        ? {
            itemId,
            description: item.name,
            unitPrice: item.purchasePrice !== null && !customer?.currency ? plain(item.purchasePrice) : '',
            taxGroupId: item.taxGroupId ?? '',
            accountId: (item.trackStock ? item.inventoryAccountId : item.expenseAccountId) ?? '',
            inAltUnit: false,
            itc: item.itcBlocked ? 'blocked' : 'eligible',
          }
        : { itemId: '', inAltUnit: false },
    );
  };

  const parsed = lines.map((l) => {
    const price = toMinor(l.unitPrice, digits);
    const qty = parseQuantity(l.quantity);
    const disc = l.discount.trim() ? percentToPpm(l.discount) : 0;
    const chosen = groups.find((g) => g.id === l.taxGroupId);
    const group = chosen ? groupForSupply(chosen, supply, groups) : null;
    return {
      ...l,
      price,
      qty,
      disc,
      group,
      invalid: price === null || qty === null || disc === null,
    };
  });
  const filled = parsed.filter((l) => l.description.trim() || l.price);
  const withRates = filled
    .filter((l) => !l.invalid)
    .map((l) => ({
      quantity: l.quantity,
      unitPrice: l.price!,
      discountPpm: l.disc!,
      rates: (l.group?.rates ?? []).map((r) => ({
        rateId: r.id,
        ratePpm: r.ratePpm,
      })),
    }));
  // Under reverse charge the vendor charges no GST: we pay it ourselves, so it's shown but not owed to them
  const computed = invoiceAmounts(reverseCharge ? withRates.map((l) => ({ ...l, rates: [] })) : withRates);
  // A bill of entry: taxed lines are the assessable value (owed to the overseas supplier), so only duties and IGST are owed
  const assessable = boe ? computed.lines.reduce((s, x, n) => s + (withRates[n]!.rates.length ? x.net : 0), 0) : 0;
  const amounts = boe ? { ...computed, subtotal: computed.subtotal - assessable, total: computed.total - assessable } : computed;
  const rcmTax = reverseCharge ? invoiceAmounts(withRates).tax : 0;
  const breakdown = new Map<string, number>();
  filled
    .filter((l) => !l.invalid)
    .forEach((l, n) =>
      (reverseCharge ? [] : (l.group?.rates ?? [])).forEach((r, k) => {
        const amount = amounts.lines[n]!.taxes[k]?.amount ?? 0;
        if (amount) breakdown.set(r.name, (breakdown.get(r.name) ?? 0) + amount);
      }),
    );
  const autoDue = customer ? dueDateFor(vendorDate || issueDate, customer.paymentTermsDays) : '';

  const payload = () => ({
    contactId,
    billDate: issueDate,
    dueDate: dueDate || null,
    vendorReference: reference,
    vendorBillDate: vendorDate || null,
    reverseCharge,
    billOfEntry: boe,
    notes,
    placeOfSupply: placeOfSupply || null,
    warehouseId: warehouseId || null,
    gstRegistrationId: gstRegistrationId || null,
    lines: filled.map((l) => ({
      itemId: l.itemId || null,
      description: l.description,
      quantity: l.quantity,
      unitPrice: l.price ?? 0,
      discount: l.discount || 0,
      taxGroupId: l.group?.id ?? null,
      accountId: l.accountId || null,
      costCentreId: l.costCentreId || null,
      inAltUnit: l.inAltUnit,
      itc: l.itc,
      ...(batched(l.itemId) ? { batchNo: l.batchNo.trim() || null, mfgDate: l.mfgDate || null, expiryDate: l.expiryDate || null } : {}),
      ...(serialed(l.itemId) ? { serials: parseSerials(l.serials) } : {}),
    })),
  });
  const save = useMutation({
    mutationFn: async (andIssue: boolean) => {
      const saved = draftId ? await api.update(draftId, payload()) : await api.create(payload());
      if (!invoice) setSavedId(saved.id);
      if (!andIssue) return { i: saved, held: null };
      // Held for approval: it stays a draft, saved, with the request sent
      const allow = allowDuplicate.current;
      allowDuplicate.current = false;
      return api.record(saved.id, allow ? { allowDuplicate: true } : undefined).then(
        (i) => ({ i, held: null }),
        (err: unknown) => {
          if (heldForApproval(err)) return { i: saved, held: err };
          throw err;
        },
      );
    },
    onSuccess: ({ i, held }, andIssue) => {
      for (const key of ['bills', 'contacts', 'journals', 'journal', 'reports', 'approvals']) void queryClient.invalidateQueries({ queryKey: [key] });
      toast(held ? heldMessage(held, t) : andIssue ? t('bills.recorded', { number: i.number }) : t('invoices.saved'));
      navigate(`/bills/${i.id}`, { replace: true });
    },
    onError: (e) => (e instanceof ApiError && e.details?.reason === 'duplicate_bill' ? setDupes(e.details.duplicates as BillDuplicate[]) : toast(billErrorMessage(e, t), 'error')),
  });
  const remove = useMutation({
    mutationFn: () => api.remove(invoice!.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['bills'] });
      toast(t('invoices.deleted'));
      navigate('/bills');
    },
    onError: (e) => toast(billErrorMessage(e, t), 'error'),
  });
  const problem = !contactId ? 'vendor' : !filled.length ? 'lines' : filled.some((l) => l.invalid) ? 'amounts' : filled.some((l) => !l.accountId) ? 'account' : null;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (problem) return toast(t(problem === 'vendor' || problem === 'account' ? `bills.problems.${problem}` : `invoices.problems.${problem}`), 'error');
    save.mutate(false);
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      {!!likely.data?.length && (
        <div role="note" className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          <p className="font-medium">{t('bills.duplicates.title')}</p>
          <ul className="mt-1 space-y-0.5">
            {likely.data.map((d) => (
              <li key={d.id}>
                <Link to={`/bills/${d.id}`} className="underline">
                  {d.number ?? t('bills.duplicates.draft')}
                </Link>{' '}
                · {d.vendorReference ?? '–'} · {formatDate(`${d.billDate}T00:00:00Z`, locale)} · {t(`bills.duplicates.${d.reason}`)}
              </li>
            ))}
          </ul>
        </div>
      )}
      <Card className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
        <div className="sm:col-span-2">
          <SelectField
            label={t('bills.fields.vendor')}
            value={contactId}
            onChange={(e) => setContactId(e.target.value)}
            disabled={!canManage}
            options={[
              { value: '', label: t('bills.chooseVendor') },
              ...(customers.data?.items ?? []).map((c) => ({
                value: c.id,
                label: c.currency ? `${c.name} (${c.currency})` : c.name,
              })),
            ]}
            hint={customer?.currency ? t('invoices.foreignHint', { code: customer.currency }) : undefined}
          />
        </div>
        <TextField label={t('bills.fields.billDate')} type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} disabled={!canManage} />
        <TextField label={t('invoices.fields.dueDate')} type="date" value={dueDate || autoDue} onChange={(e) => setDueDate(e.target.value)} disabled={!canManage} hint={!dueDate && customer ? t('bills.dueHint', { days: customer.paymentTermsDays }) : undefined} />
        <TextField label={t('bills.fields.vendorReference')} value={reference} onChange={(e) => setReference(e.target.value)} disabled={!canManage} placeholder="SOS/887" dir="auto" />
        <TextField label={t('bills.fields.vendorBillDate')} type="date" value={vendorDate} max={issueDate} onChange={(e) => setVendorDate(e.target.value)} disabled={!canManage} hint={t('bills.hints.vendorBillDate')} />
        {india && (
          <label className="flex items-center gap-2 self-end pb-2 text-sm font-medium">
            <input type="checkbox" checked={reverseCharge} disabled={!canManage} onChange={(e) => setReverseCharge(e.target.checked)} className="size-4 rounded accent-brand-600" />
            <span>
              {t('bills.reverseCharge.label')}
              <span className="block text-xs font-normal text-ink-500">{t('bills.reverseCharge.hint')}</span>
            </span>
          </label>
        )}
        {india && (
          <label className="flex items-center gap-2 self-end pb-2 text-sm font-medium">
            <input type="checkbox" checked={!!boe} disabled={!canManage} onChange={(e) => setBoe(e.target.checked ? { number: '', date: issueDate, portCode: '' } : null)} className="size-4 rounded accent-brand-600" />
            <span>
              {t('bills.boe.label')}
              <span className="block text-xs font-normal text-ink-500">{t('bills.boe.hint')}</span>
            </span>
          </label>
        )}
        {boe && (
          <>
            <TextField label={t('bills.boe.number')} value={boe.number} onChange={(e) => setBoe({ ...boe, number: e.target.value })} disabled={!canManage} inputMode="numeric" dir="ltr" className="font-mono" />
            <TextField label={t('bills.boe.date')} type="date" value={boe.date} onChange={(e) => setBoe({ ...boe, date: e.target.value })} disabled={!canManage} />
            <TextField label={t('bills.boe.portCode')} value={boe.portCode} onChange={(e) => setBoe({ ...boe, portCode: e.target.value.toUpperCase() })} disabled={!canManage} placeholder="INNSA1" dir="ltr" className="font-mono uppercase" />
          </>
        )}
        {india && (
          <SelectField
            label={t('invoices.fields.placeOfSupply')}
            value={pos ?? ''}
            onChange={(e) => setPlaceOfSupply(e.target.value)}
            disabled={!canManage}
            options={[
              { value: '', label: t('invoices.outsideIndia') },
              ...INDIAN_STATES.map((s) => ({
                value: s.code,
                label: `${s.code} · ${s.name}`,
              })),
            ]}
            hint={supply ? t(`invoices.supply.${supply}`) : undefined}
          />
        )}
        <RegistrationSelect value={gstRegistrationId} onChange={setGstRegistrationId} disabled={!canManage} />
        <WarehouseSelect value={warehouseId} onChange={setWarehouseId} disabled={!canManage} />
      </Card>

      <Card className="overflow-hidden">
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[1020px] text-sm">
            <thead className="border-b border-ink-100 text-xs uppercase tracking-wide text-ink-400 dark:border-ink-800">
              <tr>
                <th scope="col" className="w-44 px-3 py-2 text-start font-semibold">
                  {t('invoices.columns.item')}
                </th>
                <th scope="col" className="px-3 py-2 text-start font-semibold">
                  {t('invoices.columns.description')}
                </th>
                <th scope="col" className="w-20 px-3 py-2 text-end font-semibold">
                  {t('invoices.columns.qty')}
                </th>
                <th scope="col" className="w-28 px-3 py-2 text-end font-semibold">
                  {t('invoices.columns.price', { currency })}
                </th>
                <th scope="col" className="w-20 px-3 py-2 text-end font-semibold">
                  {t('invoices.columns.discount')}
                </th>
                <th scope="col" className="w-40 px-3 py-2 text-start font-semibold">
                  {t('bills.columns.account')}
                </th>
                <th scope="col" className="w-32 px-3 py-2 text-start font-semibold">
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
                      {serialed(l.itemId) && <SerialsInput value={l.serials} onChange={(v) => set(l.key, { serials: v })} quantity={l.quantity} label={t('serials.lineSerials', { n: n + 1 })} disabled={!canManage} />}
                      {batched(l.itemId) && (
                        <div className="mt-1 grid grid-cols-3 gap-1">
                          <input aria-label={t('batches.lineBatch', { n: n + 1 })} placeholder={t('batches.batchNo')} value={l.batchNo} disabled={!canManage} onChange={(e) => set(l.key, { batchNo: e.target.value })} dir="ltr" className={clsx(cell, 'font-mono', !l.batchNo.trim() && 'border-expense')} />
                          <input aria-label={t('batches.lineMfg', { n: n + 1 })} title={t('batches.mfgDate')} type="date" value={l.mfgDate} disabled={!canManage} onChange={(e) => set(l.key, { mfgDate: e.target.value })} className={cell} />
                          <input aria-label={t('batches.lineExpiry', { n: n + 1 })} title={t('batches.expiryDate')} type="date" value={l.expiryDate} min={l.mfgDate || undefined} disabled={!canManage} onChange={(e) => set(l.key, { expiryDate: e.target.value })} className={cell} />
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-1.5">
                      <input aria-label={t('invoices.lineQty', { n: n + 1 })} value={l.quantity} disabled={!canManage} onChange={(e) => set(l.key, { quantity: e.target.value })} inputMode="decimal" dir="ltr" className={clsx(cell, 'text-end font-mono', l.qty === null && 'border-expense')} />
                      <UnitSelect
                        item={items.data?.find((x) => x.id === l.itemId)}
                        inAlt={l.inAltUnit}
                        label={t('items.lineUnit', { n: n + 1 })}
                        disabled={!canManage}
                        onChange={(inAlt) => {
                          const factor = items.data?.find((x) => x.id === l.itemId)?.altFactor;
                          const p = factor ? priceInUnit(l.price, factor, inAlt) : null;
                          set(l.key, { inAltUnit: inAlt, ...(p !== null ? { unitPrice: plain(p) } : {}) });
                        }}
                      />
                    </td>
                    <td className="px-3 py-1.5">
                      <input aria-label={t('invoices.linePrice', { n: n + 1 })} value={l.unitPrice} disabled={!canManage} onChange={(e) => set(l.key, { unitPrice: e.target.value })} onBlur={() => l.price && set(l.key, { unitPrice: plain(l.price) })} inputMode="decimal" dir="ltr" className={clsx(cell, 'text-end font-mono', l.price === null && 'border-expense')} />
                    </td>
                    <td className="px-3 py-1.5">
                      <input aria-label={t('invoices.lineDiscount', { n: n + 1 })} value={l.discount} disabled={!canManage} onChange={(e) => set(l.key, { discount: e.target.value })} inputMode="decimal" dir="ltr" placeholder="0" className={clsx(cell, 'text-end font-mono', l.disc === null && 'border-expense')} />
                    </td>
                    <td className="px-3 py-1.5">
                      <select aria-label={t('bills.lineAccount', { n: n + 1 })} value={l.accountId} disabled={!canManage} onChange={(e) => set(l.key, { accountId: e.target.value })} className={clsx(cell, !l.accountId && (l.description.trim() || l.price) && 'border-expense')}>
                        <option value="">{t('bills.chooseAccount')}</option>
                        {costAccounts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.code} · {a.name}
                          </option>
                        ))}
                      </select>
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
                      {india && l.group && (
                        <select aria-label={t('bills.lineItc', { n: n + 1 })} value={l.itc} disabled={!canManage || !!items.data?.find((x) => x.id === l.itemId)?.itcBlocked} onChange={(e) => set(l.key, { itc: e.target.value as ItcKind })} className={clsx(cell, 'mt-1 text-xs')}>
                          {ITC_KINDS.map((k) => (
                            <option key={k} value={k}>
                              {t(`bills.itc.${k}`)}
                            </option>
                          ))}
                        </select>
                      )}
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
            {!!boe && (
              <>
                <dt className="text-ink-500">{t('bills.boe.assessable')}</dt>
                <dd className="text-end font-mono tabular-nums text-ink-500" dir="ltr" data-testid="boe-assessable">
                  {plain(assessable)}
                </dd>
              </>
            )}
            {reverseCharge && (
              <>
                <dt className="text-ink-500">{t('bills.reverseCharge.wePay')}</dt>
                <dd className="text-end font-mono tabular-nums" dir="ltr" data-testid="rcm-tax">
                  {plain(rcmTax)}
                </dd>
              </>
            )}
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
          <Button type="button" icon={<BookCheck className="size-4" />} disabled={!!problem} loading={save.isPending && save.variables === true} onClick={() => save.mutate(true)}>
            {t('bills.record')}
          </Button>
        </div>
      )}
      <ConfirmDialog
        open={!!dupes}
        title={t('bills.duplicates.confirmTitle')}
        body={dupes?.length ? t('bills.duplicates.confirmBody', { reference, number: dupes[0]!.number ?? '' }) : ''}
        confirmLabel={t('bills.duplicates.recordAnyway')}
        busy={save.isPending}
        onConfirm={() => {
          allowDuplicate.current = true;
          setDupes(null);
          save.mutate(true);
        }}
        onClose={() => {
          setDupes(null);
          // Not recorded: show the saved draft
          if (!invoice && savedId) navigate(`/bills/${savedId}`, { replace: true });
        }}
      />
      <ConfirmDialog open={deleting} title={t('bills.deleteTitle')} body={t('invoices.deleteBody')} confirmLabel={t('invoices.deleteDraft')} tone="danger" busy={remove.isPending} onConfirm={() => remove.mutate()} onClose={() => setDeleting(false)} />
    </form>
  );
}

/** One bill: a new or draft one to edit, or a recorded one to read or void. */
export default function BillEditor() {
  const { t } = useTranslation();
  const { id } = useParams();
  const session = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();
  const api = useBillsApi();
  const isNew = !id || id === 'new';
  const key = ['bills', session.organizationId, 'one', id] as const;
  const query = useQuery({
    queryKey: key,
    queryFn: () => api!.get(id!),
    enabled: !!api && !isNew,
  });
  const bill = query.data;
  const [voiding, setVoiding] = useState(false);
  const [repeating, setRepeating] = useState(false);
  const recurringApi = useRecurringBillsApi();
  const [paying, setPaying] = useState(false);
  const [debiting, setDebiting] = useState(false);
  const debitNotesApi = useDebitNotesApi();
  const paymentsApi = usePaymentsApi();
  const canPay = session.permissions.has('payments.manage');
  const voidIt = useMutation({
    mutationFn: (reason?: string) => api!.void(bill!.id, { reason }),
    onSuccess: (b) => {
      setVoiding(false);
      queryClient.setQueryData(key, b);
      for (const k of ['bills', 'contacts', 'journals', 'reports']) void queryClient.invalidateQueries({ queryKey: [k] });
      toast(t('bills.voided', { number: b.number }));
    },
    onError: (e) => {
      setVoiding(false);
      toast(billErrorMessage(e, t), 'error');
    },
  });
  const canManage = session.permissions.has('bills.manage');
  const title = isNew ? t('bills.newTitle') : (bill?.number ?? t('bills.draftTitle'));
  const link = 'font-mono font-semibold text-brand-700 hover:underline dark:text-brand-300';

  return (
    <motion.div variants={stagger(0.06)} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={fadeUp}>
        <Link to="/bills" className="mb-2 inline-flex items-center gap-1 text-sm text-ink-500 hover:text-ink-800 dark:hover:text-ink-200">
          <ArrowLeft className="size-4 rtl:-scale-x-100" aria-hidden /> {t('bills.title')}
        </Link>
        <PageHeader
          title={title}
          description={bill && bill.status !== 'draft' ? (bill.vendorReference ? t('bills.theirNumber', { number: bill.vendorReference }) : undefined) : t('bills.draftHint')}
          actions={
            bill ? (
              <>
                {bill.opening && <Pill tone="neutral">{t('imports.openingPill')}</Pill>}
                <Pill tone={bill.status === 'open' ? 'brand' : 'neutral'}>
                  <span className={stateTone(bill.state)}>{t(`bills.states.${bill.state}`)}</span>
                </Pill>
                {bill.status === 'open' && canPay && bill.balance > 0 && (
                  <Button icon={<Send className="size-4 rtl:-scale-x-100" />} onClick={() => setPaying(true)}>
                    {t('payments.payBill')}
                  </Button>
                )}
                {bill.selfInvoiceNumber && (
                  <Button variant="secondary" icon={<FileDown className="size-4" />} onClick={() => void api!.selfInvoice(bill.id).then(saveBlob, (e: unknown) => toast(billErrorMessage(e, t), 'error'))}>
                    {t('bills.reverseCharge.selfInvoice')}
                  </Button>
                )}
                {bill.status === 'open' && canManage && !bill.currency && !bill.reverseCharge && (
                  <Button variant="secondary" icon={<FileMinus className="size-4" />} onClick={() => setDebiting(true)}>
                    {t('debitNotes.new')}
                  </Button>
                )}
                {bill.status !== 'void' && canManage && (
                  <Button variant="ghost" icon={<Repeat className="size-4" />} onClick={() => setRepeating(true)}>
                    {t('recurring.makeRecurring')}
                  </Button>
                )}
                {bill.status === 'open' && canManage && bill.amountPaid === 0 && (
                  <Button variant="ghost" icon={<Ban className="size-4" />} onClick={() => setVoiding(true)}>
                    {t('bills.void')}
                  </Button>
                )}
              </>
            ) : undefined
          }
        />
      </motion.div>
      <motion.div variants={fadeUp} className="space-y-4">
        {!api ? null : isNew ? (
          <DraftForm key="new" bill={null} api={api} />
        ) : query.isPending ? (
          <Card>
            <SkeletonRows rows={6} />
          </Card>
        ) : query.isError ? (
          <Card>
            <ErrorState onRetry={() => void query.refetch()} />
          </Card>
        ) : bill!.status === 'draft' ? (
          <DraftForm key={bill!.id} bill={bill!} api={api} />
        ) : (
          <>
            <BillDocument bill={bill!} />
            <p className="text-sm text-ink-500">
              {bill!.journalEntry && (
                <>
                  {t('invoices.postedAs')}{' '}
                  <Link to={`/journals/${bill!.journalEntry.id}`} className={link} dir="ltr">
                    {bill!.journalEntry.number}
                  </Link>
                </>
              )}
              {bill!.payments.map((p) => (
                <span key={p.id}>
                  {' · '}
                  {t('payments.paidBy')}{' '}
                  <span className="font-mono" dir="ltr">
                    {p.number}
                  </span>
                </span>
              ))}
              {(bill!.debitNotes ?? []).map((n) => (
                <span key={n.id}>
                  {' · '}
                  {t('debitNotes.creditedBy')}{' '}
                  <Link to="/debit-notes" className={link} dir="ltr">
                    {n.number}
                  </Link>
                  {n.status === 'void' && ` (${t('debitNotes.statuses.void')})`}
                </span>
              ))}
              {bill!.voidEntry && (
                <>
                  {' · '}
                  {t('invoices.voidedBy')}{' '}
                  <Link to={`/journals/${bill!.voidEntry.id}`} className={link} dir="ltr">
                    {bill!.voidEntry.number}
                  </Link>
                </>
              )}
            </p>
          </>
        )}
        {bill && <DocumentAttachments documentType="bill" documentId={bill.id} />}
      </motion.div>
      {paying && bill && paymentsApi && (
        <ReceiptDialog
          api={paymentsApi}
          kind="payment"
          contactId={bill.contact.id}
          documentId={bill.id}
          onClose={() => setPaying(false)}
          onDone={() => {
            setPaying(false);
            void queryClient.invalidateQueries({ queryKey: key });
          }}
        />
      )}
      {debiting && bill && debitNotesApi && (
        <DebitNoteDialog
          bill={bill}
          api={debitNotesApi}
          onClose={() => setDebiting(false)}
          onDone={() => {
            setDebiting(false);
            void queryClient.invalidateQueries({ queryKey: key });
          }}
        />
      )}
      {repeating && bill && recurringApi && <RecurringBillDialog api={recurringApi} template={billTemplateOf(bill)} onClose={() => setRepeating(false)} onSaved={() => setRepeating(false)} />}
      <ConfirmDialog open={voiding} title={bill ? t('bills.voidTitle', { number: bill.number }) : ''} body={t('bills.voidBody')} confirmLabel={t('bills.void')} tone="danger" askReason busy={voidIt.isPending} onConfirm={(reason) => voidIt.mutate(reason)} onClose={() => setVoiding(false)} />
    </motion.div>
  );
}
