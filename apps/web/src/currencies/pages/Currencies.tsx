import { useMemo, useState, type FormEvent } from 'react';
import { motion } from 'motion/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, ChevronDown, Coins, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import clsx from 'clsx';
import { KNOWN_CURRENCIES, normaliseRate } from '@ledgernest/shared';
import { useTranslation } from 'react-i18next';
import { useIntlLocale } from '../../i18n';
import { formatDate } from '../../lib/format';
import { useSession } from '../../layout/session';
import { fadeUp, stagger } from '../../motion/tokens';
import Button from '../../ui/Button';
import ConfirmDialog from '../../ui/ConfirmDialog';
import { SelectField, TextField } from '../../ui/Field';
import { Card, EmptyState, ErrorState, PageHeader, Pill, SkeletonRows } from '../../ui/Kit';
import Modal from '../../ui/Modal';
import RowMenu from '../../ui/RowMenu';
import { useToast } from '../../ui/toastContext';
import { currencyErrorMessage } from '../errors';
import type { CurrenciesApi, EnabledCurrency } from '../types';
import { useCurrenciesApi } from '../useCurrenciesApi';

/** "US Dollar" for USD, in the user's language */
function useCurrencyName() {
  const locale = useIntlLocale();
  const names = useMemo(() => {
    try {
      return new Intl.DisplayNames([locale], { type: 'currency' });
    } catch {
      return null;
    }
  }, [locale]);
  return (code: string) => names?.of(code) ?? code;
}

/** The foreign currencies an organisation trades in, and their exchange rates against the base currency. */
export default function Currencies() {
  const { t } = useTranslation();
  const session = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();
  const api = useCurrenciesApi();
  const nameOf = useCurrencyName();
  const canManage = session.permissions.has('currencies.manage');
  const key = ['currencies', session.organizationId, session.role ?? session.customRoleName] as const;
  const query = useQuery({ queryKey: key, queryFn: () => api!.list(), enabled: !!api });
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['currencies', session.organizationId] });

  const fetchRates = useMutation({
    mutationFn: () => api!.fetchRates(),
    onSuccess: (r) => {
      refresh();
      const parts = [r.saved.length ? t('currencies.fetched', { list: r.saved.map((s) => `${s.code} ${s.rate}`).join(', '), date: r.saved[0]!.date }) : t('currencies.fetchedNothing')];
      if (r.keptManual.length) parts.push(t('currencies.keptManual', { list: r.keptManual.join(', ') }));
      if (r.unsupported.length) parts.push(t('currencies.unsupported', { list: r.unsupported.join(', ') }));
      toast(parts.join(' '));
    },
    onError: (e) => toast(currencyErrorMessage(e, t), 'error'),
  });
  const remove = useMutation({
    mutationFn: (code: string) => api!.remove(code),
    onSuccess: (_r, code) => {
      setRemoving(null);
      toast(t('currencies.removed', { code }));
      refresh();
    },
    onError: (e) => {
      setRemoving(null);
      toast(currencyErrorMessage(e, t), 'error');
    },
  });

  if (!api) {
    return (
      <Card>
        <EmptyState icon={<Building2 className="size-5" />} title={t('team.noOrganization')} body={t('team.noOrganizationBody')} />
      </Card>
    );
  }
  const data = query.data;
  return (
    <motion.div variants={stagger(0.06)} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={fadeUp}>
        <PageHeader
          eyebrow={<span dir="auto">{session.organization}</span>}
          title={t('currencies.title')}
          description={data ? t('currencies.description', { base: data.base, name: nameOf(data.base) }) : undefined}
          actions={
            canManage && data ? (
              <>
                {data.currencies.length > 0 && (
                  <Button variant="ghost" icon={<RefreshCw className="size-4" />} loading={fetchRates.isPending} onClick={() => fetchRates.mutate()}>
                    {t('currencies.fetch')}
                  </Button>
                )}
                <Button icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>
                  {t('currencies.add')}
                </Button>
              </>
            ) : undefined
          }
        />
      </motion.div>
      <motion.div variants={fadeUp}>
        <Card className="overflow-hidden">
          {query.isPending ? (
            <SkeletonRows rows={4} />
          ) : query.isError ? (
            <ErrorState onRetry={() => void query.refetch()} />
          ) : !data!.currencies.length ? (
            <EmptyState icon={<Coins className="size-5" />} title={t('currencies.empty')} body={t('currencies.emptyBody', { base: data!.base })} />
          ) : (
            <ul className="divide-y divide-ink-100 dark:divide-ink-800">
              {data!.currencies.map((c) => (
                <CurrencyRow key={c.code} currency={c} base={data!.base} api={api} name={nameOf(c.code)} open={open === c.code} onToggle={() => setOpen(open === c.code ? null : c.code)} onChanged={refresh} onRemove={canManage ? () => setRemoving(c.code) : undefined} />
              ))}
            </ul>
          )}
        </Card>
      </motion.div>
      {data && <p className="text-sm text-ink-500">{t('currencies.sourceNote')}</p>}
      {adding && data && <AddCurrencyDialog api={api} base={data.base} enabled={data.currencies.map((c) => c.code)} nameOf={nameOf} onClose={() => setAdding(false)} onDone={(code) => (setAdding(false), setOpen(code), refresh())} />}
      <ConfirmDialog
        open={!!removing}
        title={removing ? t('currencies.removeTitle', { code: removing }) : ''}
        body={t('currencies.removeBody')}
        confirmLabel={t('currencies.remove')}
        tone="danger"
        busy={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing)}
        onClose={() => setRemoving(null)}
      />
    </motion.div>
  );
}

