import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { MAX_GROUP_RATES, TAX_KINDS, percentToPpm, type TaxKind } from '@ledgernest/shared';
import { useTranslation } from 'react-i18next';
import { useIntlLocale } from '../i18n';
import type { Account } from '../accounts/types';
import Button from '../ui/Button';
import { Field, SelectField, TextField } from '../ui/Field';
import Modal from '../ui/Modal';
import { useToast } from '../ui/toastContext';
import { taxErrorField, taxErrorMessage } from './errors';
import { dayLabel, todayIso } from './format';
import type { GstSetupResult, GstStatus, TaxGroup, TaxRate, TaxesApi } from './types';

const accountLabel = (a: Pick<Account, 'code' | 'name'>) => `${a.code} · ${a.name}`;

/** Add a rate (any tax, any percentage) or change an existing one's name and accounts. Its percentage never changes. */
export function RateDialog({ rate, accounts, api, onClose, onSaved }: { rate?: TaxRate; accounts: Account[]; api: TaxesApi; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const liabilities = accounts.filter((a) => a.type === 'liability' && !a.archived);
  const assets = accounts.filter((a) => a.type === 'asset' && !a.archived);
  const [name, setName] = useState(rate?.name ?? '');
  const [kind, setKind] = useState<TaxKind>(rate?.kind ?? 'vat');
  const [percent, setPercent] = useState(rate ? rate.rate.replace('%', '') : '');
  const [outputAccountId, setOutput] = useState(rate?.outputAccount.id ?? '');
  const [inputAccountId, setInput] = useState(rate?.inputAccount?.id ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const save = useMutation({
    mutationFn: () =>
      rate
        ? api.updateRate(rate.id, {
            ...(name.trim() !== rate.name && { name: name.trim() }),
            ...(outputAccountId !== rate.outputAccount.id && { outputAccountId }),
            ...((inputAccountId || null) !== (rate.inputAccount?.id ?? null) && { inputAccountId: inputAccountId || null }),
          })
        : api.createRate({ name: name.trim(), kind, rate: percent, outputAccountId, inputAccountId: inputAccountId || null }),
    onSuccess: (r) => {
      toast(rate ? t('taxes.rateSaved', { name: r.name }) : t('taxes.rateCreated', { name: r.name }));
      onSaved();
    },
    onError: (e) => {
      const field = taxErrorField(e);
      if (field) setErrors({ [field]: taxErrorMessage(e, t) });
      else toast(taxErrorMessage(e, t), 'error');
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (name.trim().length < 2) next.name = t('taxes.validation.name');
    if (!rate && percentToPpm(percent) === null) next.rate = t('taxes.validation.rate');
    if (!outputAccountId) next.outputAccountId = t('taxes.validation.outputAccount');
    setErrors(next);
    if (Object.keys(next).length) return;
    if (rate && name.trim() === rate.name && outputAccountId === rate.outputAccount.id && (inputAccountId || null) === (rate.inputAccount?.id ?? null)) return onClose();
    save.mutate();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={rate ? t('taxes.rateDialog.editTitle', { name: rate.name }) : t('taxes.rateDialog.newTitle')}
      description={rate ? t('taxes.rateDialog.fixedRate', { rate: rate.rate }) : t('taxes.rateDialog.description')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="tax-rate-form" loading={save.isPending}>
            {rate ? t('common.save') : t('taxes.rateDialog.create')}
          </Button>
        </>
      }
    >
      <form id="tax-rate-form" onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <TextField label={t('taxes.fields.name')} value={name} onChange={(e) => setName(e.target.value)} error={errors.name} dir="auto" data-autofocus placeholder={t('taxes.rateDialog.namePlaceholder')} />
        </div>
        <SelectField label={t('taxes.fields.kind')} value={kind} disabled={!!rate} onChange={(e) => setKind(e.target.value as TaxKind)} options={TAX_KINDS.map((k) => ({ value: k, label: t(`taxes.kinds.${k}`) }))} />
        <TextField label={t('taxes.fields.rate')} value={percent} disabled={!!rate} onChange={(e) => setPercent(e.target.value)} error={errors.rate} inputMode="decimal" dir="ltr" hint={t('taxes.hints.rate')} />
        <div className="sm:col-span-2">
          <SelectField
            label={t('taxes.fields.outputAccount')}
            value={outputAccountId}
            onChange={(e) => setOutput(e.target.value)}
            error={errors.outputAccountId}
            hint={t('taxes.hints.outputAccount')}
            options={[{ value: '', label: t('taxes.chooseAccount') }, ...liabilities.map((a) => ({ value: a.id, label: accountLabel(a) }))]}
          />
        </div>
        <div className="sm:col-span-2">
          <SelectField
            label={t('taxes.fields.inputAccount')}
            value={inputAccountId}
            onChange={(e) => setInput(e.target.value)}
            error={errors.inputAccountId}
            hint={t('taxes.hints.inputAccount')}
            options={[{ value: '', label: t('taxes.noInputAccount') }, ...assets.map((a) => ({ value: a.id, label: accountLabel(a) }))]}
          />
        </div>
      </form>
    </Modal>
  );
}

/** Bundle rates into a group (VAT 20%, or GST 18% = CGST 9% + SGST 9%), or rename one. Its rates are fixed once created. */
export function GroupDialog({ group, rates, api, onClose, onSaved }: { group?: TaxGroup; rates: TaxRate[]; api: TaxesApi; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [name, setName] = useState(group?.name ?? '');
  const [rateIds, setRateIds] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const active = rates.filter((r) => !r.archived);

  const save = useMutation({
    mutationFn: () => (group ? api.renameGroup(group.id, name.trim()) : api.createGroup({ name: name.trim(), rateIds })),
    onSuccess: (g) => {
      toast(group ? t('taxes.groupSaved', { name: g.name }) : t('taxes.groupCreated', { name: g.name }));
      onSaved();
    },
    onError: (e) => {
      const field = taxErrorField(e);
      if (field === 'name') setErrors({ name: taxErrorMessage(e, t) });
      else toast(taxErrorMessage(e, t), 'error');
    },
  });
  const toggle = (id: string) => setRateIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : ids.length < MAX_GROUP_RATES ? [...ids, id] : ids));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (name.trim().length < 2) next.name = t('taxes.validation.name');
    if (!group && !rateIds.length) next.rates = t('taxes.validation.rates');
    setErrors(next);
    if (Object.keys(next).length) return;
    if (group && name.trim() === group.name) return onClose();
    save.mutate();
  };
  const total = rateIds.reduce((s, id) => s + (rates.find((r) => r.id === id)?.ratePpm ?? 0), 0);

  return (
    <Modal
      open
      onClose={onClose}
      title={group ? t('taxes.groupDialog.editTitle', { name: group.name }) : t('taxes.groupDialog.newTitle')}
      description={group ? t('taxes.groupDialog.fixedRates') : t('taxes.groupDialog.description')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="tax-group-form" loading={save.isPending}>
            {group ? t('common.save') : t('taxes.groupDialog.create')}
          </Button>
        </>
      }
    >
      <form id="tax-group-form" onSubmit={submit} noValidate className="space-y-4">
        <TextField label={t('taxes.fields.name')} value={name} onChange={(e) => setName(e.target.value)} error={errors.name} dir="auto" data-autofocus placeholder={t('taxes.groupDialog.namePlaceholder')} />
        {!group && (
          <Field label={t('taxes.fields.rates')} error={errors.rates} hint={t('taxes.groupDialog.total', { rate: `${total / 10_000}%` })}>
            {({ describedBy }) => (
              <ul aria-describedby={describedBy} className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-ink-200 p-2 dark:border-ink-700">
                {active.length ? (
                  active.map((r) => (
                    <li key={r.id}>
                      <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-ink-50 dark:hover:bg-ink-800">
                        <input type="checkbox" checked={rateIds.includes(r.id)} onChange={() => toggle(r.id)} className="size-4 rounded accent-brand-600" />
                        <span className="flex-1" dir="auto">
                          {r.name}
                        </span>
                        <span className="text-xs text-ink-500">{t(`taxes.kinds.${r.kind}`)}</span>
                      </label>
                    </li>
                  ))
                ) : (
                  <li className="px-2 py-1.5 text-sm text-ink-500">{t('taxes.groupDialog.noRates')}</li>
                )}
              </ul>
            )}
          </Field>
        )}
      </form>
    </Modal>
  );
}

/** Pick the GST slabs to set up: those in force are ticked; retired ones are there for back-dated entries. */
export function GstSetupDialog({ gst, api, onClose, onDone }: { gst: GstStatus; api: TaxesApi; onClose: () => void; onDone: (r: GstSetupResult) => void }) {
  const { t } = useTranslation();
  const locale = useIntlLocale();
  const toast = useToast();
  const [chosen, setChosen] = useState<string[]>(gst.slabs.filter((s) => s.inForce && !s.setUp).map((s) => s.id));
  const setup = useMutation({
    mutationFn: () => api.setupGst(chosen),
    onSuccess: onDone,
    onError: (e) => toast(taxErrorMessage(e, t), 'error'),
  });
  const toggle = (id: string) => setChosen((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  const local = gst.utgst ? 'UTGST' : 'SGST';
  const [today] = useState(todayIso);
  const section = (title: string, slabs: GstStatus['slabs']) =>
    slabs.length > 0 && (
      <fieldset className="space-y-1">
        <legend className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-500">{title}</legend>
        {slabs.map((s) => (
          <label key={s.id} className="flex cursor-pointer items-start gap-3 rounded-md px-2 py-2 hover:bg-ink-50 dark:hover:bg-ink-800">
            <input type="checkbox" checked={s.setUp || chosen.includes(s.id)} disabled={s.setUp} onChange={() => toggle(s.id)} className="mt-0.5 size-4 rounded accent-brand-600" />
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-semibold tabular-nums">{s.rate}</span>
                <span className="text-sm">{s.label}</span>
                {s.setUp && <span className="text-xs text-income">{t('taxes.gst.alreadySetUp')}</span>}
              </span>
              <span className="block text-xs text-ink-500">
                {s.effectiveTo ? t('taxes.gst.appliedUntil', { from: dayLabel(s.effectiveFrom, locale), to: dayLabel(s.effectiveTo, locale) }) : t('taxes.gst.appliesFrom', { from: dayLabel(s.effectiveFrom, locale) })}
              </span>
            </span>
          </label>
        ))}
      </fieldset>
    );
  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title={t('taxes.gst.setupTitle')}
      description={t('taxes.gst.setupBody', { local })}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => setup.mutate()} loading={setup.isPending} disabled={!chosen.length}>
            {t('taxes.gst.setupConfirm', { count: chosen.length })}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {section(
          t('taxes.gst.inForce'),
          gst.slabs.filter((s) => s.inForce),
        )}
        {section(
          t('taxes.gst.retired'),
          gst.slabs.filter((s) => !s.inForce && s.effectiveFrom <= today),
        )}
        {section(
          t('taxes.gst.upcoming'),
          gst.slabs.filter((s) => !s.inForce && s.effectiveFrom > today),
        )}
      </div>
    </Modal>
  );
}
