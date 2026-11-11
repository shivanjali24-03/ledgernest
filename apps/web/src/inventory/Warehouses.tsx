import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { todayIn } from '@ledgernest/shared';
import { ArrowRightLeft, Archive, Plus, Star, Warehouse as WarehouseIcon, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../auth/client';
import { useIntlLocale } from '../i18n';
import { formatDate } from '../lib/format';
import { useMoney } from '../lib/useMoney';
import { useSession } from '../layout/session';
import Button from '../ui/Button';
import { SelectField, TextField } from '../ui/Field';
import { Card, Pill } from '../ui/Kit';
import Modal from '../ui/Modal';
import { useToast } from '../ui/toastContext';
import type { InventoryApi, Warehouse } from './types';

const REASONS = ['name_taken', 'code_taken', 'warehouse_default', 'warehouse_has_stock', 'warehouse_invalid', 'insufficient_stock', 'insufficient_unexpired', 'not_tracked', 'serials_count'];
const message = (e: unknown, t: (k: string) => string) => {
  const reason = e instanceof ApiError ? e.details?.reason : undefined;
  return typeof reason === 'string' && REASONS.includes(reason) ? t(`warehouses.errors.${reason}`) : t('warehouses.errors.failed');
};

/** The places stock is kept: what each holds, a new one, the main one, and goods moved between them */
export default function Warehouses({ api, items }: { api: InventoryApi; items: { itemId: string; name: string }[] }) {
  const { t } = useTranslation();
  const money = useMoney();
  const locale = useIntlLocale();
  const toast = useToast();
  const session = useSession();
  const queryClient = useQueryClient();
  const canManage = session.permissions.has('org.settings.manage');
  const canMove = session.permissions.has('invoices.manage');
  const key = ['inventory', session.organizationId, 'warehouses'];
  const list = useQuery({ queryKey: key, queryFn: () => api.warehouses() });
  const transfers = useQuery({ queryKey: ['inventory', session.organizationId, 'transfers'], queryFn: () => api.transfers(), enabled: !!list.data?.warehouses.length });
  const [adding, setAdding] = useState(false);
  const [moving, setMoving] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['inventory'] });
  const update = useMutation({
    mutationFn: ({ w, action }: { w: Warehouse; action: 'main' | 'archive' }) => (action === 'main' ? api.updateWarehouse(w.id, { isDefault: true }).then(() => undefined) : api.archiveWarehouse(w.id)),
    onSuccess: (_r, { w, action }) => {
      refresh();
      toast(t(action === 'main' ? 'warehouses.madeMain' : 'warehouses.archived', { name: w.name }));
    },
    onError: (e) => toast(message(e, t), 'error'),
  });
  const active = (list.data?.warehouses ?? []).filter((w) => !w.archived);

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-ink-100 px-5 py-3 dark:border-ink-800">
        <WarehouseIcon className="size-5 text-ink-400" aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">{t('warehouses.title')}</h2>
          <p className="text-sm text-ink-500">{list.data?.warehouses.length ? t('warehouses.hint') : t('warehouses.none')}</p>
        </div>
        {canMove && active.length > 1 && (
          <Button size="sm" variant="secondary" icon={<ArrowRightLeft className="size-4" />} onClick={() => setMoving(true)}>
            {t('warehouses.move')}
          </Button>
        )}
        {canManage && (
          <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>
            {t('warehouses.add')}
          </Button>
        )}
      </div>
      {!!list.data?.warehouses.length && (
        <ul className="divide-y divide-ink-100 dark:divide-ink-800">
          {list.data.warehouses.map((w) => (
            <li key={w.id} className="px-5 py-3">
              <div className="flex flex-wrap items-center gap-3">
                <button type="button" onClick={() => setOpen(open === w.id ? null : w.id)} className="min-w-0 flex-1 text-start" aria-expanded={open === w.id}>
                  <span className="font-medium" dir="auto">
                    {w.name}
                  </span>{' '}
                  <span className="font-mono text-xs text-ink-500" dir="ltr">
                    {w.code}
                  </span>
                  <span className="block text-sm text-ink-500">{t('warehouses.holds', { count: w.items, value: money.format(w.value) })}</span>
                </button>
                {w.isDefault && <Pill tone="brand">{t('warehouses.main')}</Pill>}
                {w.archived && <Pill tone="neutral">{t('warehouses.archivedPill')}</Pill>}
                {canManage && !w.isDefault && !w.archived && (
                  <>
                    <Button size="sm" variant="ghost" icon={<Star className="size-4" />} onClick={() => update.mutate({ w, action: 'main' })}>
                      {t('warehouses.makeMain')}
                    </Button>
                    <Button size="sm" variant="ghost" icon={<Archive className="size-4" />} onClick={() => update.mutate({ w, action: 'archive' })}>
                      {t('warehouses.archive')}
                    </Button>
                  </>
                )}
              </div>
              {open === w.id && <Held api={api} warehouse={w} />}
            </li>
          ))}
        </ul>
      )}
      {!!transfers.data?.transfers.length && (
        <div className="border-t border-ink-100 px-5 py-3 dark:border-ink-800">
          <h3 className="mb-2 text-sm font-semibold">{t('warehouses.recent')}</h3>
          <ul className="space-y-1 text-sm">
            {transfers.data.transfers.slice(0, 10).map((x) => (
              <li key={x.id} className="flex flex-wrap gap-x-2">
                <span className="font-mono font-semibold" dir="ltr">
                  {x.number}
                </span>
                <span className="text-ink-500">{formatDate(`${x.date}T00:00:00Z`, locale)}</span>
                <span dir="auto">
                  {x.from.name} → {x.to.name}
                </span>
                <span className="text-ink-500">{x.lines.map((l) => `${l.item.name} × ${l.quantity}`).join(', ')}</span>
                <span className="ms-auto font-mono tabular-nums" dir="ltr">
                  {money.format(x.value)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {adding && <AddWarehouse api={api} first={!list.data?.warehouses.length} onClose={() => setAdding(false)} onDone={refresh} />}
      {moving && <MoveStock api={api} warehouses={active} items={items} onClose={() => setMoving(false)} onDone={refresh} />}
    </Card>
  );
}

function Held({ api, warehouse }: { api: InventoryApi; warehouse: Warehouse }) {
  const { t } = useTranslation();
  const money = useMoney();
  const session = useSession();
  const q = useQuery({ queryKey: ['inventory', session.organizationId, 'warehouse-stock', warehouse.id], queryFn: () => api.warehouseStock(warehouse.id) });
  if (!q.data) return <p className="mt-2 text-sm text-ink-500">…</p>;
  if (!q.data.items.length) return <p className="mt-2 text-sm text-ink-500">{t('warehouses.empty')}</p>;
  return (
    <table className="mt-2 w-full text-sm" aria-label={t('warehouses.stockOf', { name: warehouse.name })}>
      <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
        {q.data.items.map((i) => (
          <tr key={i.itemId}>
            <td className="py-1.5" dir="auto">
              {i.name}
            </td>
            <td className="py-1.5 text-end font-mono" dir="ltr">
              {i.quantity} {i.unit ?? ''}
            </td>
            <td className="py-1.5 text-end font-mono tabular-nums" dir="ltr">
              {money.plain(i.value)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function AddWarehouse({ api, first, onClose, onDone }: { api: InventoryApi; first: boolean; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [city, setCity] = useState('');
  const save = useMutation({
    mutationFn: () => api.createWarehouse({ name, ...(code.trim() ? { code } : {}), address: city.trim() ? { city } : null }),
    onSuccess: (w) => {
      toast(t('warehouses.added', { name: w.name }));
      onDone();
      onClose();
    },
    onError: (e) => toast(message(e, t), 'error'),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim()) save.mutate();
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={t('warehouses.addTitle')}
      description={first ? t('warehouses.firstBody') : undefined}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="warehouse-form" loading={save.isPending} disabled={!name.trim()}>
            {t('warehouses.save')}
          </Button>
        </>
      }
    >
      <form id="warehouse-form" onSubmit={submit} noValidate className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <TextField label={t('warehouses.fields.name')} value={name} onChange={(e) => setName(e.target.value)} placeholder={t('warehouses.namePlaceholder')} dir="auto" data-autofocus />
        </div>
        <TextField label={t('warehouses.fields.code')} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} hint={t('warehouses.codeHint')} dir="ltr" className="font-mono uppercase" />
        <TextField label={t('warehouses.fields.city')} value={city} onChange={(e) => setCity(e.target.value)} dir="auto" />
      </form>
    </Modal>
  );
}

function MoveStock({ api, warehouses, items, onClose, onDone }: { api: InventoryApi; warehouses: Warehouse[]; items: { itemId: string; name: string }[]; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [from, setFrom] = useState(warehouses.find((w) => w.isDefault)?.id ?? warehouses[0]!.id);
  const [to, setTo] = useState(warehouses.find((w) => w.id !== from)!.id);
  const [date, setDate] = useState(() => todayIn('Asia/Kolkata'));
  const [reference, setReference] = useState('');
  const [lines, setLines] = useState([{ itemId: items[0]?.itemId ?? '', quantity: '' }]);
  const save = useMutation({
    mutationFn: () => api.transfer({ date, fromWarehouseId: from, toWarehouseId: to, reference: reference || null, lines: lines.filter((l) => l.itemId && l.quantity.trim()).map((l) => ({ itemId: l.itemId, quantity: l.quantity.trim() })) }),
    onSuccess: (x) => {
      toast(t('warehouses.moved', { number: x.number }));
      onDone();
      onClose();
    },
    onError: (e) => toast(message(e, t), 'error'),
  });
  const ready = from !== to && lines.some((l) => l.itemId && Number(l.quantity) > 0);
  const options = warehouses.map((w) => ({ value: w.id, label: `${w.name} (${w.code})` }));
  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title={t('warehouses.moveTitle')}
      description={t('warehouses.moveBody')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="transfer-form" loading={save.isPending} disabled={!ready}>
            {t('warehouses.move')}
          </Button>
        </>
      }
    >
      <form id="transfer-form" onSubmit={(e) => (e.preventDefault(), ready && save.mutate())} noValidate className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField label={t('warehouses.fields.from')} value={from} onChange={(e) => setFrom(e.target.value)} options={options} />
          <SelectField label={t('warehouses.fields.to')} value={to} onChange={(e) => setTo(e.target.value)} options={options} error={from === to ? t('warehouses.samePlace') : undefined} />
          <TextField label={t('warehouses.fields.date')} type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
          <TextField label={t('warehouses.fields.reference')} value={reference} onChange={(e) => setReference(e.target.value)} placeholder="LR 4471" dir="auto" />
        </div>
        {lines.map((l, n) => (
          <div key={n} className="flex items-end gap-2">
            <div className="flex-1">
              <SelectField label={t('warehouses.fields.item', { n: n + 1 })} value={l.itemId} onChange={(e) => setLines((ls) => ls.map((x, k) => (k === n ? { ...x, itemId: e.target.value } : x)))} options={items.map((i) => ({ value: i.itemId, label: i.name }))} />
            </div>
            <div className="w-28">
              <TextField label={t('warehouses.fields.quantity', { n: n + 1 })} value={l.quantity} onChange={(e) => setLines((ls) => ls.map((x, k) => (k === n ? { ...x, quantity: e.target.value } : x)))} inputMode="decimal" dir="ltr" className="text-end" />
            </div>
            {lines.length > 1 && (
              <Button variant="ghost" size="sm" icon={<X className="size-4" />} aria-label={t('warehouses.removeLine', { n: n + 1 })} onClick={() => setLines((ls) => ls.filter((_x, k) => k !== n))} />
            )}
          </div>
        ))}
        <Button type="button" size="sm" variant="ghost" icon={<Plus className="size-4" />} onClick={() => setLines((ls) => [...ls, { itemId: items[0]?.itemId ?? '', quantity: '' }])}>
          {t('warehouses.addLine')}
        </Button>
      </form>
    </Modal>
  );
}