function CurrencyRow({ currency: c, base, api, name, open, onToggle, onChanged, onRemove }: { currency: EnabledCurrency; base: string; api: CurrenciesApi; name: string; open: boolean; onToggle: () => void; onChanged: () => void; onRemove?: () => void }) {
  const { t } = useTranslation();
  const locale = useIntlLocale();
  const day = (d: string) => formatDate(`${d}T00:00:00Z`, locale);
  return (
    <li>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3">
        <span className="w-14 shrink-0 font-mono text-lg font-semibold">{c.code}</span>
        <span className="min-w-0 flex-1">
          <span className="block font-medium">{name}</span>
          <span className="block text-sm text-ink-500">
            {c.latest ? (
              <>
                <span dir="ltr">{t('currencies.rateLine', { code: c.code, rate: c.latest.rate, base })}</span> · {day(c.latest.date)} <Pill tone={c.latest.source === 'ecb' ? 'brand' : 'neutral'}>{t(`currencies.source.${c.latest.source}`)}</Pill>
              </>
            ) : (
              <span className="text-warning">{t('currencies.noRate')}</span>
            )}
          </span>
        </span>
        <Button size="sm" variant="ghost" icon={<ChevronDown className={clsx('size-4 transition-transform', open && 'rotate-180')} />} aria-expanded={open} onClick={onToggle}>
          {t('currencies.rates', { code: c.code })}
        </Button>
        {onRemove && <RowMenu label={t('currencies.actionsFor', { code: c.code })} items={[{ key: 'remove', label: t('currencies.remove'), icon: Trash2, danger: true, onSelect: onRemove }]} />}
      </div>
      {open && <RatesPanel code={c.code} base={base} api={api} canEdit={!!onRemove} onChanged={onChanged} />}
    </li>
  );
}

