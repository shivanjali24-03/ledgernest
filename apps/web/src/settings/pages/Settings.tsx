import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useBlocker } from 'react-router';
import { AnimatePresence, motion } from 'motion/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BUSINESS_TYPES, organizationSettingsSchema } from '@ledgernest/shared';
import { Building2, Lock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../../auth/client';
import { useAuth } from '../../auth/context';
import { useIntlLocale } from '../../i18n';
import { useSession } from '../../layout/session';
import { fadeUp, spring, stagger } from '../../motion/tokens';
import { apiErrorMessage } from '../../platform/errors';
import { baseCurrencyOptions, countryOptions, localeOptions, monthOptions } from '../../platform/options';
import Button from '../../ui/Button';
import ConfirmDialog from '../../ui/ConfirmDialog';
import { Field, inputClass, SelectField, TextField } from '../../ui/Field';
import { Card, EmptyState, ErrorState, PageHeader, SkeletonRows } from '../../ui/Kit';
import { useToast } from '../../ui/toastContext';
import { changes, fieldOf, fiscalYearSpan, timeIn, timeZoneOptions, toValues, type SettingsErrors, type SettingsField, type SettingsValues } from '../form';
import LogoCard from '../LogoCard';
import BackupsCard from '../../backups/BackupsCard';
import TallyCard from '../TallyCard';
import NumberSeriesCard from '../../numbering/NumberSeriesCard';
import GstRegistrationsCard from '../../gst-registrations/GstRegistrationsCard';
import BankDetailsFields from '../../bank/BankDetailsFields';
import IndianAddressFields, { type IndianAddress } from '../../geo/IndianAddressFields';
import DeleteOrganizationCard from '../DeleteOrganizationCard';
import ReminderPolicyCard from '../../invoices/ReminderPolicyCard';
import type { OrganizationSettings, SettingsApi } from '../types';
import { useSettingsApi } from '../useSettingsApi';

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <Card className="p-5">
      <h2 className="font-semibold">{title}</h2>
      {description && <p className="mt-1 text-sm text-ink-500">{description}</p>}
      <div className="mt-4 grid gap-4 sm:grid-cols-2">{children}</div>
    </Card>
  );
}

const LockedHint = ({ text }: { text: string }) => (
  <span className="inline-flex items-center gap-1">
    <Lock className="size-3" aria-hidden /> {text}
  </span>
);

