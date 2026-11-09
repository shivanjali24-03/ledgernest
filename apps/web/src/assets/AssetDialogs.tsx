import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DEPRECIATION_METHODS, toMinor, todayIn, type DepreciationMethod } from '@ledgernest/shared';
import { useTranslation } from 'react-i18next';
import { useAccountsApi } from '../accounts/useAccountsApi';
import { useIntlLocale } from '../i18n';
import { formatDate } from '../lib/format';
import { useMoney } from '../lib/useMoney';
import { useSession } from '../layout/session';
import { useOrganizationSettings } from '../settings/useOrganizationSettings';
import Button from '../ui/Button';
import { SelectField, TextField } from '../ui/Field';
import Modal from '../ui/Modal';
import { useToast } from '../ui/toastContext';
import { assetErrorMessage } from './errors';
import type { AssetsApi, FixedAsset } from './types';

function useAccounts() {
  const session = useSession();
  const api = useAccountsApi();
  const q = useQuery({ queryKey: ['accounts', session.organizationId, session.role ?? session.customRoleName, 'all'], queryFn: () => api!.list(true), enabled: !!api });
  return (q.data ?? []).filter((a) => !a.archived && a.childCount === 0 && !a.currency);
}
const option = (a: { id: string; code: string; name: string }) => ({ value: a.id, label: `${a.code} · ${a.name}` });
const refresh = (qc: ReturnType<typeof useQueryClient>) => {
  for (const k of ['assets', 'journals', 'reports']) void qc.invalidateQueries({ queryKey: [k] });
};

