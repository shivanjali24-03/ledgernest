import { formatMoney } from '../lib/format';
import { useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { currencyDigits, findIndianState, parseSerials, INDIAN_STATES, invoiceAmounts, percentToPpm, parseQuantity, toMinor, todayIn, type DispatchDetails, type Instalment, type ExportDetails, type InvoiceDiscount, type ShipTo, type SupplyKind, SUPPLY_KINDS, isExport, isSez, zeroRatedUnderLut, gstTreatmentOf } from '@ledgernest/shared';
import { Plus, Send, Trash2, X } from 'lucide-react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { useContactsApi } from '../contacts/useContactsApi';
import type { Contact } from '../contacts/types';
import SerialsInput from '../inventory/SerialsInput';
import InstalmentsEditor from './InstalmentsEditor';
import IndianAddressFields from '../geo/IndianAddressFields';
import UnitSelect from '../items/UnitSelect';
import { priceInUnit } from '../items/unitPrice';
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
import WarehouseSelect from '../inventory/WarehouseSelect';
import RegistrationSelect from '../gst-registrations/RegistrationSelect';
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
  /** The warehouse its goods leave (null: the main one) */
  warehouse?: { id: string } | null;
  /** The GSTIN it's under (null: the organisation's own) */
  gstRegistration?: { id: string } | null;
  currency: string | null;
  /** The number series it will be numbered from (invoices) */
  seriesId?: string | null;
  /** Its own interest rate on late payment (invoices; null = the default) */
  interestRateBp?: number | null;
  /** Paid in instalments (invoices) */
  instalments?: Instalment[] | null;
  /** Order and dispatch details (invoices) */
  dispatch?: DispatchDetails | null;
  /** Where the goods go (invoices) */
  shipTo?: ShipTo | null;
  pricesIncludeTax?: boolean;
  discount?: InvoiceDiscount | null;
  supplyKind?: SupplyKind;
  reverseCharge?: boolean;
  exportDetails?: Partial<ExportDetails> | null;
  lines: { id: string; item: { id: string } | null; description: string; quantity: string; unitPrice: number; discount: number; taxGroup: { id: string } | null; rcmTaxGroup?: { id: string } | null; account: { id: string } | null; costCentre?: { id: string } | null; batchId?: string | null; serials?: string[]; inAltUnit?: boolean }[];
}
export interface SalesDraftPayload {
  contactId: string;
  date: string;
  until: string | null;
  reference: string;
  notes: string;
  placeOfSupply: string | null;
  warehouseId?: string | null;
  gstRegistrationId?: string | null;
  seriesId?: string | null;
  interestRateBp?: number | null;
  instalments?: Instalment[] | null;
  dispatch?: Partial<DispatchDetails> | null;
  shipTo?: ShipTo | null;
  pricesIncludeTax?: boolean;
  discount?: InvoiceDiscount | null;
  supplyKind?: SupplyKind;
  reverseCharge?: boolean;
  exportDetails?: Partial<ExportDetails> | null;
  lines: { itemId: string | null; description: string; quantity: string; unitPrice: number; discount: string | number; taxGroupId: string | null; accountId: string | null; costCentreId: string | null; batchId?: string | null; serials?: string[]; inAltUnit?: boolean }[];
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
  /** Number series to choose from (invoices, when there's more than one) */
  series?: { id: string; name: string; preview: string; isDefault: boolean }[];
  /** It can carry its own interest rate on late payment (invoices) */
  interest?: boolean;
  /** Lines of goods kept in batches choose their batch (invoices) */
  batches?: boolean;
  /** Warn when this takes the customer over their credit limit (invoices) */
  creditCheck?: boolean;
  labels: { date: string; until: string; save: string; extra: string; delete: string; deleteTitle: string; deleteBody: string; deleted: string };
}

type Line = { key: string; itemId: string; description: string; quantity: string; unitPrice: string; discount: string; taxGroupId: string; accountId: string; costCentreId: string; batchId: string; serials: string; inAltUnit: boolean };
const blankLine = (): Line => ({ key: crypto.randomUUID(), itemId: '', description: '', quantity: '1', unitPrice: '', discount: '', taxGroupId: '', accountId: '', costCentreId: '', batchId: '', serials: '', inAltUnit: false });

