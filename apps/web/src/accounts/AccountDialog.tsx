import { useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useCurrenciesApi } from '../currencies/useCurrenciesApi';
import { useSession } from '../layout/session';
import { ACCOUNT_SUBTYPES, ACCOUNT_TYPES, accountCreateSchema, NORMAL_SIDE, subtypeBelongsTo, type AccountType, type AccountUpdateInput } from '@ledgernest/shared';
import { useTranslation } from 'react-i18next';
import Button from '../ui/Button';
import { Field, inputClass, SelectField, TextField } from '../ui/Field';
import Modal from '../ui/Modal';
import { useToast } from '../ui/toastContext';
import { accountErrorMessage, errorField } from './errors';
import { levelOf, parentChoices, suggestCode } from './tree';
import type { Account, AccountsApi } from './types';

export type Editing = { mode: 'create'; type?: AccountType; parent?: Account } | { mode: 'edit'; account: Account };
type Errors = Partial<Record<'code' | 'name' | 'subtype' | 'parentId' | 'description' | 'currency', string>>;

/** Add or edit an account. The parent list only offers accounts of the same type with room beneath them. */
export default function AccountDialog({ editing, accounts, api, onClose, onSaved }: { editing: Editing; accounts: Account[]; api: AccountsApi; onClose: () => void; onSaved: (a: Account) => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const current = editing.mode === 'edit' ? editing.account : undefined;
  const startParent = editing.mode === 'create' ? editing.parent : undefined;
  const startType: AccountType = current?.type ?? startParent?.type ?? (editing.mode === 'create' ? editing.type : undefined) ?? 'asset';

  const [type, setType] = useState<AccountType>(current?.type ?? startType);
  const [subtype, setSubtype] = useState<string>(current?.subtype ?? startParent?.subtype ?? ACCOUNT_SUBTYPES[startType][0]);
  const [parentId, setParentId] = useState(current?.parentId ?? startParent?.id ?? '');
  const [code, setCode] = useState(current?.code ?? suggestCode(accounts, startType, startParent));
  const [name, setName] = useState(current?.name ?? '');
  const [description, setDescription] = useState(current?.description ?? '');
  const [errors, setErrors] = useState<Errors>({});
  const [currency, setCurrency] = useState(current?.currency ?? '');
  const session = useSession();
  const currenciesApi = useCurrenciesApi();
  const currencies = useQuery({ queryKey: ['currencies', session.organizationId, session.role ?? session.customRoleName], queryFn: () => currenciesApi!.list(), enabled: !!currenciesApi });
  // Only assets and liabilities can be kept in a foreign currency
  const canHaveCurrency = (type === 'asset' || type === 'liability') && !current?.system && ((currencies.data?.currencies.length ?? 0) > 0 || !!currency);

  // Type can change only for new accounts, or ones without sub-accounts that aren't system accounts
  const typeLocked = !!current && (current.system || current.childCount > 0);
  const parents = parentChoices(accounts, type, current);
  const parent = accounts.find((a) => a.id === parentId);

  const changeType = (next: AccountType) => {
    setType(next);
    if (!subtypeBelongsTo(next, subtype)) setSubtype(ACCOUNT_SUBTYPES[next][0]);
    if (parent && parent.type !== next) setParentId('');
    if (!current) setCode(suggestCode(accounts, next));
  };
  const changeParent = (id: string) => {
    setParentId(id);
    const p = accounts.find((a) => a.id === id);
    if (p) setSubtype(p.subtype);
    if (!current) setCode(suggestCode(accounts, type, p));
  };

  const save = useMutation({
    mutationFn: () => {
      const values = { code, name, type, subtype, parentId: parentId || null, description, currency: canHaveCurrency ? currency || null : null };
      if (!current) return api.create(values);
      const patch: AccountUpdateInput = {};
      if (values.code !== current.code) patch.code = values.code;
      if (values.name !== current.name) patch.name = values.name;
      if (values.type !== current.type) patch.type = values.type;
      if (values.subtype !== current.subtype) patch.subtype = values.subtype;
      if (values.parentId !== current.parentId) patch.parentId = values.parentId;
      if ((values.description || null) !== current.description) patch.description = values.description;
      if (values.currency !== (current.currency ?? null)) patch.currency = values.currency;
      return Object.keys(patch).length ? api.update(current.id, patch) : Promise.resolve(current);
    },
    onSuccess: (a) => {
      toast(current ? t('accounts.saved', { name: a.name }) : t('accounts.created', { name: a.name }));
      onSaved(a);
    },
    onError: (e) => {
      const field = errorField(e);
      if (field) setErrors({ [field]: accountErrorMessage(e, t) });
      else toast(accountErrorMessage(e, t), 'error');
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const r = accountCreateSchema.safeParse({ code, name, type, subtype, parentId: parentId || null, description, currency: canHaveCurrency ? currency || null : null });
    if (!r.success) {
      const next: Errors = {};
      for (const issue of r.error.issues) {
        const f = String(issue.path[0]) as keyof Errors;
        next[f] = t(`accounts.validation.${f}`, { defaultValue: t('settings.errors.invalid') });
      }
      setErrors(next);
      return;
    }
    setErrors({});
    save.mutate();
  };

  const indent = (a: Account) => `${'— '.repeat(levelOf(accounts, a.id) - 1)}${a.code} · ${a.name}`;
  return (
    <Modal
      open
      onClose={onClose}
      title={current ? t('accounts.dialog.editTitle', { name: current.name }) : startParent ? t('accounts.dialog.subTitle', { name: startParent.name }) : t('accounts.dialog.newTitle')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="account-form" loading={save.isPending}>
            {current ? t('common.save') : t('accounts.dialog.create')}
          </Button>
        </>
      }
    >
      <form id="account-form" onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        <SelectField
          label={t('accounts.fields.type')}
          value={type}
          onChange={(e) => changeType(e.target.value as AccountType)}
          disabled={typeLocked}
          options={ACCOUNT_TYPES.map((x) => ({ value: x, label: t(`accounts.types.${x}`) }))}
          hint={typeLocked ? t(current?.system ? 'accounts.hints.systemType' : 'accounts.hints.typeLocked') : t(`accounts.hints.normal.${NORMAL_SIDE[type]}`)}
        />
        <SelectField
          label={t('accounts.fields.subtype')}
          value={subtype}
          onChange={(e) => setSubtype(e.target.value)}
          disabled={current?.system}
          error={errors.subtype}
          options={ACCOUNT_SUBTYPES[type].map((s) => ({ value: s, label: t(`accounts.subtypes.${s}`) }))}
        />
        <div className="sm:col-span-2">
          <SelectField
            label={t('accounts.fields.parent')}
            value={parentId}
            onChange={(e) => changeParent(e.target.value)}
            disabled={current?.system}
            error={errors.parentId}
            hint={t('accounts.hints.parent')}
            options={[{ value: '', label: t('accounts.topLevel') }, ...parents.map((a) => ({ value: a.id, label: indent(a) }))]}
          />
        </div>
        {canHaveCurrency && (
          <div className="sm:col-span-2">
            <SelectField
              label={t('accounts.fields.currency')}
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              error={errors.currency}
              hint={current && current.currency !== null ? t('accounts.hints.currencyLocked') : t('accounts.hints.currency')}
              options={[
                { value: '', label: t('accounts.baseCurrency', { code: currencies.data?.base ?? '' }) },
                ...[...new Set([...(currencies.data?.currencies.map((c) => c.code) ?? []), ...(currency ? [currency] : [])])].map((c) => ({ value: c, label: c })),
              ]}
            />
          </div>
        )}
        <TextField label={t('accounts.fields.code')} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} error={errors.code} dir="ltr" className="font-mono" hint={t('accounts.hints.code')} data-autofocus={!!current || undefined} />
        <TextField label={t('accounts.fields.name')} value={name} onChange={(e) => setName(e.target.value)} error={errors.name} dir="auto" data-autofocus={!current || undefined} />
        <div className="sm:col-span-2">
          <Field label={t('accounts.fields.description')} error={errors.description}>
            {({ id, describedBy }) => (
              <textarea id={id} aria-describedby={describedBy} value={description} onChange={(e) => setDescription(e.target.value)} rows={2} dir="auto" className={`${inputClass} h-auto border-ink-200 py-2 dark:border-ink-700`} />
            )}
          </Field>
        </div>
      </form>
    </Modal>
  );
}