/** Add an asset to the register: what it cost, when it came into use, how it wears down, and its accounts */
export function AssetDialog({ api, onClose }: { api: AssetsApi; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const settings = useOrganizationSettings().data;
  const accounts = useAccounts();
  const fixed = accounts.filter((a) => a.type === 'asset' && (a.subtype === 'fixed_asset' || a.subtype === 'other_asset'));
  const expenses = accounts.filter((a) => a.type === 'expense');
  const [name, setName] = useState('');
  const [cost, setCost] = useState('');
  const [residual, setResidual] = useState('');
  const [inService, setInService] = useState(() => todayIn(settings?.timeZone ?? 'Asia/Kolkata'));
  const [method, setMethod] = useState<DepreciationMethod>('straight_line');
  const [life, setLife] = useState('36');
  const [rate, setRate] = useState('15');
  const [costAccountId, setCostAccount] = useState('');
  const [accumulatedAccountId, setAccumulated] = useState('');
  const [expenseAccountId, setExpense] = useState('');
  const [earlier, setEarlier] = useState(false);
  const [opening, setOpening] = useState('');
  const [openingTo, setOpeningTo] = useState('');
  // Sensible accounts: the first fixed asset account for cost, one named for depreciation for the rest
  const costId = costAccountId || fixed.find((a) => !/depreciation/i.test(a.name))?.id || '';
  const accId = accumulatedAccountId || fixed.find((a) => /depreciation/i.test(a.name))?.id || '';
  const expId = expenseAccountId || expenses.find((a) => a.subtype === 'depreciation')?.id || '';
  const costMinor = toMinor(cost, 2);
  const save = useMutation({
    mutationFn: () => api.create({ name, cost: costMinor!, residual: residual.trim() ? toMinor(residual, 2)! : 0, inServiceDate: inService, method, usefulLifeMonths: method === 'straight_line' ? Number(life) : null, wdvRate: method === 'wdv' ? rate : null, costAccountId: costId, accumulatedAccountId: accId, expenseAccountId: expId, openingAccumulated: earlier && opening.trim() ? toMinor(opening, 2)! : 0, openingTo: earlier ? openingTo || null : null }),
    onSuccess: (a) => {
      refresh(qc);
      toast(t('assets.added', { tag: a.tag, name: a.name }));
      onClose();
    },
    onError: (e) => toast(assetErrorMessage(e, t), 'error'),
  });
  const problem = !name.trim() ? 'name' : !costMinor ? 'cost' : method === 'straight_line' ? (!(Number(life) > 0) ? 'life' : null) : !(Number(rate) > 0) ? 'rate' : null;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (problem) return toast(t(`assets.problems.${problem}`), 'error');
    save.mutate();
  };
  return (
    <Modal open size="lg" onClose={onClose} title={t('assets.addTitle')} description={t('assets.addBody')} footer={<><Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button><Button type="submit" form="asset-form" loading={save.isPending} disabled={!!problem}>{t('assets.add')}</Button></>}>
      <form id="asset-form" onSubmit={submit} noValidate className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <TextField label={t('assets.fields.name')} value={name} onChange={(e) => setName(e.target.value)} placeholder={t('assets.namePlaceholder')} dir="auto" data-autofocus />
        </div>
        <TextField label={t('assets.fields.cost')} value={cost} onChange={(e) => setCost(e.target.value)} inputMode="decimal" dir="ltr" className="text-end font-mono" />
        <TextField label={t('assets.fields.inService')} type="date" value={inService} onChange={(e) => setInService(e.target.value)} />
        <SelectField label={t('assets.fields.method')} value={method} onChange={(e) => setMethod(e.target.value as DepreciationMethod)} options={DEPRECIATION_METHODS.map((m) => ({ value: m, label: t(`assets.methods.${m}`) }))} />
        {method === 'straight_line' ? <TextField label={t('assets.fields.life')} value={life} onChange={(e) => setLife(e.target.value)} inputMode="numeric" dir="ltr" hint={t('assets.lifeHint')} /> : <TextField label={t('assets.fields.rate')} value={rate} onChange={(e) => setRate(e.target.value)} inputMode="decimal" dir="ltr" hint={t('assets.rateHint')} />}
        <TextField label={t('assets.fields.residual')} value={residual} onChange={(e) => setResidual(e.target.value)} inputMode="decimal" dir="ltr" className="text-end font-mono" placeholder="0" />
        <SelectField label={t('assets.fields.costAccount')} value={costId} onChange={(e) => setCostAccount(e.target.value)} options={fixed.map(option)} />
        <SelectField label={t('assets.fields.accumulatedAccount')} value={accId} onChange={(e) => setAccumulated(e.target.value)} options={fixed.map(option)} />
        <SelectField label={t('assets.fields.expenseAccount')} value={expId} onChange={(e) => setExpense(e.target.value)} options={expenses.map(option)} />
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" checked={earlier} onChange={(e) => setEarlier(e.target.checked)} className="size-4 rounded accent-brand-600" />
          {t('assets.broughtIn')}
        </label>
        {earlier && (
          <>
            <TextField label={t('assets.fields.opening')} value={opening} onChange={(e) => setOpening(e.target.value)} inputMode="decimal" dir="ltr" className="text-end font-mono" />
            <TextField label={t('assets.fields.openingTo')} type="date" value={openingTo} onChange={(e) => setOpeningTo(e.target.value)} />
          </>
        )}
      </form>
    </Modal>
  );
}