/** The settings form, once the current values have loaded. */
function SettingsForm({ api, settings, canManage, queryKey }: { api: SettingsApi; settings: OrganizationSettings; canManage: boolean; queryKey: readonly unknown[] }) {
  const { t } = useTranslation();
  const locale = useIntlLocale();
  const toast = useToast();
  const auth = useAuth();
  const queryClient = useQueryClient();
  const initial = useMemo(() => toValues(settings), [settings]);
  const [v, setV] = useState(initial);
  const [errors, setErrors] = useState<SettingsErrors>({});
  // Start again from the saved values whenever they change (after saving, or someone else's edit)
  const [shownFor, setShownFor] = useState(initial);
  if (shownFor !== initial) {
    setShownFor(initial);
    setV(initial);
  }

  const diff = changes(initial, v);
  const dirty = Object.keys(diff).length > 0;
  const set = (k: SettingsField) => (e: { target: { value: string } }) => {
    setV((x) => ({ ...x, [k]: e.target.value }));
    setErrors((x) => ({ ...x, [k]: undefined }));
  };

  const setMany = (patch: Partial<SettingsValues>) => {
    setV((x) => ({ ...x, ...patch }));
    setErrors((x) => ({ ...x, ...Object.fromEntries(Object.keys(patch).map((k) => [k, undefined])) }));
  };
  const setAddress = useCallback((patch: Partial<IndianAddress>) => {
    setV((x) => ({ ...x, ...patch }));
    setErrors((x) => ({ ...x, ...Object.fromEntries(Object.keys(patch).map((k) => [k, undefined])) }));
  }, []);

  const save = useMutation({
    mutationFn: () => api.update(diff),
    onSuccess: async (saved) => {
      queryClient.setQueryData(queryKey, saved);
      toast(t('settings.saved'));
      // The organisation's name also appears in the top bar
      if (diff.name && auth.mode === 'live') await auth.reload();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.details?.reason === 'locked') toast(t(`settings.locked.${String(e.details.field)}`), 'error');
      else if (e instanceof ApiError && e.details?.reason === 'currency_enabled') toast(t('settings.errors.currencyEnabled'), 'error');
      else if (e instanceof ApiError && e.details?.reason === 'two_factor_self') toast(t('settings.errors.twoFactorSelf'), 'error');
      // The PAN or CIN doesn't agree with the GSTIN or the kind of business: shown next to the field
      else if (e instanceof ApiError && e.details?.reason === 'identifier') setErrors((x) => ({ ...x, [String(e.details!.field)]: t(`settings.errors.identifier.${String(e.details!.field)}`) }));
      else toast(apiErrorMessage(e, t), 'error');
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!dirty) return;
    // The same rules as the API, so problems show next to the field at once
    const result = organizationSettingsSchema.safeParse(diff);
    if (!result.success) {
      const next: SettingsErrors = {};
      for (const issue of result.error.issues) {
        const f = fieldOf(issue.path);
        if (f) next[f] = t(`settings.errors.${f}`, { defaultValue: t('settings.errors.invalid') });
      }
      setErrors(next);
      // Move to the first field with a problem once it's marked
      requestAnimationFrame(() => document.querySelector<HTMLElement>('form [aria-invalid="true"]')?.focus());
      return;
    }
    save.mutate();
  };

  // Ask before leaving with unsaved changes, inside the app and when closing the tab
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const text = (k: SettingsField, label: string, extra: Partial<Parameters<typeof TextField>[0]> = {}) => (
    <TextField label={label} value={v[k]} onChange={set(k)} error={errors[k]} disabled={!canManage} {...extra} />
  );
  const zones = useMemo(() => timeZoneOptions(locale, v.timeZone), [locale, v.timeZone]);

  return (
    <form onSubmit={submit} noValidate className="space-y-6 pb-24">
      <Section title={t('settings.company.title')} description={t('settings.company.description')}>
        <div className="sm:col-span-2">{text('name', t('settings.fields.name'), { autoComplete: 'organization', dir: 'auto' })}</div>
        {text('legalName', t('settings.fields.legalName'), { dir: 'auto', hint: t('settings.hints.legalName') })}
        {text('taxId', t('settings.fields.taxId'), { dir: 'ltr', hint: t('settings.hints.taxId'), autoCapitalize: 'characters' })}
        {text('email', t('settings.fields.email'), { type: 'email', inputMode: 'email', dir: 'ltr', autoComplete: 'email' })}
        {text('phone', t('settings.fields.phone'), { type: 'tel', inputMode: 'tel', dir: 'ltr', autoComplete: 'tel' })}
      </Section>

      <Section title={t('settings.address.title')}>
        {v.country === 'IN' ? (
          <IndianAddressFields value={v} onChange={setAddress} error={(f) => errors[f] as string | undefined} disabled={!canManage} autoComplete />
        ) : (
          <>
            <div className="sm:col-span-2">{text('line1', t('settings.fields.line1'), { autoComplete: 'address-line1', dir: 'auto' })}</div>
            <div className="sm:col-span-2">{text('line2', t('settings.fields.line2'), { autoComplete: 'address-line2', dir: 'auto' })}</div>
            {text('city', t('settings.fields.city'), { autoComplete: 'address-level2', dir: 'auto' })}
            {text('region', t('settings.fields.region'), { autoComplete: 'address-level1', dir: 'auto' })}
            {text('postalCode', t('settings.fields.postalCode'), { autoComplete: 'postal-code', dir: 'ltr' })}
          </>
        )}
        <SelectField label={t('settings.fields.country')} value={v.country} onChange={set('country')} disabled={!canManage} options={countryOptions(locale, t('platform.form.noCountry'))} />
      </Section>

      <Section title={t('settings.money.title')} description={t('settings.money.description')}>
        <SelectField
          label={t('settings.fields.baseCurrency')}
          value={v.baseCurrency}
          onChange={set('baseCurrency')}
          disabled={!canManage || settings.locks.baseCurrency}
          options={baseCurrencyOptions(locale, v.baseCurrency)}
          hint={settings.locks.baseCurrency ? <LockedHint text={t('settings.locked.baseCurrency')} /> : t('settings.hints.baseCurrency')}
        />
        <SelectField
          label={t('settings.fields.fiscalYearStartMonth')}
          value={v.fiscalYearStartMonth}
          onChange={set('fiscalYearStartMonth')}
          disabled={!canManage || settings.locks.fiscalYearStartMonth}
          options={monthOptions(locale)}
          hint={
            settings.locks.fiscalYearStartMonth ? (
              <LockedHint text={t('settings.locked.fiscalYearStartMonth')} />
            ) : (
              t('settings.hints.fiscalYear', { span: fiscalYearSpan(Number(v.fiscalYearStartMonth), locale) })
            )
          }
        />
        <SelectField label={t('settings.fields.locale')} value={v.locale} onChange={set('locale')} disabled={!canManage} options={localeOptions(locale, v.locale)} hint={t('platform.form.localeHint')} />
        <SelectField
          label={t('settings.fields.timeZone')}
          value={v.timeZone}
          onChange={set('timeZone')}
          disabled={!canManage}
          options={zones}
          error={errors.timeZone}
          hint={t('settings.hints.timeZone', { time: timeIn(v.timeZone, locale) })}
        />
      </Section>

      <Section title={t('settings.documents.title')} description={t('settings.documents.description')}>
        <div className="sm:col-span-2">
          <Field label={t('settings.fields.invoiceTerms')} error={errors.invoiceTerms} hint={t('settings.hints.invoiceTerms')}>
            {({ id, describedBy }) => <textarea id={id} aria-describedby={describedBy} value={v.invoiceTerms} onChange={set('invoiceTerms')} disabled={!canManage} maxLength={1000} rows={4} dir="auto" className={`${inputClass} h-auto border-ink-200 py-2 dark:border-ink-700`} />}
          </Field>
        </div>
        <label className="flex items-start gap-2 text-sm sm:col-span-2">
          <input type="checkbox" checked={v.roundInvoiceTotals === 'true'} disabled={!canManage} onChange={(e) => set('roundInvoiceTotals')({ target: { value: String(e.target.checked) } })} className="mt-0.5 size-4 rounded accent-brand-600" />
          <span>
            <span className="font-medium">{t('settings.fields.roundInvoiceTotals')}</span>
            <span className="block text-xs text-ink-500">{t('settings.hints.roundInvoiceTotals')}</span>
          </span>
        </label>
        {text('upiId', t('settings.fields.upiId'), { dir: 'ltr', inputMode: 'email', autoCapitalize: 'none', spellCheck: false, placeholder: 'yourname@okhdfcbank', hint: t('settings.hints.upiId') })}
        {v.country === 'IN' && (
          <div className="grid gap-3 sm:col-span-2 sm:grid-cols-2">
            {text('signatoryName', t('settings.fields.signatoryName'), { dir: 'auto', hint: t('settings.hints.signatoryName') })}
            {text('signatoryDesignation', t('settings.fields.signatoryDesignation'), { dir: 'auto', placeholder: t('settings.hints.signatoryDesignation') })}
          </div>
        )}
        {v.country === 'IN' && (
          <BankDetailsFields
            value={{ accountName: v.bankAccountName, accountNumber: v.bankAccountNumber, ifsc: v.bankIfsc, bankName: v.bankName, branch: v.bankBranch }}
            onChange={(b) => setMany({ bankAccountName: b.accountName, bankAccountNumber: b.accountNumber, bankIfsc: b.ifsc, bankName: b.bankName, bankBranch: b.branch })}
            errors={{ accountName: errors.bankAccountName, accountNumber: errors.bankAccountNumber, ifsc: errors.bankIfsc }}
            disabled={!canManage}
          />
        )}
      </Section>

      {v.country === 'IN' && (
        <Section title={t('settings.ids.title')} description={t('settings.ids.description')}>
          <SelectField label={t('settings.fields.businessType')} value={v.businessType} onChange={set('businessType')} disabled={!canManage} options={[{ value: '', label: t('settings.businessTypes.none') }, ...BUSINESS_TYPES.map((b) => ({ value: b, label: t(`settings.businessTypes.${b}`) }))]} />
          {text('pan', t('settings.fields.pan'), { dir: 'ltr', className: 'font-mono uppercase', placeholder: v.taxId.length === 15 ? v.taxId.slice(2, 12) : 'AAPFN1234C' })}
          {text('tan', t('settings.fields.tan'), { dir: 'ltr', className: 'font-mono uppercase', hint: t('settings.hints.tan') })}
          {(v.businessType === 'llp' || v.businessType === 'private_limited' || v.businessType === 'public_limited' || v.businessType === 'opc') && text('cin', t(v.businessType === 'llp' ? 'settings.fields.llpin' : 'settings.fields.cin'), { dir: 'ltr', className: 'font-mono uppercase', hint: t('settings.hints.cin') })}
          {text('iec', t('settings.fields.iec'), { dir: 'ltr', className: 'font-mono uppercase', hint: t('settings.hints.iec') })}
        </Section>
      )}

      {v.country === 'IN' && (
        <Section title={t('settings.gst.title')} description={t('settings.gst.description')}>
          <SelectField label={t('settings.fields.gstScheme')} value={v.gstScheme} onChange={set('gstScheme')} disabled={!canManage} hint={v.gstScheme === 'composition' ? t('settings.hints.composition') : undefined} options={[{ value: 'regular', label: t('settings.gstSchemes.regular') }, { value: 'composition', label: t('settings.gstSchemes.composition') }]} />
          {text('lutNumber', t('settings.fields.lutNumber'), { dir: 'ltr', className: 'font-mono uppercase', hint: t('settings.hints.lutNumber') })}
          <div className="grid grid-cols-2 gap-3">
            {text('lutFrom', t('settings.fields.lutFrom'), { type: 'date' })}
            {text('lutTo', t('settings.fields.lutTo'), { type: 'date' })}
          </div>
          {v.gstScheme === 'composition' && <SelectField label={t('settings.fields.compositionRate')} value={v.compositionRate} onChange={set('compositionRate')} disabled={!canManage} hint={t('settings.hints.compositionRate')} options={[{ value: '100', label: t('settings.compositionRates.100') }, { value: '500', label: t('settings.compositionRates.500') }, { value: '600', label: t('settings.compositionRates.600') }]} />}
        </Section>
      )}

      {v.country === 'IN' && (
        <Section title={t('settings.msme.title')} description={t('settings.msme.description')}>
          <SelectField label={t('settings.fields.msmeCategory')} value={v.msmeCategory} onChange={set('msmeCategory')} disabled={!canManage} options={[{ value: '', label: t('contacts.msme.none') }, ...(['micro', 'small', 'medium'] as const).map((c) => ({ value: c, label: t(`contacts.msme.${c}`) }))]} />
          {text('udyamNumber', t('settings.fields.udyamNumber'), { dir: 'ltr', placeholder: 'UDYAM-MH-26-0012345', className: 'font-mono uppercase' })}
          {(v.msmeCategory === 'micro' || v.msmeCategory === 'small') && text('msmeBankRate', t('settings.fields.msmeBankRate'), { dir: 'ltr', inputMode: 'decimal', placeholder: '5.50', hint: t('settings.hints.msmeBankRate') })}
        </Section>
      )}

      <Section title={t('settings.interest.title')} description={t('settings.interest.description')}>
        {text('interestRate', t('settings.fields.interestRate'), { dir: 'ltr', inputMode: 'decimal', placeholder: '18', hint: t('settings.hints.interestRate') })}
        <SelectField label={t('settings.fields.interestMethod')} value={v.interestMethod} onChange={set('interestMethod')} disabled={!canManage || !v.interestRate.trim()} options={[{ value: 'simple', label: t('settings.interestMethods.simple') }, { value: 'monthly', label: t('settings.interestMethods.monthly') }]} />
        {text('interestGraceDays', t('settings.fields.interestGraceDays'), { dir: 'ltr', inputMode: 'numeric', disabled: !canManage || !v.interestRate.trim(), hint: t('settings.hints.interestGraceDays') })}
        <label className="flex items-start gap-2 text-sm sm:col-span-2">
          <input type="checkbox" checked={v.interestAutoRaise === 'true'} disabled={!canManage || !v.interestRate.trim()} onChange={(e) => set('interestAutoRaise')({ target: { value: String(e.target.checked) } })} className="mt-0.5 size-4 rounded accent-brand-600" />
          <span>
            <span className="font-medium">{t('settings.fields.interestAutoRaise')}</span>
            <span className="block text-xs text-ink-500">{t('settings.hints.interestAutoRaise')}</span>
          </span>
        </label>
      </Section>

      <Section title={t('settings.email.title')} description={t('settings.email.description')}>
        <label className="flex items-start gap-2 text-sm sm:col-span-2">
          <input type="checkbox" checked={v.weeklySummary === 'true'} disabled={!canManage} onChange={(e) => set('weeklySummary')({ target: { value: String(e.target.checked) } })} className="mt-0.5 size-4 rounded accent-brand-600" />
          <span>
            <span className="font-medium">{t('settings.fields.weeklySummary')}</span>
            <span className="block text-ink-500">{t('settings.hints.weeklySummary')}</span>
          </span>
        </label>
      </Section>

      <Section title={t('settings.security.title')} description={t('settings.security.description')}>
        <label className="flex items-start gap-2 text-sm sm:col-span-2">
          <input type="checkbox" checked={v.requireTwoFactor === 'true'} disabled={!canManage} onChange={(e) => set('requireTwoFactor')({ target: { value: String(e.target.checked) } })} className="mt-0.5 size-4 rounded accent-brand-600" />
          <span>
            <span className="font-medium">{t('settings.fields.requireTwoFactor')}</span>
            <span className="block text-ink-500">{t('settings.hints.requireTwoFactor')}</span>
          </span>
        </label>
      </Section>

      {/* Appears only with unsaved changes; slides with transform so it stays smooth at high refresh rates */}
      <AnimatePresence>
        {canManage && dirty && (
          <motion.div
            initial={{ y: 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1, transition: spring.snappy }}
            exit={{ y: 24, opacity: 0, transition: { duration: 0.15 } }}
            className="sticky bottom-4 z-20 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-ink-200 bg-white/95 p-3 shadow-pop backdrop-blur dark:border-ink-700 dark:bg-ink-900/95"
            role="region"
            aria-label={t('settings.unsaved')}
          >
            <p className="ps-2 text-sm font-medium">{t('settings.unsaved')}</p>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                onClick={() => {
                  setV(initial);
                  setErrors({});
                }}
              >
                {t('settings.discard')}
              </Button>
              <Button type="submit" loading={save.isPending}>
                {t('common.save')}
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <ConfirmDialog
        open={blocker.state === 'blocked'}
        title={t('settings.leave.title')}
        body={t('settings.leave.body')}
        confirmLabel={t('settings.leave.confirm')}
        tone="danger"
        onConfirm={() => blocker.proceed?.()}
        onClose={() => blocker.reset?.()}
      />
    </form>
  );
}

/** Organisation settings: company details, logo, address, money and dates. */
export default function Settings() {
  const { t } = useTranslation();
  const session = useSession();
  const api = useSettingsApi();
  const canManage = session.permissions.has('org.settings.manage');
  const queryKey = ['settings', session.organizationId, session.role ?? session.customRoleName] as const;
  const query = useQuery({ queryKey, queryFn: () => api!.get(), enabled: !!api });

  if (!api) {
    return (
      <Card>
        <EmptyState icon={<Building2 className="size-5" />} title={t('team.noOrganization')} body={t('team.noOrganizationBody')} />
      </Card>
    );
  }

  return (
    <motion.div variants={stagger(0.06)} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={fadeUp}>
        <PageHeader eyebrow={<span dir="auto">{session.organization}</span>} title={t('settings.title')} description={t('settings.description')} />
        {!canManage && (
          <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-ink-100 px-2.5 py-1 text-xs font-medium text-ink-600 dark:bg-ink-800 dark:text-ink-300">
            <Lock className="size-3.5" aria-hidden /> {t('settings.readOnly')}
          </p>
        )}
      </motion.div>
      <motion.div variants={fadeUp}>
        {query.isPending ? (
          <Card>
            <SkeletonRows rows={8} />
          </Card>
        ) : query.isError ? (
          <Card>
            <ErrorState onRetry={() => void query.refetch()} />
          </Card>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start">
            {/* First on phones; the right-hand column on wide screens */}
            <div className="lg:sticky lg:top-20 lg:order-last">
              <LogoCard api={api} settings={query.data} canManage={canManage} queryKey={queryKey} />
              {query.data.country === 'IN' && <LogoCard api={api} settings={query.data} canManage={canManage} queryKey={queryKey} kind="signature" />}
              {query.data.country === 'IN' && <LogoCard api={api} settings={query.data} canManage={canManage} queryKey={queryKey} kind="seal" />}
            </div>
            <SettingsForm api={api} settings={query.data} canManage={canManage} queryKey={queryKey} />
          </div>
        )}
      </motion.div>
      {session.permissions.has('invoices.view') && (
        <motion.div variants={fadeUp}>
          <GstRegistrationsCard />
        </motion.div>
      )}
      {session.permissions.has('invoices.view') && (
        <motion.div variants={fadeUp}>
          <NumberSeriesCard />
        </motion.div>
      )}
      {session.permissions.has('invoices.view') && (
        <motion.div variants={fadeUp}>
          <ReminderPolicyCard />
        </motion.div>
      )}
      {session.permissions.has('reports.export') && (
        <motion.div variants={fadeUp}>
          <TallyCard />
        </motion.div>
      )}
      {session.permissions.has('org.delete') && (
        <motion.div variants={fadeUp}>
          <BackupsCard />
        </motion.div>
      )}
      {session.permissions.has('org.delete') && api && (
        <motion.div variants={fadeUp}>
          <DeleteOrganizationCard api={api} />
        </motion.div>
      )}
    </motion.div>
  );
}
