import { useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { gtinValid, HSN_SAC_PATTERN, ITEM_KINDS, isUqc, toMinor, UQC_UNITS, type ItemKind, type ItemUpdateInput } from '@ledgernest/shared';
import { useTranslation } from 'react-i18next';
import { useAccountsApi } from '../accounts/useAccountsApi';
import { ApiError } from '../auth/client';
import { useSession } from '../layout/session';
import { useMoney } from '../lib/useMoney';
import { useTaxesApi } from '../taxes/useTaxesApi';
import Button from '../ui/Button';
import { SelectField, TextField } from '../ui/Field';
import Modal from '../ui/Modal';
import { useToast } from '../ui/toastContext';
import { itemErrorMessage } from './errors';
import type { Item, ItemsApi } from './types';

/** Add or edit a product or service. Prices are in the base currency. */
export default function ItemDialog({ item, api, onClose, onSaved }: { item?: Item; api: ItemsApi; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const money = useMoney();
  const session = useSession();
  const accountsApi = useAccountsApi();
  const taxesApi = useTaxesApi();
  const accounts = useQuery({ queryKey: ['accounts', session.organizationId, session.role ?? session.customRoleName, 'all'], queryFn: () => accountsApi!.list(true), enabled: !!accountsApi });
  const taxes = useQuery({ queryKey: ['taxes', session.organizationId, session.role ?? session.customRoleName], queryFn: () => taxesApi!.list(), enabled: !!taxesApi });
  const price = (minor: number | null | undefined) => (minor ? money.plain(minor) : '');
  const [name, setName] = useState(item?.name ?? '');
  const [kind, setKind] = useState<ItemKind>(item?.kind ?? 'service');
  const [sku, setSku] = useState(item?.sku ?? '');
  const [unit, setUnit] = useState(item?.unit ?? '');
  const [description, setDescription] = useState(item?.description ?? '');
  const [salePrice, setSalePrice] = useState(price(item?.salePrice));
  const [purchasePrice, setPurchasePrice] = useState(price(item?.purchasePrice));
  const [taxGroupId, setTaxGroupId] = useState(item?.taxGroupId ?? '');
  const [hsnSac, setHsnSac] = useState(item?.hsnSac ?? '');
  const [incomeAccountId, setIncome] = useState(item?.incomeAccountId ?? '');
  const [expenseAccountId, setExpense] = useState(item?.expenseAccountId ?? '');
  const [trackStock, setTrackStock] = useState(item?.trackStock ?? false);
  const [trackBatches, setTrackBatches] = useState(item?.trackBatches ?? false);
  const [inventoryAccountId, setInventory] = useState(item?.inventoryAccountId ?? '');
  const [cogsAccountId, setCogs] = useState(item?.cogsAccountId ?? '');
  const [reorderLevel, setReorderLevel] = useState(item?.reorderLevel ?? '');
  const [mrp, setMrp] = useState(price(item?.mrp));
  const [barcode, setBarcode] = useState(item?.barcode ?? '');
  const [brand, setBrand] = useState(item?.brand ?? '');
  const [category, setCategory] = useState(item?.category ?? '');
  const facets = useQuery({ queryKey: ['items', session.organizationId, 'facets'], queryFn: () => api.facets() });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const active = (accounts.data ?? []).filter((a) => !a.archived);
  const values = () => ({
    name: name.trim(),
    kind,
    sku: sku.trim() || null,
    unit: unit.trim() || null,
    description: description.trim() || null,
    salePrice: salePrice.trim() ? toMinor(salePrice, money.digits) : null,
    purchasePrice: purchasePrice.trim() ? toMinor(purchasePrice, money.digits) : null,
    taxGroupId: taxGroupId || null,
    hsnSac: hsnSac.trim() || null,
    incomeAccountId: incomeAccountId || null,
    expenseAccountId: expenseAccountId || null,
    trackStock: kind === 'goods' && trackStock,
    trackBatches: kind === 'goods' && trackStock && trackBatches,
    inventoryAccountId: kind === 'goods' && trackStock ? inventoryAccountId || null : null,
    cogsAccountId: kind === 'goods' && trackStock ? cogsAccountId || null : null,
    reorderLevel: kind === 'goods' && trackStock ? reorderLevel.trim() || null : null,
    mrp: kind === 'goods' && mrp.trim() ? toMinor(mrp, money.digits) : null,
    barcode: kind === 'goods' ? barcode.trim() || null : null,
    brand: brand.trim() || null,
    category: category.trim() || null,
  });
  const save = useMutation({
    mutationFn: () => {
      const v = values() as Parameters<ItemsApi['create']>[0] & Record<string, unknown>;
      if (!item) return api.create(v);
      const patch = Object.fromEntries(Object.entries(v).filter(([k, x]) => x !== (item as unknown as Record<string, unknown>)[k])) as ItemUpdateInput;
      return Object.keys(patch).length ? api.update(item.id, patch) : Promise.resolve(item);
    },
    onSuccess: (i) => {
      toast(item ? t('items.saved', { name: i.name }) : t('items.created', { name: i.name }));
      onSaved();
    },
    onError: (e) => {
      const field = e instanceof ApiError && typeof e.details?.field === 'string' ? e.details.field : null;
      if (field) setErrors({ [field]: itemErrorMessage(e, t) });
      else toast(itemErrorMessage(e, t), 'error');
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const v = values();
    const next: Record<string, string> = {};
    if (v.name.length < 2) next.name = t('items.validation.name');
    if (v.salePrice === null && salePrice.trim()) next.salePrice = t('items.validation.price');
    if (v.purchasePrice === null && purchasePrice.trim()) next.purchasePrice = t('items.validation.price');
    if (v.hsnSac && !HSN_SAC_PATTERN.test(v.hsnSac)) next.hsnSac = t('items.validation.hsnSac');
    if (v.mrp === null && kind === 'goods' && mrp.trim()) next.mrp = t('items.validation.price');
    if (v.mrp !== null && v.salePrice !== null && v.salePrice > v.mrp) next.salePrice = t('items.validation.aboveMrp');
    if (v.barcode && (!/^[0-9A-Za-z-]{4,40}$/.test(v.barcode) || !gtinValid(v.barcode))) next.barcode = t('items.validation.barcode');
    if (v.trackStock && !v.inventoryAccountId) next.inventoryAccountId = t('inventory.errors.inventory_account_required');
    if (v.trackStock && !v.cogsAccountId) next.cogsAccountId = t('inventory.errors.cogs_account_required');
    if (v.reorderLevel && !/^\d{1,9}(\.\d{1,4})?$/.test(v.reorderLevel)) next.reorderLevel = t('inventory.problems.quantity');
    setErrors(next);
    if (!Object.keys(next).length) save.mutate();
  };
  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title={item ? t('items.dialog.editTitle', { name: item.name }) : t('items.dialog.newTitle')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="item-form" loading={save.isPending}>
            {item ? t('common.save') : t('items.dialog.create')}
          </Button>
        </>
      }
    >
      <form id="item-form" onSubmit={submit} noValidate className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <TextField label={t('items.fields.name')} value={name} onChange={(e) => setName(e.target.value)} error={errors.name} dir="auto" data-autofocus />
        </div>
        <SelectField label={t('items.fields.kind')} value={kind} onChange={(e) => setKind(e.target.value as ItemKind)} options={ITEM_KINDS.map((k) => ({ value: k, label: t(`items.kinds.${k}`) }))} />
        <TextField label={t(kind === 'goods' ? 'items.fields.hsn' : 'items.fields.sac')} value={hsnSac} onChange={(e) => setHsnSac(e.target.value)} error={errors.hsnSac} dir="ltr" inputMode="numeric" hint={t('items.hints.hsnSac')} />
        <TextField label={t('items.fields.sku')} value={sku} onChange={(e) => setSku(e.target.value.toUpperCase())} error={errors.sku} dir="ltr" className="font-mono" />
        {kind === 'goods' ? (
          <SelectField
            label={t('items.fields.unit')}
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            hint={t('items.hints.uqc')}
            options={[{ value: '', label: t('items.chooseUnit') }, ...(unit && !isUqc(unit) ? [{ value: unit, label: unit }] : []), ...UQC_UNITS.map(([code, name]) => ({ value: code, label: `${code} · ${t(`items.uqc.${code}`, { defaultValue: name })}` }))]}
          />
        ) : (
          <TextField label={t('items.fields.unit')} value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="hrs" />
        )}
        {kind === 'goods' && (
          <>
            <TextField label={t('items.fields.mrp', { currency: money.currency })} value={mrp} onChange={(e) => setMrp(e.target.value)} error={errors.mrp} hint={t('items.hints.mrp')} inputMode="decimal" dir="ltr" className="text-end font-mono" />
            <TextField label={t('items.fields.barcode')} value={barcode} onChange={(e) => setBarcode(e.target.value.trim())} error={errors.barcode} hint={t('items.hints.barcode')} inputMode="numeric" dir="ltr" className="font-mono" />
          </>
        )}
        <TextField label={t('items.fields.brand')} value={brand} onChange={(e) => setBrand(e.target.value)} error={errors.brand} list="item-brands" dir="auto" />
        <TextField label={t('items.fields.category')} value={category} onChange={(e) => setCategory(e.target.value)} error={errors.category} list="item-categories" dir="auto" />
        <datalist id="item-brands">
          {(facets.data?.brands ?? []).map((b) => (
            <option key={b} value={b} />
          ))}
        </datalist>
        <datalist id="item-categories">
          {(facets.data?.categories ?? []).map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <div className="sm:col-span-2">
          <TextField label={t('items.fields.description')} value={description} onChange={(e) => setDescription(e.target.value)} dir="auto" />
        </div>
        <TextField label={t('items.fields.salePrice', { currency: money.currency })} value={salePrice} onChange={(e) => setSalePrice(e.target.value)} error={errors.salePrice} inputMode="decimal" dir="ltr" className="text-end font-mono" />
        <TextField label={t('items.fields.purchasePrice', { currency: money.currency })} value={purchasePrice} onChange={(e) => setPurchasePrice(e.target.value)} error={errors.purchasePrice} inputMode="decimal" dir="ltr" className="text-end font-mono" />
        <SelectField
          label={t('items.fields.taxGroup')}
          value={taxGroupId}
          onChange={(e) => setTaxGroupId(e.target.value)}
          error={errors.taxGroupId}
          options={[{ value: '', label: t('journals.tax.none') }, ...(taxes.data?.groups ?? []).filter((g) => !g.archived || g.id === taxGroupId).map((g) => ({ value: g.id, label: g.name }))]}
        />
        <div />
        <SelectField
          label={t('items.fields.incomeAccount')}
          value={incomeAccountId}
          onChange={(e) => setIncome(e.target.value)}
          error={errors.incomeAccountId}
          options={[{ value: '', label: t('items.chooseLater') }, ...active.filter((a) => a.type === 'income').map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` }))]}
        />
        <SelectField
          label={t('items.fields.expenseAccount')}
          value={expenseAccountId}
          onChange={(e) => setExpense(e.target.value)}
          error={errors.expenseAccountId}
          options={[{ value: '', label: t('items.chooseLater') }, ...active.filter((a) => a.type === 'expense' || a.type === 'asset').map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` }))]}
        />
        {kind === 'goods' && (
          <fieldset className="space-y-3 rounded-xl border border-ink-100 p-3 sm:col-span-2 dark:border-ink-800">
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" checked={trackStock} onChange={(e) => setTrackStock(e.target.checked)} className="mt-0.5 size-4 rounded accent-brand-600" />
              <span>
                <span className="font-medium">{t('inventory.track')}</span>
                <span className="block text-xs text-ink-500">{t('inventory.trackHint')}</span>
              </span>
            </label>
            {trackStock && (
              <div className="grid gap-3 sm:grid-cols-2">
                <SelectField
                  label={t('inventory.fields.inventoryAccount')}
                  value={inventoryAccountId}
                  onChange={(e) => setInventory(e.target.value)}
                  error={errors.inventoryAccountId}
                  options={[{ value: '', label: t('inventory.chooseAccount') }, ...active.filter((a) => a.type === 'asset' && a.subtype === 'inventory').concat(active.filter((a) => a.type === 'asset' && a.subtype !== 'inventory')).map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` }))]}
                />
                <SelectField
                  label={t('inventory.fields.cogsAccount')}
                  value={cogsAccountId}
                  onChange={(e) => setCogs(e.target.value)}
                  error={errors.cogsAccountId}
                  options={[{ value: '', label: t('inventory.chooseAccount') }, ...active.filter((a) => a.type === 'expense' && a.subtype === 'cost_of_sales').concat(active.filter((a) => a.type === 'expense' && a.subtype !== 'cost_of_sales')).map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` }))]}
                />
                <TextField label={t('inventory.fields.reorderLevel')} value={reorderLevel} onChange={(e) => setReorderLevel(e.target.value)} error={errors.reorderLevel} hint={t('inventory.reorderHint')} inputMode="decimal" dir="ltr" className="text-end font-mono" />
                <label className="flex items-start gap-2 text-sm sm:col-span-2">
                  <input type="checkbox" checked={trackBatches} onChange={(e) => setTrackBatches(e.target.checked)} className="mt-0.5 size-4 rounded accent-brand-600" />
                  <span>
                    <span className="font-medium">{t('batches.track')}</span>
                    <span className="block text-xs text-ink-500">{t('batches.trackHint')}</span>
                  </span>
                </label>
              </div>
            )}
          </fieldset>
        )}
      </form>
    </Modal>
  );
}
