import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { parseSerials, toMinor, todayIn, type OpeningStockInput } from '@ledgernest/shared';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { useItemsApi } from '../items/useItemsApi';
import { useMoney } from '../lib/useMoney';
import { useSession } from '../layout/session';
import { useOrganizationSettings } from '../settings/useOrganizationSettings';
import Button from '../ui/Button';
import { inputClass, TextField } from '../ui/Field';
import Modal from '../ui/Modal';
import { useToast } from '../ui/toastContext';
import { inventoryErrorMessage } from './errors';
import SerialsInput from './SerialsInput';
import type { InventoryApi } from './types';

type Row = { quantity: string; unitCost: string; batchNo: string; expiryDate: string; serials: string };
const blank: Row = { quantity: '', unitCost: '', batchNo: '', expiryDate: '', serials: '' };

/**
 * Opening stock when the books start: every tracked item in one list, with how many there are and what one cost,
 * saved together against Opening balance equity. Goods kept in batches or by serial number say which.
 */
export default function OpeningStockDialog({ api, onClose }: { api: InventoryApi; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const money = useMoney();
  const session = useSession();
  const settings = useOrganizationSettings().data;
  const itemsApi = useItemsApi();
  const items = useQuery({ queryKey: ['items', session.organizationId, session.role ?? session.customRoleName, 'goods'], queryFn: () => itemsApi!.list({ kind: 'goods' }), enabled: !!itemsApi });
  const tracked = (items.data ?? []).filter((i) => i.trackStock);
  const [date, setDate] = useState(() => todayIn(settings?.timeZone ?? 'Asia/Kolkata'));
  const [rows, setRows] = useState<Record<string, Row>>({});
  const row = (id: string) => rows[id] ?? blank;
  const set = (id: string, patch: Partial<Row>) => setRows((r) => ({ ...r, [id]: { ...(r[id] ?? blank), ...patch } }));
  const qtyOk = (q: string) => /^\d{1,9}(\.\d{1,4})?$/.test(q.trim()) && Number(q) > 0;
  const filled = tracked.filter((i) => row(i.id).quantity.trim());
  const bad = filled.filter((i) => {
    const r = row(i.id);
    return !qtyOk(r.quantity) || toMinor(r.unitCost || '', money.digits) === null || (i.trackBatches && !r.batchNo.trim());
  });
  const save = useMutation({
    mutationFn: () => {
      const input: OpeningStockInput = {
        date,
        lines: filled.map((i) => {
          const r = row(i.id);
          return { itemId: i.id, quantity: r.quantity.trim(), unitCost: toMinor(r.unitCost, money.digits)!, ...(i.trackBatches ? { batchNo: r.batchNo.trim(), expiryDate: r.expiryDate || null } : {}), ...(i.trackSerials ? { serials: parseSerials(r.serials) } : {}) };
        }),
      };
      return api.openingStock(input);
    },
    onSuccess: (r) => {
      for (const k of ['inventory', 'items', 'journals', 'reports']) void qc.invalidateQueries({ queryKey: [k] });
      toast(t('openingStock.saved', { count: r.movements.length }));
      onClose();
    },
    onError: (e) => toast(inventoryErrorMessage(e, t), 'error'),
  });
  const cell = clsx(inputClass, 'h-9 border-ink-200 dark:border-ink-700');
  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title={t('openingStock.title')}
      description={t('openingStock.description')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={save.isPending} disabled={!filled.length || bad.length > 0} onClick={() => save.mutate()}>
            {t('openingStock.save', { count: filled.length })}
          </Button>
        </>
      }
    >
      <div className="w-48">
        <TextField label={t('openingStock.date')} type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
      </div>
      {!tracked.length ? (
        <p className="mt-4 text-sm text-ink-500">{t('openingStock.none')}</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="text-xs uppercase tracking-wide text-ink-400">
              <tr>
                <th scope="col" className="py-1.5 text-start font-semibold">{t('openingStock.item')}</th>
                <th scope="col" className="w-28 py-1.5 text-end font-semibold">{t('openingStock.quantity')}</th>
                <th scope="col" className="w-32 py-1.5 text-end font-semibold">{t('openingStock.unitCost', { currency: money.currency })}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
              {tracked.map((i) => {
                const r = row(i.id);
                return (
                  <tr key={i.id} className="align-top">
                    <td className="py-1.5 pe-3">
                      <span dir="auto">{i.name}</span>
                      {i.unit && <span className="ms-1 text-xs text-ink-500">{i.unit}</span>}
                      {i.trackBatches && r.quantity.trim() && (
                        <div className="mt-1 grid grid-cols-2 gap-1">
                          <input aria-label={t('openingStock.batchFor', { item: i.name })} placeholder={t('batches.batchNo')} value={r.batchNo} onChange={(e) => set(i.id, { batchNo: e.target.value })} dir="ltr" className={clsx(cell, 'font-mono', !r.batchNo.trim() && 'border-expense')} />
                          <input aria-label={t('openingStock.expiryFor', { item: i.name })} type="date" value={r.expiryDate} onChange={(e) => set(i.id, { expiryDate: e.target.value })} className={cell} />
                        </div>
                      )}
                      {i.trackSerials && r.quantity.trim() && <SerialsInput value={r.serials} onChange={(v) => set(i.id, { serials: v })} quantity={r.quantity} label={t('openingStock.serialsFor', { item: i.name })} />}
                    </td>
                    <td className="py-1.5 ps-2">
                      <input aria-label={t('openingStock.quantityOf', { item: i.name })} value={r.quantity} onChange={(e) => set(i.id, { quantity: e.target.value })} inputMode="decimal" dir="ltr" className={clsx(cell, 'text-end font-mono', r.quantity.trim() && !qtyOk(r.quantity) && 'border-expense')} />
                    </td>
                    <td className="py-1.5 ps-2">
                      <input aria-label={t('openingStock.costOf', { item: i.name })} value={r.unitCost} onChange={(e) => set(i.id, { unitCost: e.target.value })} placeholder={i.purchasePrice ? money.plain(i.purchasePrice) : undefined} inputMode="decimal" dir="ltr" className={clsx(cell, 'text-end font-mono', r.quantity.trim() && toMinor(r.unitCost || '', money.digits) === null && 'border-expense')} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
