import { useState } from 'react';
import { motion } from 'motion/react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Boxes, Building2, CheckCircle2, SlidersHorizontal, Undo2 } from 'lucide-react';
import clsx from 'clsx';
import { todayIn } from '@ledgernest/shared';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useIntlLocale } from '../../i18n';
import { formatDate } from '../../lib/format';
import { useMoney } from '../../lib/useMoney';
import { useSession } from '../../layout/session';
import { fadeUp, stagger } from '../../motion/tokens';
import { useOrganizationSettings } from '../../settings/useOrganizationSettings';
import Button from '../../ui/Button';
import { SelectField, TextField } from '../../ui/Field';
import { Card, EmptyState, ErrorState, PageHeader, Pill, SkeletonRows } from '../../ui/Kit';
import { useToast } from '../../ui/toastContext';
import AdjustStockDialog from '../AdjustStockDialog';
import { inventoryErrorMessage } from '../errors';
import type { InventoryApi, StockMovement } from '../types';
import { useInventoryApi } from '../useInventoryApi';

const th = 'px-4 py-2.5 font-semibold';
const num = 'px-4 py-2 text-end font-mono tabular-nums whitespace-nowrap';

/** Stock: what's on hand and what it's worth on a day, each item's movements, and adjustments. */
export default function Inventory() {
  const { t } = useTranslation();
  const money = useMoney();
  const session = useSession();
  const api = useInventoryApi();
  const settings = useOrganizationSettings().data;
  const canAdjust = session.permissions.has('journals.post');
  const [asOf, setAsOf] = useState(() => todayIn(settings?.timeZone ?? 'Asia/Kolkata'));
  const [selected, setSelected] = useState<string | null>(null);
  const [adjusting, setAdjusting] = useState<string | true | null>(null);
  const role = session.role ?? session.customRoleName;
  const valuation = useQuery({ queryKey: ['inventory', session.organizationId, role, 'valuation', asOf], queryFn: () => api!.valuation(asOf), enabled: !!api, placeholderData: keepPreviousData });

  if (!api) {
    return (
      <Card>
        <EmptyState icon={<Building2 className="size-5" />} title={t('team.noOrganization')} body={t('team.noOrganizationBody')} />
      </Card>
    );
  }
  const v = valuation.data;
  const current = v?.rows.find((r) => r.itemId === selected);
  return (
    <motion.div variants={stagger(0.06)} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={fadeUp}>
        <PageHeader
          eyebrow={<span dir="auto">{session.organization}</span>}
          title={t('inventory.title')}
          description={t('inventory.description')}
          actions={
            canAdjust && v?.rows.length ? (
              <Button icon={<SlidersHorizontal className="size-4" />} onClick={() => setAdjusting(true)}>
                {t('inventory.adjust')}
              </Button>
            ) : undefined
          }
        />
      </motion.div>
      <motion.div variants={fadeUp} className="flex flex-wrap items-end gap-4">
        <div className="w-48">
          <TextField label={t('inventory.asOf')} type="date" value={asOf} onChange={(e) => e.target.value && setAsOf(e.target.value)} />
        </div>
      </motion.div>
      <motion.div variants={fadeUp}>
        <Card className="overflow-hidden">
          {valuation.isPending ? (
            <SkeletonRows rows={5} />
          ) : valuation.isError ? (
            <ErrorState onRetry={() => void valuation.refetch()} />
          ) : !v!.rows.length ? (
            <EmptyState
              icon={<Boxes className="size-5" />}
              title={t('inventory.empty')}
              body={t('inventory.emptyBody')}
              action={
                <Link to="/items" className="text-sm font-medium text-brand-700 hover:underline dark:text-brand-300">
                  {t('inventory.goToItems')}
                </Link>
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">{t('inventory.valuation')}</caption>
                <thead className="border-b border-ink-100 text-xs uppercase tracking-wide text-ink-400 dark:border-ink-800">
                  <tr>
                    <th scope="col" className={clsx(th, 'text-start')}>
                      {t('inventory.columns.item')}
                    </th>
                    <th scope="col" className={clsx(th, 'text-end')}>
                      {t('inventory.columns.onHand')}
                    </th>
                    <th scope="col" className={clsx(th, 'text-end')}>
                      {t('inventory.columns.averageCost')}
                    </th>
                    <th scope="col" className={clsx(th, 'text-end')}>
                      {t('inventory.columns.value')}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
                  {v!.rows.map((r) => (
                    <tr key={r.itemId} className={clsx(selected === r.itemId && 'bg-brand-50/60 dark:bg-brand-500/10')}>
                      <th scope="row" className="px-4 py-2 text-start font-normal">
                        <button type="button" onClick={() => setSelected(selected === r.itemId ? null : r.itemId)} aria-expanded={selected === r.itemId} className="text-start font-medium hover:underline" dir="auto">
                          {r.name}
                        </button>
                        {r.low && (
                          <span className="ms-2 inline-block">
                            <Pill>{t('inventory.lowPill')}</Pill>
                          </span>
                        )}
                        {r.account && (
                          <span className="block text-xs text-ink-500">
                            {r.account.code} · {r.account.name}
                            {r.reorderLevel && ` · ${t('inventory.reorderAt', { quantity: r.reorderLevel })}`}
                          </span>
                        )}
                      </th>
                      <td className={clsx(num, r.quantity.startsWith('-') && 'text-expense')} dir="ltr">
                        {r.quantity}
                        {r.unit && <span className="ms-1 text-xs text-ink-500">{r.unit}</span>}
                      </td>
                      <td className={num} dir="ltr">
                        {r.averageCost !== null ? money.plain(r.averageCost) : '—'}
                      </td>
                      <td className={num} dir="ltr">
                        {money.plain(r.value)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t-2 border-ink-200 font-semibold dark:border-ink-700">
                  <tr>
                    <th scope="row" colSpan={3} className="px-4 py-2.5 text-start">
                      {t('inventory.total')}
                    </th>
                    <td className={num} dir="ltr">
                      {money.format(v!.total)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </Card>
      </motion.div>
      {v && v.accounts.length > 0 && (
        <motion.ul variants={fadeUp} className="space-y-1.5">
          {v.accounts.map((a) => {
            const agrees = a.stock === a.ledger;
            return (
              <li key={a.id} className={clsx('flex flex-wrap items-center gap-2 text-sm', agrees ? 'text-ink-600 dark:text-ink-300' : 'text-expense')}>
                {agrees ? <CheckCircle2 className="size-4 text-income" aria-hidden /> : <AlertTriangle className="size-4" aria-hidden />}
                {t(agrees ? 'inventory.agrees' : 'inventory.differs', { account: `${a.code} · ${a.name}`, stock: money.format(a.stock), ledger: money.format(a.ledger) })}
              </li>
            );
          })}
        </motion.ul>
      )}
      <motion.div variants={fadeUp}>
        <Expiring api={api} />
      </motion.div>
      {current && <Movements key={current.itemId} api={api} itemId={current.itemId} name={current.name} canAdjust={canAdjust} onAdjust={() => setAdjusting(current.itemId)} />}
      {adjusting && <AdjustStockDialog api={api} itemId={adjusting === true ? undefined : adjusting} onClose={() => setAdjusting(null)} />}
    </motion.div>
  );
}

/** Stock to act on before it's wasted: batches already expired (to write off or return) and those expiring soon (to sell first) */
function Expiring({ api }: { api: InventoryApi }) {
  const { t } = useTranslation();
  const locale = useIntlLocale();
  const money = useMoney();
  const session = useSession();
  const [days, setDays] = useState(90);
  const q = useQuery({ queryKey: ['inventory', session.organizationId, 'expiring', days], queryFn: () => api.expiring(days), placeholderData: keepPreviousData });
  const r = q.data;
  if (!r || (!r.rows.length && days === 90)) return null;
  return (
    <Card className="overflow-hidden">
      <section id="expiring" aria-labelledby="expiring-title" className="scroll-mt-20">
        <div className="flex flex-wrap items-end justify-between gap-3 p-4">
          <div>
            <h2 id="expiring-title" className="font-semibold">
              {t('batches.expiring.title')}
            </h2>
            <p className="text-sm text-ink-500">
              {t('batches.expiring.summary', { expired: r.expired.count, expiredValue: money.format(r.expired.value), expiring: r.expiring.count, expiringValue: money.format(r.expiring.value), days })}
            </p>
          </div>
          <div className="w-44">
            <SelectField label={t('batches.expiring.within')} value={String(days)} onChange={(e) => setDays(Number(e.target.value))} options={[30, 60, 90, 180].map((d) => ({ value: String(d), label: t('batches.expiring.days', { count: d }) }))} />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-y border-ink-100 text-xs uppercase tracking-wide text-ink-400 dark:border-ink-800">
              <tr>
                <th scope="col" className="px-4 py-2 text-start font-semibold">{t('batches.expiring.item')}</th>
                <th scope="col" className="px-4 py-2 text-start font-semibold">{t('batches.batch')}</th>
                <th scope="col" className="px-4 py-2 text-start font-semibold">{t('batches.expiryDate')}</th>
                <th scope="col" className="px-4 py-2 text-end font-semibold">{t('batches.expiring.onHand')}</th>
                <th scope="col" className="px-4 py-2 text-end font-semibold">{t('batches.expiring.value')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
              {r.rows.map((b) => (
                <tr key={b.batchId} className={clsx(b.expired && 'bg-red-50/60 dark:bg-red-950/20')}>
                  <td className="px-4 py-2" dir="auto">{b.item}</td>
                  <td className="px-4 py-2 font-mono" dir="ltr">{b.batchNo}</td>
                  <td className={clsx('px-4 py-2', b.expired ? 'text-expense' : b.daysLeft <= 30 && 'text-amber-700 dark:text-amber-300')}>
                    {formatDate(`${b.expiryDate}T00:00:00Z`, locale)} · {b.expired ? t('batches.expiring.expiredAgo', { count: -b.daysLeft }) : t('batches.expiring.daysLeft', { count: b.daysLeft })}
                  </td>
                  <td className="px-4 py-2 text-end font-mono tabular-nums" dir="ltr">
                    {b.onHand}
                    {b.unit && <span className="ms-1 text-xs text-ink-500">{b.unit}</span>}
                  </td>
                  <td className="px-4 py-2 text-end font-mono tabular-nums" dir="ltr">{money.format(b.value)}</td>
                </tr>
              ))}
              {!r.rows.length && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-ink-500">
                    {t('batches.expiring.none', { count: days })}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </Card>
  );
}

/** One item's movements, oldest first, with what was on hand after each */
function Movements({ api, itemId, name, canAdjust, onAdjust }: { api: InventoryApi; itemId: string; name: string; canAdjust: boolean; onAdjust: () => void }) {
  const { t } = useTranslation();
  const locale = useIntlLocale();
  const money = useMoney();
  const toast = useToast();
  const qc = useQueryClient();
  const session = useSession();
  const q = useQuery({ queryKey: ['inventory', session.organizationId, session.role ?? session.customRoleName, 'movements', itemId], queryFn: () => api.movements(itemId) });
  const undo = useMutation({
    mutationFn: (m: StockMovement) => api.undoAdjustment(m.id),
    onSuccess: () => {
      for (const k of ['inventory', 'items', 'journals', 'reports']) void qc.invalidateQueries({ queryKey: [k] });
      toast(t('inventory.undoneToast'));
    },
    onError: (e) => toast(inventoryErrorMessage(e, t), 'error'),
  });
  const what = (m: StockMovement) => {
    const label = t(`inventory.kinds.${m.kind}`);
    if (m.document?.number) return `${label} ${m.document.number}`;
    return m.reason ? `${label}: ${m.reason}` : label;
  };
  return (
    <motion.section variants={fadeUp} initial="hidden" animate="show" aria-label={t('inventory.movementsOf', { name })}>
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-ink-100 px-5 py-3 dark:border-ink-800">
          <h2 className="flex-1 font-semibold" dir="auto">
            {t('inventory.movementsOf', { name })}
          </h2>
          {canAdjust && (
            <Button size="sm" variant="ghost" icon={<SlidersHorizontal className="size-4" />} onClick={onAdjust}>
              {t('inventory.adjust')}
            </Button>
          )}
        </div>
        {q.isPending ? (
          <SkeletonRows rows={4} />
        ) : q.isError ? (
          <ErrorState onRetry={() => void q.refetch()} />
        ) : !q.data.movements.length ? (
          <p className="px-5 py-4 text-sm text-ink-500">{t('inventory.noMovements')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wide text-ink-400">
                <tr>
                  <th scope="col" className={clsx(th, 'text-start')}>
                    {t('inventory.columns.date')}
                  </th>
                  <th scope="col" className={clsx(th, 'text-start')}>
                    {t('inventory.columns.movement')}
                  </th>
                  <th scope="col" className={clsx(th, 'text-end')}>
                    {t('inventory.columns.quantity')}
                  </th>
                  <th scope="col" className={clsx(th, 'text-end')}>
                    {t('inventory.columns.value')}
                  </th>
                  <th scope="col" className={clsx(th, 'text-end')}>
                    {t('inventory.columns.onHand')}
                  </th>
                  <th scope="col" className="w-10">
                    <span className="sr-only">{t('inventory.undo')}</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
                {q.data.movements.map((m) => (
                  <tr key={m.id} className={clsx(m.undone && 'text-ink-400 line-through')}>
                    <td className="whitespace-nowrap px-4 py-2 text-ink-600 dark:text-ink-300">{formatDate(`${m.date}T00:00:00Z`, locale)}</td>
                    <td className="px-4 py-2" dir="auto">
                      {what(m)}
                      {m.journalEntry && (
                        <Link to={`/journals/${m.journalEntry.id}`} className="ms-2 font-mono text-xs text-brand-700 hover:underline dark:text-brand-300" dir="ltr">
                          {m.journalEntry.number}
                        </Link>
                      )}
                    </td>
                    <td className={clsx(num, m.quantity.startsWith('-') ? 'text-expense' : 'text-income')} dir="ltr">
                      {m.quantity.startsWith('-') ? m.quantity.replace('-', '−') : `+${m.quantity}`}
                    </td>
                    <td className={num} dir="ltr">
                      {money.plain(m.value)}
                    </td>
                    <td className={num} dir="ltr">
                      {m.onHand}
                      <span className="block text-xs text-ink-500">{money.plain(m.valueOnHand)}</span>
                    </td>
                    <td className="px-2 py-1 text-end">
                      {canAdjust && m.kind === 'adjustment' && !m.undone && (
                        <button type="button" onClick={() => undo.mutate(m)} disabled={undo.isPending} aria-label={t('inventory.undoAdjustment', { date: formatDate(`${m.date}T00:00:00Z`, locale) })} className="grid size-8 place-items-center rounded-lg text-ink-400 hover:bg-ink-100 hover:text-expense dark:hover:bg-ink-800">
                          <Undo2 className="size-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </motion.section>
  );
}