function RatesPanel({ code, base, api, canEdit, onChanged }: { code: string; base: string; api: CurrenciesApi; canEdit: boolean; onChanged: () => void }) {
  const { t } = useTranslation();
  const locale = useIntlLocale();
  const session = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();
  const key = ['currencies', session.organizationId, 'rates', code] as const;
  const rates = useQuery({ queryKey: key, queryFn: () => api.rates(code) });
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [rate, setRate] = useState('');
  const [error, setError] = useState<string | undefined>();
  const done = () => {
    void queryClient.invalidateQueries({ queryKey: key });
    onChanged();
  };
  const set = useMutation({
    mutationFn: () => api.setRate(code, date, rate),
    onSuccess: (r) => {
      setRate('');
      toast(t('currencies.rateSaved', { code, rate: r.rate, date: formatDate(`${r.date}T00:00:00Z`, locale) }));
      done();
    },
    onError: (e) => toast(currencyErrorMessage(e, t), 'error'),
  });
  const removeRate = useMutation({ mutationFn: (d: string) => api.removeRate(code, d), onSuccess: done, onError: (e) => toast(currencyErrorMessage(e, t), 'error') });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!normaliseRate(rate)) return setError(t('currencies.validation.rate'));
    setError(undefined);
    set.mutate();
  };
  return (
    <div className="space-y-3 border-t border-ink-100 bg-ink-50/50 px-5 py-4 dark:border-ink-800 dark:bg-ink-950/30">
      {canEdit && (
        <form onSubmit={submit} noValidate className="grid items-start gap-3 sm:grid-cols-[11rem_12rem_auto]">
          <TextField type="date" label={t('currencies.fields.date')} value={date} onChange={(e) => setDate(e.target.value)} />
          <TextField label={t('currencies.fields.rate', { code, base })} value={rate} onChange={(e) => setRate(e.target.value)} error={error} inputMode="decimal" dir="ltr" placeholder="93.25" />
          <Button type="submit" className="justify-self-start sm:mt-6" loading={set.isPending}>
            {t('currencies.setRate')}
          </Button>
        </form>
      )}
      {rates.isPending ? (
        <SkeletonRows rows={3} />
      ) : rates.isError ? (
        <ErrorState onRetry={() => void rates.refetch()} />
      ) : !rates.data.length ? (
        <p className="text-sm text-ink-500">{t('currencies.noRates')}</p>
      ) : (
        <div className="max-h-72 overflow-y-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">{t('currencies.rates', { code })}</caption>
            <thead className="text-xs uppercase tracking-wide text-ink-400">
              <tr>
                <th scope="col" className="py-1.5 text-start font-semibold">
                  {t('currencies.fields.date')}
                </th>
                <th scope="col" className="py-1.5 text-end font-semibold">
                  {t('currencies.fields.rate', { code, base })}
                </th>
                <th scope="col" className="py-1.5 ps-4 text-start font-semibold">
                  {t('currencies.fields.source')}
                </th>
                {canEdit && (
                  <th scope="col" className="w-10">
                    <span className="sr-only">{t('currencies.removeRate')}</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
              {rates.data.map((r) => (
                <tr key={r.date}>
                  <td className="py-1.5">{formatDate(`${r.date}T00:00:00Z`, locale)}</td>
                  <td className="py-1.5 text-end font-mono tabular-nums" dir="ltr">
                    {r.rate}
                  </td>
                  <td className="py-1.5 ps-4 text-ink-500">{t(`currencies.source.${r.source}`)}</td>
                  {canEdit && (
                    <td className="py-1">
                      <button type="button" aria-label={t('currencies.removeRateOn', { date: formatDate(`${r.date}T00:00:00Z`, locale) })} onClick={() => removeRate.mutate(r.date)} className="grid size-8 place-items-center rounded-lg text-ink-400 hover:bg-ink-100 hover:text-expense dark:hover:bg-ink-800">
                        <X className="size-4" />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function AddCurrencyDialog({ api, base, enabled, nameOf, onClose, onDone }: { api: CurrenciesApi; base: string; enabled: string[]; nameOf: (c: string) => string; onClose: () => void; onDone: (code: string) => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const options = useMemo(
    () =>
      KNOWN_CURRENCIES.filter((c) => c !== base && !enabled.includes(c))
        .map((c) => ({ value: c, label: `${c} · ${nameOf(c)}` }))
        .sort((a, b) => a.value.localeCompare(b.value)),
    [base, enabled, nameOf],
  );
  const [code, setCode] = useState(options.find((o) => o.value === 'USD')?.value ?? options[0]?.value ?? '');
  const add = useMutation({
    mutationFn: () => api.add(code),
    onSuccess: () => {
      toast(t('currencies.added', { code }));
      onDone(code);
    },
    onError: (e) => toast(currencyErrorMessage(e, t), 'error'),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={t('currencies.addTitle')}
      description={t('currencies.addBody', { base })}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => add.mutate()} loading={add.isPending} disabled={!code}>
            {t('currencies.add')}
          </Button>
        </>
      }
    >
      <SelectField label={t('currencies.fields.currency')} value={code} onChange={(e) => setCode(e.target.value)} options={options} data-autofocus />
    </Modal>
  );
}
