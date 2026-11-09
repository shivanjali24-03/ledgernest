import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { currencyDigits, DATE_FORMATS, type StatementMapping } from '@ledgernest/shared';
import { FileUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../auth/client';
import { useIntlLocale } from '../i18n';
import { formatDate } from '../lib/format';
import { useOrganizationSettings } from '../settings/useOrganizationSettings';
import Button from '../ui/Button';
import { SelectField, TextField } from '../ui/Field';
import Modal from '../ui/Modal';
import { useToast } from '../ui/toastContext';
import { bankingErrorMessage } from './errors';
import type { BankAccount, BankingApi, StatementPreview } from './types';

type Roles = 'date' | 'description' | 'reference' | 'amount' | 'moneyIn' | 'moneyOut' | 'balance';
const MAX_BYTES = 2_000_000;

/**
 * Bring in the bank's statement: choose the file, see what it holds (what's new, what's already here, which rows
 * can't be read), correct a CSV's columns if they were guessed wrong, then import.
 */
export default function ImportStatementDialog({ api, account, onClose }: { api: BankingApi; account: BankAccount; onClose: () => void }) {
  const { t } = useTranslation();
  const locale = useIntlLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const settings = useOrganizationSettings().data;
  const code = account.currency ?? settings?.baseCurrency ?? 'INR';
  const digits = currencyDigits(code);
  const plain = (minor: number) => new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(minor / 10 ** digits);
  const [file, setFile] = useState<{ name: string; content: string } | null>(null);
  const [mapping, setMapping] = useState<StatementMapping | null>(null);
  const [preview, setPreview] = useState<StatementPreview | null>(null);
  const [columns, setColumns] = useState<string[]>([]);
  const [unknown, setUnknown] = useState(false);

  const look = useMutation({
    mutationFn: (v: { name: string; content: string; mapping: StatementMapping | null }) => api.previewStatement({ bankAccountId: account.id, fileName: v.name, content: v.content, mapping: v.mapping }),
    onSuccess: (p) => {
      setPreview(p);
      setUnknown(false);
      if (p.mapping) {
        setMapping(p.mapping);
        setColumns(p.headers);
      }
    },
    onError: (e) => {
      const d = e instanceof ApiError ? (e.details as { reason?: string; rows?: string[][] } | undefined) : undefined;
      if (d?.reason === 'layout_unknown') {
        // Start from the first row as the header, and let the columns be chosen
        const first = d.rows?.[0] ?? [];
        setColumns(first);
        setMapping({ headerRows: 1, delimiter: ',', date: 0, description: Math.min(1, first.length - 1), reference: null, amount: Math.min(2, first.length - 1), moneyIn: null, moneyOut: null, balance: null, dateFormat: 'DMY', decimal: '.' });
        setUnknown(true);
        setPreview(null);
      } else toast(bankingErrorMessage(e, t), 'error');
    },
  });
  const save = useMutation({
    mutationFn: () => api.importStatement({ bankAccountId: account.id, fileName: file!.name, content: file!.content, mapping: preview?.format === 'csv' ? mapping : null }),
    onSuccess: (r) => {
      for (const k of ['banking']) void queryClient.invalidateQueries({ queryKey: [k] });
      toast(t('banking.import.done', { added: r.added, duplicates: r.duplicates }));
      onClose();
    },
    onError: (e) => toast(bankingErrorMessage(e, t), 'error'),
  });

  const choose = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > MAX_BYTES) return toast(t('banking.import.tooBig'), 'error');
    const content = await f.text();
    setFile({ name: f.name, content });
    setMapping(null);
    look.mutate({ name: f.name, content, mapping: null });
  };
  const remap = (patch: Partial<StatementMapping>) => {
    const next = { ...mapping!, ...patch };
    setMapping(next);
    look.mutate({ name: file!.name, content: file!.content, mapping: next });
  };
  const fresh = preview ? preview.total - preview.duplicates : 0;
  const options = (optional: boolean) => [...(optional ? [{ value: '', label: t('banking.import.none') }] : []), ...columns.map((c, i) => ({ value: String(i), label: `${i + 1} · ${c || '—'}` }))];
  const pick = (role: Roles, optional = false) => (
    <SelectField label={t(`banking.import.roles.${role}`)} value={mapping?.[role] === null || mapping?.[role] === undefined ? '' : String(mapping[role])} onChange={(e) => remap({ [role]: e.target.value === '' ? null : Number(e.target.value) })} options={options(optional)} />
  );
  const split = mapping?.amount === null;

  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title={t('banking.import.title', { name: account.name })}
      description={t('banking.import.body')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!preview || !fresh || look.isPending}>
            {preview ? t('banking.import.importN', { count: fresh }) : t('banking.import.import')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-ink-300 p-4 text-sm hover:border-brand-400 dark:border-ink-700">
          <FileUp className="size-5 text-ink-400" aria-hidden />
          <span className="flex-1">{file ? file.name : t('banking.import.choose')}</span>
          <input type="file" accept=".csv,.txt,.ofx,.qfx,text/csv" className="sr-only" aria-label={t('banking.import.file')} onChange={(e) => void choose(e.target.files?.[0])} />
        </label>

        {unknown && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">{t('banking.import.unknownLayout')}</p>}

        {mapping && (preview?.format === 'csv' || unknown) && (
          <fieldset className="space-y-3 rounded-xl border border-ink-200 p-4 dark:border-ink-800">
            <legend className="px-1 text-sm font-semibold">{t('banking.import.layout')}</legend>
            <div className="grid gap-3 sm:grid-cols-3">
              {pick('date')}
              {pick('description')}
              {pick('reference', true)}
              <SelectField
                label={t('banking.import.amounts')}
                value={split ? 'split' : 'single'}
                onChange={(e) => remap(e.target.value === 'split' ? { amount: null, moneyIn: mapping.moneyIn ?? 0, moneyOut: mapping.moneyOut ?? 0 } : { amount: mapping.amount ?? 0, moneyIn: null, moneyOut: null })}
                options={[
                  { value: 'single', label: t('banking.import.single') },
                  { value: 'split', label: t('banking.import.split') },
                ]}
              />
              {split ? (
                <>
                  {pick('moneyIn')}
                  {pick('moneyOut')}
                </>
              ) : (
                pick('amount')
              )}
              {pick('balance', true)}
              <SelectField label={t('banking.import.dateFormat')} value={mapping.dateFormat} onChange={(e) => remap({ dateFormat: e.target.value as StatementMapping['dateFormat'] })} options={DATE_FORMATS.map((f) => ({ value: f, label: t(`banking.import.dateFormats.${f}`) }))} />
              <SelectField label={t('banking.import.decimal')} value={mapping.decimal} onChange={(e) => remap({ decimal: e.target.value as '.' | ',' })} options={[{ value: '.', label: '1,234.56' }, { value: ',', label: '1.234,56' }]} />
              <TextField label={t('banking.import.headerRows')} value={String(mapping.headerRows)} inputMode="numeric" onChange={(e) => Number.isInteger(Number(e.target.value)) && e.target.value !== '' && remap({ headerRows: Number(e.target.value) })} />
            </div>
          </fieldset>
        )}

        {preview && (
          <>
            <p role="status" className="text-sm">
              {t('banking.import.summary', { count: preview.total, fresh, duplicates: preview.duplicates })}
              {preview.firstDate && preview.lastDate && ` · ${formatDate(`${preview.firstDate}T00:00:00Z`, locale)} – ${formatDate(`${preview.lastDate}T00:00:00Z`, locale)}`}
              {fresh > 0 && ` · ${t('banking.import.inOut', { moneyIn: `${code} ${plain(preview.moneyIn)}`, moneyOut: `${code} ${plain(preview.moneyOut)}` })}`}
            </p>
            {preview.issues.length > 0 && (
              <div className="rounded-lg bg-expense/5 p-3 text-sm">
                <p className="font-medium text-expense">{t('banking.import.issues', { count: preview.issues.length })}</p>
                <ul className="mt-1 space-y-0.5 text-ink-600 dark:text-ink-300">
                  {preview.issues.slice(0, 5).map((i) => (
                    <li key={i.row}>{t(`banking.import.problems.${i.problem}`, { row: i.row, text: i.text })}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="max-h-64 overflow-auto rounded-lg border border-ink-100 dark:border-ink-800">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-white text-xs uppercase tracking-wide text-ink-400 dark:bg-ink-900">
                  <tr>
                    <th scope="col" className="px-3 py-1.5 text-start font-semibold">
                      {t('banking.columns.date')}
                    </th>
                    <th scope="col" className="px-3 py-1.5 text-start font-semibold">
                      {t('banking.columns.what')}
                    </th>
                    <th scope="col" className="px-3 py-1.5 text-end font-semibold">
                      {t('banking.columns.amount', { currency: code })}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
                  {preview.lines.slice(0, 50).map((l) => (
                    <tr key={l.row} className={l.duplicate ? 'text-ink-400' : undefined}>
                      <td className="px-3 py-1.5 whitespace-nowrap">{formatDate(`${l.date}T00:00:00Z`, locale)}</td>
                      <td className="px-3 py-1.5" dir="auto">
                        {l.description}
                        {l.duplicate && <span className="ms-2 text-xs">{t('banking.import.already')}</span>}
                      </td>
                      <td className={`px-3 py-1.5 text-end font-mono tabular-nums ${l.amount > 0 && !l.duplicate ? 'text-income' : ''}`} dir="ltr">
                        {plain(l.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
