import { useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { contactCreateSchema, MSME_CATEGORIES, type MsmeCategory, INDIAN_STATES, isGstin, type ContactAddress, type ContactUpdateInput, currencyDigits, toMinor } from '@ledgernest/shared';
import { useTranslation } from 'react-i18next';
import { useCurrenciesApi } from '../currencies/useCurrenciesApi';
import { useIntlLocale } from '../i18n';
import { useSession } from '../layout/session';
import { countryOptions } from '../platform/options';
import Button from '../ui/Button';
import { Field, inputClass, SelectField, TextField } from '../ui/Field';
import Modal from '../ui/Modal';
import IndianAddressFields from '../geo/IndianAddressFields';
import { useToast } from '../ui/toastContext';
import { ApiError } from '../auth/client';
import { contactErrorMessage } from './errors';
import type { Contact, ContactsApi } from './types';

type Address = { line1: string; line2: string; city: string; region: string; postalCode: string; country: string };
const toForm = (a: ContactAddress | null | undefined): Address => ({ line1: a?.line1 ?? '', line2: a?.line2 ?? '', city: a?.city ?? '', region: a?.region ?? '', postalCode: a?.postalCode ?? '', country: a?.country ?? '' });
const fromForm = (a: Address): ContactAddress => ({ line1: a.line1 || null, line2: a.line2 || null, city: a.city || null, region: a.region || null, postalCode: a.postalCode || null, country: a.country || null });

/** One address: an Indian one is filled from its PIN code (state from the GST list), others are typed. */
function AddressFields({ prefix, value, onChange, errors }: { prefix: 'billing' | 'shipping'; value: Address; onChange: (a: Address) => void; errors: Record<string, string> }) {
  const { t } = useTranslation();
  const locale = useIntlLocale();
  const set = (patch: Partial<Address>) => onChange({ ...value, ...patch });
  const err = (f: string) => errors[`${prefix}Address.${f}`];
  const country = <SelectField label={t('contacts.address.country')} value={value.country} onChange={(e) => set({ country: e.target.value })} options={countryOptions(locale, t('contacts.address.noCountry'))} />;
  return (
    <fieldset className="grid gap-3 sm:grid-cols-2">
      <legend className="mb-2 text-sm font-semibold">{t(`contacts.fields.${prefix}Address`)}</legend>
      {value.country === 'IN' ? (
        <>
          <IndianAddressFields value={value} onChange={set} error={(f) => err(f)} />
          {country}
        </>
      ) : (
        <>
          <div className="sm:col-span-2">
            <TextField label={t('contacts.address.line1')} value={value.line1} onChange={(e) => set({ line1: e.target.value })} dir="auto" />
          </div>
          <div className="sm:col-span-2">
            <TextField label={t('contacts.address.line2')} value={value.line2} onChange={(e) => set({ line2: e.target.value })} dir="auto" />
          </div>
          <TextField label={t('contacts.address.city')} value={value.city} onChange={(e) => set({ city: e.target.value })} dir="auto" />
          <TextField label={t('contacts.address.region')} value={value.region} onChange={(e) => set({ region: e.target.value })} error={err('region')} dir="auto" />
          <TextField label={t('contacts.address.postalCode')} value={value.postalCode} onChange={(e) => set({ postalCode: e.target.value })} dir="ltr" />
          {country}
        </>
      )}
    </fieldset>
  );
}

/** Add or edit a customer or vendor. */
export default function ContactDialog({ contact, defaultType, api, onClose, onSaved }: { contact?: Contact; defaultType?: 'customer' | 'vendor'; api: ContactsApi; onClose: () => void; onSaved: (c: Contact) => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const session = useSession();
  const currenciesApi = useCurrenciesApi();
  const currencies = useQuery({ queryKey: ['currencies', session.organizationId, session.role ?? session.customRoleName], queryFn: () => currenciesApi!.list(), enabled: !!currenciesApi });
  const [name, setName] = useState(contact?.name ?? '');
  const [isCustomer, setCustomer] = useState(contact?.isCustomer ?? defaultType !== 'vendor');
  const [isVendor, setVendor] = useState(contact?.isVendor ?? defaultType === 'vendor');
  const [legalName, setLegalName] = useState(contact?.legalName ?? '');
  const [taxId, setTaxId] = useState(contact?.taxId ?? '');
  const [email, setEmail] = useState(contact?.email ?? '');
  const [phone, setPhone] = useState(contact?.phone ?? '');
  const [billing, setBilling] = useState<Address>(() => toForm(contact?.billingAddress ?? { line1: null, line2: null, city: null, region: null, postalCode: null, country: 'IN' }));
  const [sameShipping, setSameShipping] = useState(!contact?.shippingAddress);
  const [shipping, setShipping] = useState<Address>(() => toForm(contact?.shippingAddress ?? null));
  const [currency, setCurrency] = useState(contact?.currency ?? '');
  const [terms, setTerms] = useState(String(contact?.paymentTermsDays ?? 30));
  const limitDigits = currencyDigits(currency || currencies.data?.base || contact?.currency || 'INR');
  const [limit, setLimit] = useState(contact?.creditLimit != null ? String(contact.creditLimit / 10 ** currencyDigits(contact.currency ?? 'INR')) : '');
  const [msme, setMsme] = useState<MsmeCategory | ''>(contact?.msmeCategory ?? '');
  const [udyam, setUdyam] = useState(contact?.udyamNumber ?? '');
  const [notes, setNotes] = useState(contact?.notes ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});

  // A valid GSTIN tells the state, so fill it in
  const changeTaxId = (v: string) => {
    setTaxId(v);
    const g = v.trim().toUpperCase();
    if (billing.country === 'IN' && isGstin(g)) {
      const state = INDIAN_STATES.find((s) => s.code === g.slice(0, 2));
      if (state) setBilling((b) => ({ ...b, region: state.name }));
    }
  };

  const values = () => ({
    name,
    isCustomer,
    isVendor,
    legalName,
    taxId,
    email,
    phone,
    billingAddress: fromForm(billing),
    shippingAddress: sameShipping ? null : fromForm(shipping),
    currency: currency || null,
    paymentTermsDays: Number(terms),
    // Only customers have one; blank = no limit
    creditLimit: isCustomer && limit.trim() ? (toMinor(limit, limitDigits) ?? Number.NaN) : null,
    // Only vendors are paid under the MSME rules
    msmeCategory: isVendor && msme ? msme : null,
    udyamNumber: isVendor ? udyam : '',
    notes,
  });
  const save = useMutation({
    mutationFn: () => {
      const v = values();
      if (!contact) return api.create(v);
      const parsed = contactCreateSchema.parse(v);
      const patch: ContactUpdateInput = {};
      for (const k of Object.keys(parsed) as (keyof typeof parsed)[]) {
        const now = parsed[k];
        const before = contact[k as keyof Contact];
        if (JSON.stringify(now) !== JSON.stringify(before ?? null)) (patch as Record<string, unknown>)[k] = now;
      }
      return Object.keys(patch).length ? api.update(contact.id, patch) : Promise.resolve(contact);
    },
    onSuccess: (c) => {
      toast(contact ? t('contacts.saved', { name: c.name }) : t('contacts.created', { name: c.name }));
      onSaved(c);
    },
    onError: (e) => {
      const field = e instanceof ApiError && typeof e.details?.field === 'string' ? e.details.field : null;
      if (field) setErrors({ [field]: contactErrorMessage(e, t) });
      else toast(contactErrorMessage(e, t), 'error');
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const r = contactCreateSchema.safeParse(values());
    if (!r.success) {
      const next: Record<string, string> = {};
      for (const issue of r.error.issues) next[issue.path.join('.')] ??= issue.message;
      setErrors(next);
      return;
    }
    setErrors({});
    save.mutate();
  };

  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title={contact ? t('contacts.dialog.editTitle', { name: contact.name }) : t('contacts.dialog.newTitle')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="contact-form" loading={save.isPending}>
            {contact ? t('common.save') : t('contacts.dialog.create')}
          </Button>
        </>
      }
    >
      <form id="contact-form" onSubmit={submit} noValidate className="space-y-6">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <TextField label={t('contacts.fields.name')} value={name} onChange={(e) => setName(e.target.value)} error={errors.name} dir="auto" data-autofocus />
          </div>
          <Field label={t('contacts.fields.type')} error={errors.isCustomer}>
            {() => (
              <div className="flex h-10 items-center gap-5">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={isCustomer} onChange={(e) => setCustomer(e.target.checked)} className="size-4 rounded accent-brand-600" />
                  {t('contacts.customer')}
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={isVendor} onChange={(e) => setVendor(e.target.checked)} className="size-4 rounded accent-brand-600" />
                  {t('contacts.vendor')}
                </label>
              </div>
            )}
          </Field>
          <TextField label={t('contacts.fields.legalName')} value={legalName} onChange={(e) => setLegalName(e.target.value)} dir="auto" />
          <TextField label={billing.country === 'IN' ? t('contacts.fields.gstin') : t('contacts.fields.taxId')} value={taxId} onChange={(e) => changeTaxId(e.target.value)} error={errors.taxId} dir="ltr" className="font-mono uppercase" hint={billing.country === 'IN' ? t('contacts.hints.gstin') : undefined} />
          <SelectField
            label={t('contacts.fields.currency')}
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            error={errors.currency}
            options={[{ value: '', label: t('accounts.baseCurrency', { code: currencies.data?.base ?? '' }) }, ...[...new Set([...(currencies.data?.currencies.map((c) => c.code) ?? []), ...(currency ? [currency] : [])])].map((c) => ({ value: c, label: c }))]}
          />
          <TextField label={t('contacts.fields.email')} type="email" value={email} onChange={(e) => setEmail(e.target.value)} error={errors.email} dir="ltr" />
          <TextField label={t('contacts.fields.phone')} value={phone} onChange={(e) => setPhone(e.target.value)} error={errors.phone} dir="ltr" />
          <TextField label={t('contacts.fields.paymentTerms')} type="number" min={0} max={365} value={terms} onChange={(e) => setTerms(e.target.value)} error={errors.paymentTermsDays} hint={t('contacts.hints.paymentTerms')} />
          {isCustomer && <TextField label={t('contacts.fields.creditLimit')} value={limit} onChange={(e) => setLimit(e.target.value)} inputMode="decimal" dir="ltr" error={errors.creditLimit ? t('contacts.hints.badLimit') : undefined} hint={t('contacts.hints.creditLimit', { currency: currency || currencies.data?.base || '' })} />}
          {isVendor && billing.country === 'IN' && (
            <>
              <SelectField label={t('contacts.fields.msme')} value={msme} onChange={(e) => setMsme(e.target.value as MsmeCategory | '')} hint={t('contacts.hints.msme')} options={[{ value: '', label: t('contacts.msme.none') }, ...MSME_CATEGORIES.map((c) => ({ value: c, label: t(`contacts.msme.${c}`) }))]} />
              <TextField label={t('contacts.fields.udyam')} value={udyam} onChange={(e) => setUdyam(e.target.value)} error={errors.udyamNumber} placeholder="UDYAM-MH-26-0012345" dir="ltr" className="font-mono uppercase" />
            </>
          )}
        </div>
        <AddressFields prefix="billing" value={billing} onChange={setBilling} errors={errors} />
        <div className="space-y-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={sameShipping} onChange={(e) => setSameShipping(e.target.checked)} className="size-4 rounded accent-brand-600" />
            {t('contacts.sameShipping')}
          </label>
          {!sameShipping && <AddressFields prefix="shipping" value={shipping} onChange={setShipping} errors={errors} />}
        </div>
        <Field label={t('contacts.fields.notes')}>
          {({ id, describedBy }) => <textarea id={id} aria-describedby={describedBy} value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} dir="auto" className={`${inputClass} h-auto border-ink-200 py-2 dark:border-ink-700`} />}
        </Field>
      </form>
    </Modal>
  );
}
