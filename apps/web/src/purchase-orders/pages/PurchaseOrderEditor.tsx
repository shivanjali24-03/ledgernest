import { useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { motion } from 'motion/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Ban, FileInput, PackageCheck, Plus, Send, Trash2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { parseQuantity, todayIn } from '@ledgernest/shared';
import { ApiError } from '../../auth/client';
import { apiErrorMessage } from '../../platform/errors';
import { useAccountsApi } from '../../accounts/useAccountsApi';
import { useContactsApi } from '../../contacts/useContactsApi';
import { useItemsApi } from '../../items/useItemsApi';
import { useSession } from '../../layout/session';
import { useMoney } from '../../lib/useMoney';
import { fadeUp, stagger } from '../../motion/tokens';
import { useTaxesApi } from '../../taxes/useTaxesApi';
import Button from '../../ui/Button';
import { inputClass, SelectField, TextField } from '../../ui/Field';
import { Card, ErrorState, PageHeader, Pill, SkeletonRows } from '../../ui/Kit';
import Modal from '../../ui/Modal';
import { useToast } from '../../ui/toastContext';
import type { PurchaseOrder, PurchaseOrdersApi } from '../types';
import { usePurchaseOrdersApi } from '../usePurchaseOrdersApi';

const REASONS = ['not_draft', 'bad_move', 'not_issued', 'over_received', 'nothing_to_bill', 'before_order', 'not_vendor'];
const errorMessage = (e: unknown, t: TFunction) => {
  const reason = e instanceof ApiError ? e.details?.reason : undefined;
  return typeof reason === 'string' && REASONS.includes(reason) ? t(`purchaseOrders.errors.${reason}`, { toReceive: e instanceof ApiError ? e.details?.toReceive : undefined }) : apiErrorMessage(e, t);
};

type Line = { key: string; itemId: string; description: string; quantity: string; unitPrice: string; taxGroupId: string; accountId: string };
const blank = (): Line => ({ key: crypto.randomUUID(), itemId: '', description: '', quantity: '1', unitPrice: '', taxGroupId: '', accountId: '' });
const toMinor = (s: string) => (s.trim() && /^\d+(\.\d{1,2})?$/.test(s.trim().replace(/,/g, '')) ? Math.round(Number(s.trim().replace(/,/g, '')) * 100) : null);

/** A draft order: the vendor, the dates, and the lines as on a bill */
function DraftForm({ order, api }: { order: PurchaseOrder | null; api: PurchaseOrdersApi }) {
  const { t } = useTranslation();
  const session = useSession();
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const role = session.role ?? session.customRoleName;
  const contactsApi = useContactsApi();
  const itemsApi = useItemsApi();
  const taxesApi = useTaxesApi();
  const accountsApi = useAccountsApi();
  const vendors = useQuery({ queryKey: ['contacts', session.organizationId, role, 'vendors'], queryFn: () => contactsApi!.list({ type: 'vendor', page: 1, pageSize: 100 }), enabled: !!contactsApi });
  const items = useQuery({ queryKey: ['items', session.organizationId, role, 'active'], queryFn: () => itemsApi!.list({}), enabled: !!itemsApi });
  const taxes = useQuery({ queryKey: ['taxes', session.organizationId, role], queryFn: () => taxesApi!.list(), enabled: !!taxesApi });
  const accounts = useQuery({ queryKey: ['accounts', session.organizationId, role, 'all'], queryFn: () => accountsApi!.list(true), enabled: !!accountsApi });
  const costAccounts = useMemo(() => (accounts.data ?? []).filter((a) => (a.type === 'expense' || a.type === 'asset') && !a.archived && !['bank', 'cash', 'accounts_receivable'].includes(a.subtype)), [accounts.data]);
  const [contactId, setContactId] = useState(order?.contact.id ?? '');
  const [orderDate, setOrderDate] = useState(order?.orderDate ?? todayIn('Asia/Kolkata'));
  const [expectedDate, setExpectedDate] = useState(order?.expectedDate ?? '');
  const [reference, setReference] = useState(order?.reference ?? '');
  const [notes, setNotes] = useState(order?.notes ?? '');
  const [lines, setLines] = useState<Line[]>(order?.lines.length ? order.lines.map((l) => ({ key: l.id, itemId: l.item?.id ?? '', description: l.description, quantity: l.quantity, unitPrice: (l.unitPrice / 100).toFixed(2), taxGroupId: l.taxGroup?.id ?? '', accountId: l.account?.id ?? '' })) : [blank()]);
  const set = (key: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const pick = (key: string, itemId: string) => {
    const item = items.data?.find((x) => x.id === itemId);
    set(key, item ? { itemId, description: item.name, unitPrice: item.purchasePrice !== null ? (item.purchasePrice / 100).toFixed(2) : '', taxGroupId: item.taxGroupId ?? '', accountId: item.expenseAccountId ?? '' } : { itemId: '' });
  };
  const filled = lines.filter((l) => l.description.trim() || l.unitPrice.trim());
  const invalid = !contactId || !filled.length || filled.some((l) => !l.description.trim() || toMinor(l.unitPrice) === null || parseQuantity(l.quantity) === null);
  const save = useMutation({
    mutationFn: () => {
      const input = { contactId, orderDate, expectedDate: expectedDate || null, reference, notes, lines: filled.map((l) => ({ itemId: l.itemId || null, description: l.description, quantity: l.quantity, unitPrice: toMinor(l.unitPrice)!, discount: 0, taxGroupId: l.taxGroupId || null, accountId: l.accountId || null })) };
      return order ? api.update(order.id, input) : api.create(input);
    },
    onSuccess: (o) => {
      void queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      toast(t('purchaseOrders.saved', { number: o.number }));
      navigate(`/purchase-orders/${o.id}`, { replace: true });
    },
    onError: (e) => toast(errorMessage(e, t), 'error'),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!invalid) save.mutate();
  };
  const cell = `${inputClass} h-9 border-ink-200 dark:border-ink-700`;
  return (
    <form onSubmit={submit} className="space-y-4">
      <Card className="grid gap-4 p-5 sm:grid-cols-2">
        <SelectField label={t('bills.fields.vendor')} value={contactId} onChange={(e) => setContactId(e.target.value)} options={[{ value: '', label: t('bills.chooseVendor') }, ...(vendors.data?.items ?? []).map((c) => ({ value: c.id, label: c.name }))]} />
        <TextField label={t('purchaseOrders.fields.reference')} value={reference} onChange={(e) => setReference(e.target.value)} dir="auto" />
        <TextField label={t('purchaseOrders.fields.orderDate')} type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} />
        <TextField label={t('purchaseOrders.fields.expectedDate')} type="date" value={expectedDate} min={orderDate} onChange={(e) => setExpectedDate(e.target.value)} />
      </Card>
      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[820px] text-sm" aria-label={t('purchaseOrders.lines')}>
          <thead className="border-b border-ink-100 text-xs uppercase tracking-wide text-ink-400 dark:border-ink-800">
            <tr>
              {['item', 'description', 'quantity', 'price', 'tax', 'account'].map((c) => (
                <th key={c} scope="col" className="px-3 py-2 text-start font-semibold">{t(`purchaseOrders.columns.${c}`)}</th>
              ))}
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, n) => (
              <tr key={l.key}>
                <td className="px-3 py-1.5">
                  <select aria-label={t('invoices.lineItem', { n: n + 1 })} value={l.itemId} onChange={(e) => pick(l.key, e.target.value)} className={cell}>
                    <option value="">—</option>
                    {(items.data ?? []).map((i) => (
                      <option key={i.id} value={i.id}>{i.name}</option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-1.5"><input aria-label={t('invoices.lineDescription', { n: n + 1 })} value={l.description} onChange={(e) => set(l.key, { description: e.target.value })} className={cell} dir="auto" /></td>
                <td className="px-3 py-1.5"><input aria-label={t('invoices.lineQty', { n: n + 1 })} value={l.quantity} onChange={(e) => set(l.key, { quantity: e.target.value })} className={`${cell} w-20 text-end`} inputMode="decimal" dir="ltr" /></td>
                <td className="px-3 py-1.5"><input aria-label={t('invoices.linePrice', { n: n + 1 })} value={l.unitPrice} onChange={(e) => set(l.key, { unitPrice: e.target.value })} className={`${cell} w-28 text-end`} inputMode="decimal" dir="ltr" /></td>
                <td className="px-3 py-1.5">
                  <select aria-label={t('invoices.lineTax', { n: n + 1 })} value={l.taxGroupId} onChange={(e) => set(l.key, { taxGroupId: e.target.value })} className={cell}>
                    <option value="">{t('journals.tax.none')}</option>
                    {(taxes.data?.groups ?? []).filter((g) => !g.archived).map((g) => (
                      <option key={g.id} value={g.id}>{g.name}</option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-1.5">
                  <select aria-label={t('bills.lineAccount', { n: n + 1 })} value={l.accountId} onChange={(e) => set(l.key, { accountId: e.target.value })} className={cell}>
                    <option value="">{t('bills.chooseAccount')}</option>
                    {costAccounts.map((a) => (
                      <option key={a.id} value={a.id}>{a.code} · {a.name}</option>
                    ))}
                  </select>
                </td>
                <td className="pe-2">
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
        <div className="p-3">
          <Button type="button" variant="ghost" icon={<Plus className="size-4" />} onClick={() => setLines((ls) => [...ls, blank()])}>
            {t('journals.addLine')}
          </Button>
        </div>
      </Card>
      <Card className="p-5">
        <TextField label={t('invoices.fields.notes')} value={notes} onChange={(e) => setNotes(e.target.value)} dir="auto" />
      </Card>
      <div className="flex justify-end">
        <Button type="submit" loading={save.isPending} disabled={invalid}>
          {t('purchaseOrders.save')}
        </Button>
      </div>
    </form>
  );
}

/** Recording what came against the order: a quantity for each line still to come */
function ReceiveDialog({ order, api, onClose }: { order: PurchaseOrder; api: PurchaseOrdersApi; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const open = order.lines.filter((l) => (parseQuantity(l.toReceive) ?? 0n) > 0n);
  const [date, setDate] = useState(todayIn('Asia/Kolkata'));
  const [reference, setReference] = useState('');
  const [qty, setQty] = useState<Record<string, string>>(Object.fromEntries(open.map((l) => [l.id, l.toReceive])));
  const save = useMutation({
    mutationFn: () => api.receive(order.id, { date, reference, lines: open.filter((l) => (parseQuantity(qty[l.id] ?? '') ?? 0n) > 0n).map((l) => ({ lineId: l.id, quantity: qty[l.id]! })) }),
    onSuccess: (o) => {
      void queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      toast(t('purchaseOrders.received', { number: o.receipts.at(-1)?.number }));
      onClose();
    },
    onError: (e) => toast(errorMessage(e, t), 'error'),
  });
  return (
    <Modal open onClose={onClose} title={t('purchaseOrders.receiveTitle', { number: order.number })} footer={<Button type="submit" form="grn-form" loading={save.isPending}>{t('purchaseOrders.recordReceipt')}</Button>}>
      <form id="grn-form" onSubmit={(e) => (e.preventDefault(), save.mutate())} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label={t('purchaseOrders.fields.receivedOn')} type="date" value={date} min={order.orderDate} onChange={(e) => setDate(e.target.value)} />
          <TextField label={t('purchaseOrders.fields.challan')} value={reference} onChange={(e) => setReference(e.target.value)} dir="auto" />
        </div>
        {open.map((l) => (
          <TextField key={l.id} label={t('purchaseOrders.receiveLine', { description: l.description, left: l.toReceive })} value={qty[l.id] ?? ''} onChange={(e) => setQty((q) => ({ ...q, [l.id]: e.target.value }))} inputMode="decimal" dir="ltr" className="text-end" />
        ))}
      </form>
    </Modal>
  );
}

export default function PurchaseOrderEditor() {
  const { id } = useParams();
  const { t } = useTranslation();
  const session = useSession();
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const money = useMoney();
  const api = usePurchaseOrdersApi();
  const isNew = !id || id === 'new';
  const key = ['purchase-orders', session.organizationId, 'one', id] as const;
  const query = useQuery({ queryKey: key, queryFn: () => api!.get(id!), enabled: !!api && !isNew });
  const order = query.data;
  const canManage = session.permissions.has('bills.manage');
  const [receiving, setReceiving] = useState(false);
  const done = (o: PurchaseOrder) => {
    queryClient.setQueryData(key, o);
    void queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
  };
  const move = useMutation({ mutationFn: (s: 'issued' | 'cancelled' | 'closed') => api!.move(order!.id, s), onSuccess: done, onError: (e) => toast(errorMessage(e, t), 'error') });
  const remove = useMutation({ mutationFn: () => api!.remove(order!.id), onSuccess: () => (void queryClient.invalidateQueries({ queryKey: ['purchase-orders'] }), navigate('/purchase-orders')), onError: (e) => toast(errorMessage(e, t), 'error') });
  const bill = useMutation({
    mutationFn: () => api!.bill(order!.id),
    onSuccess: (r) => {
      for (const k of ['purchase-orders', 'bills']) void queryClient.invalidateQueries({ queryKey: [k] });
      toast(t('purchaseOrders.billed'));
      navigate(`/bills/${r.billId}`);
    },
    onError: (e) => toast(errorMessage(e, t), 'error'),
  });
  const toBill = order?.lines.some((l) => (parseQuantity(l.toBill) ?? 0n) > 0n);
  const toReceive = order?.lines.some((l) => (parseQuantity(l.toReceive) ?? 0n) > 0n);
  return (
    <motion.div variants={stagger(0.06)} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={fadeUp}>
        <Link to="/purchase-orders" className="mb-2 inline-flex items-center gap-1 text-sm text-ink-500 hover:text-ink-800 dark:hover:text-ink-200">
          <ArrowLeft className="size-4 rtl:-scale-x-100" aria-hidden /> {t('purchaseOrders.title')}
        </Link>
        <PageHeader
          title={isNew ? t('purchaseOrders.new') : (order?.number ?? '')}
          description={order ? order.contact.name : undefined}
          actions={
            order && canManage ? (
              <>
                <Pill tone={order.status === 'issued' ? 'brand' : 'neutral'}>{t(`purchaseOrders.statuses.${order.status}`)}</Pill>
                {order.status === 'draft' && (
                  <Button icon={<Send className="size-4" />} loading={move.isPending} onClick={() => move.mutate('issued')}>
                    {t('purchaseOrders.issue')}
                  </Button>
                )}
                {order.status === 'issued' && toReceive && (
                  <Button icon={<PackageCheck className="size-4" />} onClick={() => setReceiving(true)}>
                    {t('purchaseOrders.receive')}
                  </Button>
                )}
                {order.status === 'issued' && toBill && (
                  <Button variant="secondary" icon={<FileInput className="size-4" />} loading={bill.isPending} onClick={() => bill.mutate()}>
                    {t('purchaseOrders.makeBill')}
                  </Button>
                )}
                {order.status === 'issued' && (
                  <Button variant="ghost" icon={<Ban className="size-4" />} onClick={() => move.mutate(order.lines.some((l) => l.received !== '0') ? 'closed' : 'cancelled')}>
                    {t(order.lines.some((l) => l.received !== '0') ? 'purchaseOrders.close' : 'purchaseOrders.cancel')}
                  </Button>
                )}
                {order.status === 'draft' && (
                  <Button variant="ghost" icon={<Trash2 className="size-4" />} loading={remove.isPending} onClick={() => remove.mutate()}>
                    {t('purchaseOrders.delete')}
                  </Button>
                )}
              </>
            ) : undefined
          }
        />
      </motion.div>
      <motion.div variants={fadeUp} className="space-y-4">
        {!api ? null : isNew ? (
          canManage ? <DraftForm order={null} api={api} /> : null
        ) : query.isPending ? (
          <Card><SkeletonRows rows={6} /></Card>
        ) : query.isError || !order ? (
          <Card><ErrorState onRetry={() => void query.refetch()} /></Card>
        ) : order.status === 'draft' && canManage ? (
          <DraftForm key={order.id} order={order} api={api} />
        ) : (
          <>
            <Card className="overflow-x-auto p-0">
              <table className="w-full min-w-[640px] text-sm" aria-label={t('purchaseOrders.lines')}>
                <thead className="border-b border-ink-100 text-xs uppercase tracking-wide text-ink-400 dark:border-ink-800">
                  <tr>
                    <th scope="col" className="px-4 py-2.5 text-start font-semibold">{t('purchaseOrders.columns.description')}</th>
                    {['ordered', 'receivedCol', 'billedCol'].map((c) => (
                      <th key={c} scope="col" className="px-4 py-2.5 text-end font-semibold">{t(`purchaseOrders.columns.${c}`)}</th>
                    ))}
                    <th scope="col" className="px-4 py-2.5 text-end font-semibold">{t('purchaseOrders.columns.amount')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
                  {order.lines.map((l) => (
                    <tr key={l.id}>
                      <td className="px-4 py-2.5" dir="auto">{l.description}</td>
                      <td className="px-4 py-2.5 text-end font-mono" dir="ltr">{l.quantity}</td>
                      <td className="px-4 py-2.5 text-end font-mono" dir="ltr">{l.received}</td>
                      <td className="px-4 py-2.5 text-end font-mono" dir="ltr">{l.billed}</td>
                      <td className="px-4 py-2.5 text-end font-mono tabular-nums" dir="ltr">{money.plain(l.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="border-t border-ink-100 px-4 py-3 text-end font-semibold dark:border-ink-800">
                {t('invoices.total')} <span className="font-mono" dir="ltr">{money.format(order.total)}</span>
              </p>
            </Card>
            {(order.receipts.length > 0 || order.bills.length > 0) && (
              <Card className="space-y-2 p-5 text-sm">
                {order.receipts.map((r) => (
                  <p key={r.id}>
                    <span className="font-mono font-semibold" dir="ltr">{r.number}</span> · {r.date}
                    {r.reference && ` · ${r.reference}`}
                  </p>
                ))}
                {order.bills.map((b) => (
                  <p key={b.id}>
                    <Link to={`/bills/${b.id}`} className="font-mono text-brand-700 hover:underline dark:text-brand-300">{b.number ?? t('bills.draftTitle')}</Link> · {money.plain(b.total)}
                  </p>
                ))}
              </Card>
            )}
          </>
        )}
      </motion.div>
      {receiving && order && api && <ReceiveDialog order={order} api={api} onClose={() => setReceiving(false)} />}
    </motion.div>
  );
}