/** Charge depreciation up to a day: what each asset would be charged, then post it in one entry */
export function RunDialog({ api, onClose }: { api: AssetsApi; onClose: () => void }) {
  const { t } = useTranslation();
  const locale = useIntlLocale();
  const money = useMoney();
  const toast = useToast();
  const qc = useQueryClient();
  const settings = useOrganizationSettings().data;
  const today = todayIn(settings?.timeZone ?? 'Asia/Kolkata');
  // The end of last month: what a month's run usually covers
  const lastMonthEnd = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, 0)).toISOString().slice(0, 10);
  const [upTo, setUpTo] = useState(lastMonthEnd);
  const preview = useQuery({ queryKey: ['assets', 'preview', upTo], queryFn: () => api.preview(upTo), enabled: !!upTo });
  const run = useMutation({
    mutationFn: () => api.run(upTo),
    onSuccess: (r) => {
      refresh(qc);
      toast(t('assets.ran', { amount: money.format(r.total), date: formatDate(`${upTo}T00:00:00Z`, locale) }));
      onClose();
    },
    onError: (e) => toast(assetErrorMessage(e, t), 'error'),
  });
  return (
    <Modal open size="lg" onClose={onClose} title={t('assets.runTitle')} description={t('assets.runBody')} footer={<><Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button><Button onClick={() => run.mutate()} loading={run.isPending} disabled={!preview.data?.total}>{preview.data?.total ? t('assets.post', { amount: money.format(preview.data.total) }) : t('assets.nothingToPost')}</Button></>}>
      <div className="space-y-3">
        <div className="w-48">
          <TextField label={t('assets.fields.upTo')} type="date" value={upTo} onChange={(e) => e.target.value && setUpTo(e.target.value)} />
        </div>
        {preview.data && !preview.data.lines.length ? (
          <p className="text-sm text-ink-500">{t('assets.nothingToDepreciate')}</p>
        ) : (
          <table className="w-full text-sm">
            <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
              {(preview.data?.lines ?? []).map((l) => (
                <tr key={l.assetId}>
                  <td className="py-1.5"><span className="me-2 font-mono text-xs text-ink-500">{l.tag}</span><span dir="auto">{l.name}</span></td>
                  <td className="py-1.5 text-ink-500">{t('assets.fromTo', { from: formatDate(`${l.from}T00:00:00Z`, locale), to: formatDate(`${l.to}T00:00:00Z`, locale) })}</td>
                  <td className="py-1.5 text-end font-mono tabular-nums" dir="ltr">{money.plain(l.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Modal>
  );
}

/** Dispose of an asset: when, what it fetched and into which account, and where the gain or loss goes */
export function DisposeDialog({ api, asset, onClose }: { api: AssetsApi; asset: FixedAsset; onClose: () => void }) {
  const { t } = useTranslation();
  const money = useMoney();
  const toast = useToast();
  const qc = useQueryClient();
  const settings = useOrganizationSettings().data;
  const accounts = useAccounts();
  const banks = accounts.filter((a) => a.type === 'asset' && (a.subtype === 'bank' || a.subtype === 'cash'));
  const pl = accounts.filter((a) => a.type === 'income' || a.type === 'expense');
  const [date, setDate] = useState(() => todayIn(settings?.timeZone ?? 'Asia/Kolkata'));
  const [proceeds, setProceeds] = useState('');
  const [bankAccountId, setBank] = useState('');
  const [gainLossAccountId, setGainLoss] = useState('');
  const amount = proceeds.trim() ? toMinor(proceeds, 2) : 0;
  const bank = bankAccountId || banks[0]?.id || '';
  const gl = gainLossAccountId || pl.find((a) => a.subtype === 'other_income' || a.subtype === 'other_expense')?.id || '';
  const save = useMutation({
    mutationFn: () => api.dispose(asset.id, { date, proceeds: amount ?? 0, bankAccountId: amount ? bank : null, gainLossAccountId: gl }),
    onSuccess: () => {
      refresh(qc);
      toast(t('assets.disposed', { tag: asset.tag }));
      onClose();
    },
    onError: (e) => toast(assetErrorMessage(e, t), 'error'),
  });
  return (
    <Modal open onClose={onClose} title={t('assets.disposeTitle', { tag: asset.tag, name: asset.name })} description={t('assets.disposeBody', { value: money.format(asset.bookValue) })} footer={<><Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button><Button variant="danger" onClick={() => save.mutate()} loading={save.isPending} disabled={amount === null || !gl}>{t('assets.dispose')}</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label={t('assets.fields.disposedOn')} type="date" value={date} min={asset.depreciatedTo ?? asset.inServiceDate} onChange={(e) => setDate(e.target.value)} />
        <TextField label={t('assets.fields.proceeds')} value={proceeds} onChange={(e) => setProceeds(e.target.value)} inputMode="decimal" dir="ltr" className="text-end font-mono" placeholder="0" />
        {!!amount && <SelectField label={t('assets.fields.into')} value={bank} onChange={(e) => setBank(e.target.value)} options={banks.map(option)} />}
        <SelectField label={t('assets.fields.gainLoss')} value={gl} onChange={(e) => setGainLoss(e.target.value)} options={pl.map(option)} />
      </div>
    </Modal>
  );
}