/** For goods kept in batches: which batch to sell from, or the earliest expiry first; expired batches can't be chosen */
function BatchSelect({ itemId, value, onChange, label, disabled }: { itemId: string; value: string; onChange: (v: string) => void; label: string; disabled: boolean }) {
  const { t } = useTranslation();
  const session = useSession();
  const itemsApi = useItemsApi();
  const batches = useQuery({ queryKey: ['items', session.organizationId, 'batches', itemId], queryFn: () => itemsApi!.batches(itemId), enabled: !!itemsApi });
  return (
    <select aria-label={label} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className={clsx(inputClass, 'mt-1 h-9 border-ink-200 text-xs dark:border-ink-700')}>
      <option value="">{t('batches.auto')}</option>
      {(batches.data ?? [])
        .filter((b) => b.onHand !== '0' || b.id === value)
        .map((b) => (
          <option key={b.id} value={b.id} disabled={b.expired}>
            {t(b.expired ? 'batches.optionExpired' : 'batches.option', { batch: b.batchNo, expiry: b.expiryDate ?? '—', onHand: b.onHand })}
          </option>
        ))}
    </select>
  );
}

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
  // A composition dealer charges no GST: lines carry no tax
  const composition = settings?.gstScheme === 'composition' && !!settings?.taxId;
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
  const [warehouseId, setWarehouseId] = useState(invoice?.warehouse?.id ?? '');
  const [gstRegistrationId, setGstRegistrationId] = useState(invoice?.gstRegistration?.id ?? '');
  const [seriesId, setSeriesId] = useState(invoice?.seriesId ?? '');
  const [interestRate, setInterestRate] = useState(invoice?.interestRateBp != null ? String(invoice.interestRateBp / 100) : '');
  const [instalments, setInstalments] = useState<Instalment[] | null>(invoice?.instalments ?? null);
  const [dispatch, setDispatch] = useState<Partial<DispatchDetails>>(invoice?.dispatch ?? {});
  const [showDispatch, setShowDispatch] = useState(!!invoice?.dispatch);
  const [shipTo, setShipTo] = useState<ShipTo | null>(invoice?.shipTo ?? null);
  const [inclusive, setInclusive] = useState(!!invoice?.pricesIncludeTax);
  const [supplyKind, setSupplyKind] = useState<SupplyKind>(invoice?.supplyKind ?? 'regular');
  const [reverseCharge, setReverseCharge] = useState(!!invoice?.reverseCharge);
  const [exportDetails, setExportDetails] = useState<Partial<ExportDetails>>(invoice?.exportDetails ?? {});
  const [discKind, setDiscKind] = useState<'percent' | 'amount'>(invoice?.discount?.kind ?? 'percent');
  const [discText, setDiscText] = useState(invoice?.discount ? (invoice.discount.kind === 'percent' ? String(invoice.discount.value / 10_000) : (invoice.discount.value / 100).toFixed(2)) : '');
  const shipToState = shipTo && (shipTo.country ?? 'IN') === 'IN' ? (findIndianState(shipTo.region)?.code ?? null) : null;
  const [lines, setLines] = useState<Line[]>(
    invoice?.lines.length
      ? invoice.lines.map((l) => ({ key: l.id, itemId: l.item?.id ?? '', description: l.description, quantity: l.quantity, unitPrice: plain(l.unitPrice), discount: l.discount ? String(l.discount) : '', taxGroupId: (l.taxGroup ?? l.rcmTaxGroup)?.id ?? '', accountId: l.account?.id ?? '', costCentreId: l.costCentre?.id ?? '', batchId: l.batchId ?? '', serials: (l.serials ?? []).join('\n'), inAltUnit: l.inAltUnit ?? false }))
      : [blankLine()],
  );
  const [deleting, setDeleting] = useState(false);

  const india = settings?.country === 'IN';
  const orgState = india ? (findIndianState(settings?.address.region)?.code ?? null) : null;
  // Until a customer is chosen, the organisation's own state (not "Outside India")
  const pos = placeOfSupply || shipToState || customer?.stateCode || (customer ? null : orgState);
  // Exports and SEZ supplies are inter-state (IGST)
  const supply = config.interest && (isExport(supplyKind) || isSez(supplyKind)) ? 'inter' : supplyFor(orgState, pos);
  const groups = useMemo(() => taxes.data?.groups ?? [], [taxes.data]);
  const set = (key: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const pickItem = (key: string, itemId: string) => {
    const item = items.data?.find((x) => x.id === itemId);
    // An item fills in its description, price, tax and account; prices are in the base currency
    set(key, item ? { itemId, description: item.name, unitPrice: item.salePrice !== null && !customer?.currency ? plain(item.salePrice) : '', taxGroupId: composition ? '' : (item.taxGroupId ?? ''), accountId: item.incomeAccountId ?? '', inAltUnit: false } : { itemId: '', inAltUnit: false });
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
  // A discount on the whole invoice: a percentage, or an amount in the invoice's currency
  const invoiceDiscount: InvoiceDiscount | null = discText.trim() ? (discKind === 'percent' ? { kind: 'percent', value: Math.round(Number(discText) * 10_000) } : { kind: 'amount', value: toMinor(discText, digits) ?? 0 }) : null;
  // Zero-rated under LUT, or the buyer pays it under reverse charge: no GST on the invoice
  const rcm = !!config.interest && reverseCharge && supplyKind === 'regular';
  const taxFree = !!config.interest && (zeroRatedUnderLut(supplyKind) || rcm);
  const rateList = (l: (typeof filled)[number]) => (l.group?.rates ?? []).map((r) => ({ rateId: r.id, ratePpm: r.ratePpm }));
  // Under reverse charge: the GST the buyer pays, shown but not charged
  const rcmTax = rcm ? invoiceAmounts(filled.filter((l) => !l.invalid).map((l) => ({ quantity: l.quantity, unitPrice: l.price!, discountPpm: l.disc!, rates: rateList(l) })), { discount: invoiceDiscount }).tax : 0;
  const amounts = invoiceAmounts(filled.filter((l) => !l.invalid).map((l) => ({ quantity: l.quantity, unitPrice: l.price!, discountPpm: l.disc!, rates: taxFree ? [] : rateList(l) })), { roundTo: config.interest && settings?.roundInvoiceTotals && !customer?.currency ? 100 : undefined, taxInclusive: config.interest && inclusive, discount: config.interest ? invoiceDiscount : null });
  const breakdown = new Map<string, number>();
  filled
    .filter((l) => !l.invalid)
    .forEach((l, n) =>
      (taxFree ? [] : (l.group?.rates ?? [])).forEach((r, k) => {
        const amount = amounts.lines[n]!.taxes[k]?.amount ?? 0;
        if (amount) breakdown.set(r.name, (breakdown.get(r.name) ?? 0) + amount);
      }),
    );
  const autoDue = config.autoUntil(issueDate, customer);
  // What the customer would owe with this invoice, against their limit (drafts aren't owed yet, so this one counts in full)
  const owedAfter = (customer?.receivable ?? 0) + amounts.total;
  const overLimit = !!config.creditCheck && customer?.creditLimit != null && owedAfter > customer.creditLimit;

  const payload = (): SalesDraftPayload => ({
    contactId,
    date: issueDate,
    until: dueDate || null,
    reference,
    notes,
    placeOfSupply: placeOfSupply || null,
    warehouseId: warehouseId || null,
    gstRegistrationId: gstRegistrationId || null,
    ...(config.series ? { seriesId: seriesId || null } : {}),
    ...(config.interest ? { instalments: instalments?.length ? instalments : null, dispatch: Object.values(dispatch).some((x) => x) ? dispatch : null, shipTo: shipTo && (shipTo.line1 || shipTo.city || shipTo.postalCode) ? shipTo : null, pricesIncludeTax: inclusive, discount: invoiceDiscount, supplyKind, exportDetails: isExport(supplyKind) && Object.values(exportDetails).some((x) => x) ? exportDetails : null, reverseCharge: rcm } : {}),
    ...(config.interest ? { interestRateBp: interestRate.trim() ? Math.round(Number(interestRate.replace('%', '').trim()) * 100) : null } : {}),
    lines: filled.map((l) => ({ itemId: l.itemId || null, description: l.description, quantity: l.quantity, unitPrice: l.price ?? 0, discount: l.discount || 0, taxGroupId: l.group?.id ?? null, accountId: l.accountId || null, costCentreId: l.costCentreId || null, inAltUnit: l.inAltUnit, ...(config.batches ? { batchId: l.batchId || null, serials: items.data?.find((x) => x.id === l.itemId)?.trackSerials ? parseSerials(l.serials) : [] } : {}) })),
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
            onChange={(e) => {
              setContactId(e.target.value);
              // An SEZ or overseas customer: the supply is zero-rated, under LUT when the organisation has one
              const c = customers.data?.items.find((x) => x.id === e.target.value);
              if (c && config.interest) {
                const g = gstTreatmentOf(c);
                const lut = !!settings?.lutNumber;
                setSupplyKind(g === 'sez' ? (lut ? 'sez_lut' : 'sez_with_igst') : g === 'overseas' ? (lut ? 'export_lut' : 'export_with_igst') : 'regular');
              }
            }}
            disabled={!canManage}
            options={[{ value: '', label: t('invoices.chooseCustomer') }, ...(customers.data?.items ?? []).map((c) => ({ value: c.id, label: c.currency ? `${c.name} (${c.currency})` : c.name }))]}
            hint={customer?.currency ? t('invoices.foreignHint', { code: customer.currency }) : undefined}
          />
        </div>
        <TextField label={config.labels.date} type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} disabled={!canManage} />
        <TextField label={config.labels.until} type="date" value={dueDate || autoDue} onChange={(e) => setDueDate(e.target.value)} disabled={!canManage} hint={!dueDate ? config.untilHint(customer) : undefined} />
        <TextField label={t('invoices.fields.reference')} value={reference} onChange={(e) => setReference(e.target.value)} disabled={!canManage} placeholder="PO-4471" dir="auto" />
        {config.interest && <TextField label={t('invoices.interest.rateField')} value={interestRate} onChange={(e) => setInterestRate(e.target.value)} disabled={!canManage} inputMode="decimal" dir="ltr" placeholder={t('invoices.interest.rateDefault')} hint={t('invoices.interest.rateHint')} />}
        {config.series && config.series.length > 1 && (
          <SelectField
            label={t('invoices.fields.series')}
            value={seriesId || config.series.find((x) => x.isDefault)?.id || ''}
            onChange={(e) => setSeriesId(e.target.value)}
            disabled={!canManage}
            options={config.series.map((x) => ({ value: x.id, label: `${x.name} · ${x.preview}` }))}
          />
        )}
        {india && config.interest && (
          <SelectField label={t('invoices.fields.supplyKind')} value={supplyKind} onChange={(e) => setSupplyKind(e.target.value as SupplyKind)} disabled={!canManage} options={SUPPLY_KINDS.map((k) => ({ value: k, label: t(`invoices.supplyKinds.${k}`) }))} hint={zeroRatedUnderLut(supplyKind) ? t('invoices.supplyKindLut') : undefined} />
        )}
        {india && config.interest && isExport(supplyKind) && (
          <>
            {(['portCode', 'shippingBillNo', 'shippingBillDate', 'countryCode'] as const).map((k) => (
              <TextField key={k} label={t(`invoices.exportFields.${k}`)} type={k === 'shippingBillDate' ? 'date' : 'text'} value={exportDetails[k] ?? ''} onChange={(e) => setExportDetails((d) => ({ ...d, [k]: e.target.value || null }))} disabled={!canManage} dir="ltr" className={k === 'portCode' || k === 'countryCode' ? 'font-mono uppercase' : undefined} />
            ))}
          </>
        )}
        {india && !isExport(supplyKind) && (
          <SelectField
            label={t('invoices.fields.placeOfSupply')}
            value={pos ?? ''}
            onChange={(e) => setPlaceOfSupply(e.target.value)}
            disabled={!canManage}
            options={[{ value: '', label: t('invoices.outsideIndia') }, ...INDIAN_STATES.map((s) => ({ value: s.code, label: `${s.code} · ${s.name}` }))]}
            hint={supply ? t(`invoices.supply.${supply}`) : undefined}
          />
        )}
        <RegistrationSelect value={gstRegistrationId} onChange={setGstRegistrationId} disabled={!canManage} />
        <WarehouseSelect value={warehouseId} onChange={setWarehouseId} disabled={!canManage} />
      </Card>

      <Card className="overflow-hidden">
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[920px] text-sm">
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
                      {config.batches && l.itemId && items.data?.find((x) => x.id === l.itemId)?.trackBatches && <BatchSelect itemId={l.itemId} value={l.batchId} onChange={(v) => set(l.key, { batchId: v })} label={t('batches.lineBatch', { n: n + 1 })} disabled={!canManage} />}
                      {config.batches && l.itemId && items.data?.find((x) => x.id === l.itemId)?.trackSerials && <SerialsInput value={l.serials} onChange={(v) => set(l.key, { serials: v })} quantity={l.quantity} label={t('serials.lineSerials', { n: n + 1 })} disabled={!canManage} />}
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
                      <select aria-label={t('invoices.lineTax', { n: n + 1 })} value={l.group?.id ?? ''} disabled={!canManage || composition} title={composition ? t('settings.gstSchemes.composition') : undefined} onChange={(e) => set(l.key, { taxGroupId: e.target.value })} className={cell}>
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
            {rcm && (
              <>
                <dt className="text-ink-500">{t('invoices.reverseCharge.buyerPays')}</dt>
                <dd className="text-end font-mono tabular-nums" dir="ltr" data-testid="rcm-tax">
                  {plain(rcmTax)}
                </dd>
              </>
            )}
            {!!amounts.discount && (
              <>
                <dt className="text-ink-500">{t('invoices.discountIncluded')}</dt>
                <dd className="text-end font-mono tabular-nums" dir="ltr">
                  −{plain(amounts.discount)}
                </dd>
              </>
            )}
            {!!amounts.roundOff && (
              <>
                <dt className="text-ink-500">{t('invoices.roundOff')}</dt>
                <dd className="text-end font-mono tabular-nums" dir="ltr">
                  {plain(amounts.roundOff)}
                </dd>
              </>
            )}
            <dt className="border-t border-ink-200 pt-1 font-semibold dark:border-ink-700">{t('invoices.total')}</dt>
            <dd className="border-t border-ink-200 pt-1 text-end font-mono font-semibold tabular-nums dark:border-ink-700" dir="ltr">
              {formatMoney(amounts.total, currency, locale)}
            </dd>
          </dl>
        </div>
      </Card>

      {config.interest && (
        <Card className="flex flex-wrap items-end gap-4 p-5">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={inclusive} disabled={!canManage} onChange={(e) => setInclusive(e.target.checked)} className="size-4 rounded accent-brand-600" />
            {t('invoices.pricesIncludeTax')}
          </label>
          {india && supplyKind === 'regular' && (
            <label className="flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" checked={reverseCharge} disabled={!canManage} onChange={(e) => setReverseCharge(e.target.checked)} className="size-4 rounded accent-brand-600" />
              <span>
                {t('invoices.reverseCharge.label')}
                <span className="block text-xs font-normal text-ink-500">{t('invoices.reverseCharge.hint')}</span>
              </span>
            </label>
          )}
          <div className="w-40">
            <SelectField label={t('invoices.discountKind')} value={discKind} onChange={(e) => setDiscKind(e.target.value as 'percent' | 'amount')} disabled={!canManage} options={[{ value: 'percent', label: t('invoices.discountPercent') }, { value: 'amount', label: t('invoices.discountAmount', { currency }) }]} />
          </div>
          <div className="w-32">
            <TextField label={t('invoices.discountValue')} value={discText} onChange={(e) => setDiscText(e.target.value)} disabled={!canManage} inputMode="decimal" dir="ltr" className="text-end font-mono" placeholder="0" />
          </div>
        </Card>
      )}
      {config.interest && (
        <Card className="p-5">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={!!shipTo}
              disabled={!canManage}
              onChange={(e) => {
                const s = customer?.shippingAddress;
                setShipTo(e.target.checked ? { name: null, line1: s?.line1 ?? null, line2: s?.line2 ?? null, city: s?.city ?? null, region: s?.region ?? null, postalCode: s?.postalCode ?? null, country: s?.country ?? 'IN' } : null);
              }}
              className="size-4 rounded accent-brand-600"
            />
            {t('shipTo.toggle')}
          </label>
          {shipTo && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {!!customer?.shipAddresses?.length && (
                <div className="sm:col-span-2">
                  <SelectField
                    label={t('shipTo.saved')}
                    value=""
                    onChange={(e) => {
                      const a = customer.shipAddresses![Number(e.target.value)];
                      if (a) setShipTo({ name: a.label, line1: a.line1, line2: a.line2, city: a.city, region: a.region, postalCode: a.postalCode, country: a.country ?? 'IN' });
                    }}
                    disabled={!canManage}
                    options={[{ value: '', label: t('shipTo.pickSaved') }, ...customer.shipAddresses.map((a, n) => ({ value: String(n), label: `${a.label}${a.city ? ` · ${a.city}` : ''}` }))]}
                  />
                </div>
              )}
              <div className="sm:col-span-2">
                <TextField label={t('shipTo.name')} value={shipTo.name ?? ''} onChange={(e) => setShipTo({ ...shipTo, name: e.target.value || null })} disabled={!canManage} dir="auto" placeholder={customer?.name} />
              </div>
              <IndianAddressFields value={{ line1: shipTo.line1 ?? '', line2: shipTo.line2 ?? '', city: shipTo.city ?? '', region: shipTo.region ?? '', postalCode: shipTo.postalCode ?? '' }} onChange={(patch) => setShipTo((x) => (x ? { ...x, ...Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, v || null])) } : x))} disabled={!canManage} />
              {shipToState && shipToState !== customer?.stateCode && <p className="text-xs text-ink-500 sm:col-span-2">{t('shipTo.posHint')}</p>}
            </div>
          )}
        </Card>
      )}
      {config.interest && (
        <Card className="p-5">
          <button type="button" className="text-sm font-medium text-brand-700 hover:underline dark:text-brand-300" aria-expanded={showDispatch} onClick={() => setShowDispatch((x) => !x)}>
            {t('dispatch.title')}
          </button>
          {showDispatch && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {(['buyerOrderNo', 'buyerOrderDate', 'deliveryNote', 'dispatchDocNo', 'dispatchedThrough', 'destination', 'vehicleNo', 'termsOfDelivery'] as const).map((k) => (
                <TextField key={k} label={t(`dispatch.fields.${k}`)} type={k === 'buyerOrderDate' ? 'date' : 'text'} value={dispatch[k] ?? ''} onChange={(e) => setDispatch((d) => ({ ...d, [k]: e.target.value || null }))} disabled={!canManage} dir={k === 'vehicleNo' || k === 'dispatchDocNo' ? 'ltr' : 'auto'} />
              ))}
            </div>
          )}
        </Card>
      )}
      {config.interest && <InstalmentsEditor value={instalments} onChange={setInstalments} total={amounts.total} issueDate={issueDate} plain={plain} digits={digits} disabled={!canManage} />}
      <Card className="p-5">
        <TextField label={t('invoices.fields.notes')} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={!canManage} dir="auto" placeholder={t('invoices.notesPlaceholder')} />
      </Card>

      {overLimit && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200" data-testid="credit-limit-warning">
          {t('invoices.overLimit', { name: customer!.name, amount: `${currency} ${plain(owedAfter)}`, limit: `${currency} ${plain(customer!.creditLimit!)}` })}
        </p>
      )}
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
