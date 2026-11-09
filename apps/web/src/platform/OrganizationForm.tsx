import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { organizationCreateSchema, slugify } from '@ledgernest/shared';
import { useIntlLocale } from '../i18n';
import { SelectField, TextField } from '../ui/Field';
import { countryOptions, currencyOptions, localeOptions, monthOptions } from './options';
import type { FieldErrors, OrganizationFormValues } from './formValues';

/**
 * Organisation details form, used for create (with web address and first Owner) and edit.
 * Validates with the same shared rules as the API, then shows translated messages.
 */
export default function OrganizationForm({
  id,
  mode,
  initial,
  serverErrors,
  onSubmit,
}: {
  id: string;
  mode: 'create' | 'edit';
  initial: OrganizationFormValues;
  serverErrors?: FieldErrors;
  onSubmit: (v: OrganizationFormValues) => void;
}) {
  const { t } = useTranslation();
  const locale = useIntlLocale();
  const [v, setV] = useState(initial);
  const [slugTouched, setSlugTouched] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const shown = { ...errors, ...serverErrors };
  const set = <K extends keyof OrganizationFormValues>(k: K, value: OrganizationFormValues[K]) => setV((x) => ({ ...x, [k]: value }));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const result = organizationCreateSchema.safeParse({
      name: v.name,
      slug: mode === 'create' && v.slug ? v.slug : undefined,
      baseCurrency: v.baseCurrency,
      country: v.country || null,
      locale: v.locale,
      fiscalYearStartMonth: v.fiscalYearStartMonth,
      owner: { email: mode === 'create' ? v.ownerEmail : 'unused@example.com' },
    });
    if (!result.success) {
      const next: FieldErrors = {};
      for (const issue of result.error.issues) {
        const path = issue.path.join('.');
        if (path === 'name') next.name = t('platform.form.errors.name');
        else if (path === 'slug') next.slug = t('platform.form.errors.slug');
        else if (path === 'owner.email') next.ownerEmail = t('auth.errors.emailInvalid');
      }
      setErrors(next);
      return;
    }
    setErrors({});
    onSubmit(v);
  };

  const autoSlug = slugify(v.name);
  return (
    <form id={id} onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <TextField
          label={t('platform.form.name')}
          value={v.name}
          onChange={(e) => {
            set('name', e.target.value);
            if (!slugTouched) set('slug', '');
          }}
          error={shown.name}
          autoComplete="organization"
          dir="auto"
          data-autofocus
        />
      </div>
      {mode === 'create' && (
        <>
          <div className="sm:col-span-2">
            <TextField
              label={t('platform.form.slug')}
              value={v.slug}
              placeholder={autoSlug || 'acme-traders'}
              onChange={(e) => {
                setSlugTouched(true);
                set('slug', e.target.value.toLowerCase());
              }}
              error={shown.slug}
              hint={t('platform.form.slugHint', { slug: v.slug || autoSlug || '…' })}
              dir="ltr"
            />
          </div>
          <div className="sm:col-span-2">
            <TextField
              label={t('platform.form.ownerEmail')}
              type="email"
              inputMode="email"
              value={v.ownerEmail}
              onChange={(e) => set('ownerEmail', e.target.value)}
              error={shown.ownerEmail}
              hint={t('platform.form.ownerHint')}
              dir="ltr"
              placeholder="owner@company.com"
            />
          </div>
        </>
      )}
      <SelectField label={t('platform.form.currency')} value={v.baseCurrency} onChange={(e) => set('baseCurrency', e.target.value)} options={currencyOptions(locale, v.baseCurrency)} />
      <SelectField label={t('platform.form.country')} value={v.country} onChange={(e) => set('country', e.target.value)} options={countryOptions(locale, t('platform.form.noCountry'))} />
      <SelectField
        label={t('platform.form.fiscalYear')}
        value={String(v.fiscalYearStartMonth)}
        onChange={(e) => set('fiscalYearStartMonth', Number(e.target.value))}
        options={monthOptions(locale)}
      />
      <SelectField label={t('platform.form.locale')} value={v.locale} onChange={(e) => set('locale', e.target.value)} options={localeOptions(locale)} hint={t('platform.form.localeHint')} />
    </form>
  );
}
