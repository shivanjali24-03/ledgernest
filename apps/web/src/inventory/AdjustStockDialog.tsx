import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { parseSerials, toMinor, todayIn } from '@ledgernest/shared';
import { useTranslation } from 'react-i18next';
import { useAccountsApi } from '../accounts/useAccountsApi';
import { useItemsApi } from '../items/useItemsApi';
import { useMoney } from '../lib/useMoney';
import { useSession } from '../layout/session';
import { useOrganizationSettings } from '../settings/useOrganizationSettings';
import Button from '../ui/Button';
import { SelectField, TextField } from '../ui/Field';
import { Segmented } from '../ui/Kit';
import Modal from '../ui/Modal';
import { useToast } from '../ui/toastContext';
import { inventoryErrorMessage } from './errors';
import SerialsInput from './SerialsInput';
import type { InventoryApi } from './types';

type Direction = 'in' | 'out';

/** Count stock up (opening stock, found) or down (damaged, lost, used in-house), against another account */
export default function AdjustStockDialog({ api, itemId: initial, onClose }: { api: InventoryApi; itemId?: string; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const money = useMoney();
  const session = useSession();
  const settings = useOrganizationSettings().data;
  const role = session.role ?? session.customRoleName;
  const itemsApi = useItemsApi();
  const accountsApi = useAccountsApi();
  const items = useQuery({ queryKey: ['items', session.organizationId, role, 'goods'], queryFn: () => itemsApi!.list({ kind: 'goods' }), enabled: !!itemsApi });
  const accounts = useQuery({ queryKey: ['accounts', session.organizationId, role, 'all'], queryFn: () => accountsApi!.list(true), enabled: !!accountsApi });
  const tracked = (items.data ?? []).filter((i) => i.trackStock);
  const [itemId, setItem] = useState(initial ?? '');
  const item = tracked.find((i) => i.id === (itemId || tracked[0]?.id));
  const [direction, setDirection] = useState<Direction>('out');
  const [date, setDate] = useState(() => todayIn(settings?.timeZone ?? 'Asia/Kolkata'));
  const [quantity, setQuantity] = useState('');
  const [unitCost, setUnitCost] = useState('');
  const [accountId, setAccount] = useState('');
  const [reason, setReason] = useState('');
  const [batchNo, setBatchNo] = useState('');
  const [mfgDate, setMfgDate] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const batched = !!item?.trackBatches;
  const serialed = !!item?.trackSerials;
  const [serials, setSerials] = useState('');
  const batches = useQuery({ queryKey: ['items', session.organizationId, 'batches', item?.id], queryFn: () => itemsApi!.batches(item!.id), enabled: !!itemsApi && batched });
  const others = (accounts.data ?? []).filter((a) => !a.archived && a.childCount === 0 && !a.currency && a.id !== item?.inventoryAccountId);
  // Write-offs usually go to an expense; stock counted in, to equity (opening stock) or an expense (found)
  const suggested = others.filter((a) => (direction === 'out' ? a.type === 'expense' : a.type === 'equity' || a.type === 'expense'));
  const account = accountId || suggested[0]?.id || '';
  const qtyOk = /^\d{1,9}(\.\d{1,4})?$/.test(quantity.trim()) && Number(quantity) > 0;
  const cost = unitCost.trim() ? toMinor(unitCost, money.digits) : null;
  const problem = !item ? 'item' : !qtyOk ? 'quantity' : unitCost.trim() && cost === null ? 'unitCost' : batched && !batchNo.trim() ? 'batch' : serialed && !parseSerials(serials).length ? 'serials' : !account ? 'account' : reason.trim().length < 3 ? 'reason' : null;
  const save = useMutation({
    mutationFn: () => api.adjust({ itemId: item!.id, date, direction, quantity: quantity.trim(), unitCost: direction === 'in' ? cost : null, accountId: account, reason: reason.trim(), ...(batched ? { batchNo: batchNo.trim(), mfgDate: direction === 'in' ? mfgDate || null : null, expiryDate: direction === 'in' ? expiryDate || null : null } : {}), ...(serialed ? { serials: parseSerials(serials) } : {}) }),
    onSuccess: (m) => {
      for (const k of ['inventory', 'items', 'journals', 'reports']) void qc.invalidateQueries({ queryKey: [k] });
      toast(t(direction === 'in' ? 'inventory.addedToast' : 'inventory.writtenOffToast', { quantity: m.quantity.replace(/^-/, ''), item: m.item }));
      onClose();
    },
    onError: (e) => toast(inventoryErrorMessage(e, t), 'error'),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (problem) return toast(t(`inventory.problems.${problem}`), 'error');
    save.mutate();
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={t('inventory.adjustTitle')}
      description={t('inventory.adjustBody')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="stock-form" loading={save.isPending} disabled={!!problem}>
            {t('inventory.adjust')}
          </Button>
        </>
      }
    >
      <form id="stock-form" onSubmit={submit} noValidate className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <SelectField label={t('inventory.fields.item')} value={item?.id ?? ''} onChange={(e) => setItem(e.target.value)} options={tracked.length ? tracked.map((i) => ({ value: i.id, label: i.name })) : [{ value: '', label: t('inventory.noTracked') }]} hint={item?.stock ? t('inventory.onHandHint', { quantity: item.stock.onHand, value: money.format(item.stock.value) }) : undefined} />
        </div>
        <div className="sm:col-span-2">
          <Segmented<Direction>
            label={t('inventory.fields.direction')}
            value={direction}
            onChange={(v) => (setDirection(v), setAccount(''))}
            options={[
              { value: 'out', label: t('inventory.directions.out') },
              { value: 'in', label: t('inventory.directions.in') },
            ]}
          />
        </div>
        <TextField label={t('inventory.fields.date')} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <TextField label={t('inventory.fields.quantity')} value={quantity} onChange={(e) => setQuantity(e.target.value)} inputMode="decimal" dir="ltr" className="text-end font-mono" data-autofocus />
        {direction === 'in' && (
          <TextField
            label={t('inventory.fields.unitCost', { currency: money.currency })}
            value={unitCost}
            onChange={(e) => setUnitCost(e.target.value)}
            onBlur={() => cost && setUnitCost(money.plain(cost))}
            placeholder={item?.stock?.averageCost ? money.plain(item.stock.averageCost) : undefined}
            hint={t('inventory.unitCostHint')}
            inputMode="decimal"
            dir="ltr"
            className="text-end font-mono"
          />
        )}
        {serialed && (
          <div className="sm:col-span-2">
            <SerialsInput value={serials} onChange={setSerials} quantity={quantity || '0'} label={t('serials.serials')} />
          </div>
        )}
        {batched &&
          (direction === 'out' ? (
            <SelectField
              label={t('batches.batch')}
              value={batchNo}
              onChange={(e) => setBatchNo(e.target.value)}
              options={[{ value: '', label: t('batches.choose') }, ...(batches.data ?? []).filter((b) => b.onHand !== '0').map((b) => ({ value: b.batchNo, label: t(b.expired ? 'batches.optionExpired' : 'batches.option', { batch: b.batchNo, expiry: b.expiryDate ?? '—', onHand: b.onHand }) }))]}
            />
          ) : (
            <>
              <TextField label={t('batches.batchNo')} value={batchNo} onChange={(e) => setBatchNo(e.target.value)} dir="ltr" className="font-mono" />
              <TextField label={t('batches.mfgDate')} type="date" value={mfgDate} onChange={(e) => setMfgDate(e.target.value)} />
              <TextField label={t('batches.expiryDate')} type="date" value={expiryDate} min={mfgDate || undefined} onChange={(e) => setExpiryDate(e.target.value)} />
            </>
          ))}
        <SelectField label={t('inventory.fields.account')} value={account} onChange={(e) => setAccount(e.target.value)} options={[...suggested, ...others.filter((a) => !suggested.includes(a))].map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` }))} />
        <div className="sm:col-span-2">
          <TextField label={t('inventory.fields.reason')} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t(direction === 'in' ? 'inventory.reasonInExample' : 'inventory.reasonOutExample')} maxLength={500} dir="auto" />
        </div>
      </form>
    </Modal>
  );
}
