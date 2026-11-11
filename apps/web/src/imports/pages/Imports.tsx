import { useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Building2, CheckCircle2, Download, FileUp, Upload } from 'lucide-react';
import clsx from 'clsx';
import { csvCell, guessImportMapping, IMPORT_FIELDS, IMPORT_KINDS, IMPORT_PERMISSIONS, mapImportRows, MAX_IMPORT_ROWS, todayIn, type ImportKind } from '@ledgernest/shared';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../../auth/client';
import { Link } from 'react-router';
import { readSpreadsheet } from '../../lib/readSheet';
import { useMoney } from '../../lib/useMoney';
import { useSession } from '../../layout/session';
import { fadeUp, stagger } from '../../motion/tokens';
import { useOrganizationSettings } from '../../settings/useOrganizationSettings';
import Button from '../../ui/Button';
import { SelectField, TextField } from '../../ui/Field';
import { Card, EmptyState, PageHeader, Segmented } from '../../ui/Kit';
import { useToast } from '../../ui/toastContext';
import type { ImportResult } from '../types';
import { useImportsApi } from '../useImportsApi';
import TallyImportCard from '../TallyImportCard';

const MAX_FILE_BYTES = 5_000_000;

/** Bringing existing books in from a spreadsheet: choose what, pick the file, match its columns, check, import. */
export default function Imports() {
  const { t } = useTranslation();
  const session = useSession();
  const toast = useToast();
  const qc = useQueryClient();
  const money = useMoney();
  const api = useImportsApi();
  const settings = useOrganizationSettings().data;
  const kinds = IMPORT_KINDS.filter((k) => session.permissions.has(IMPORT_PERMISSIONS[k]));
  const [kind, setKind] = useState<ImportKind>(kinds[0] ?? 'contacts');
  // Kinds that are as of the day the books start
  const dated = kind === 'opening_balances' || kind === 'opening_invoices' || kind === 'opening_bills';
  const importError = (e: unknown) => {
    const reason = e instanceof ApiError ? e.details?.reason : undefined;
    return typeof reason === 'string' && ['demo_opening', 'no_period', 'no_receivable_account', 'no_payable_account'].includes(reason) ? t(`imports.errors.${reason}`) : t('imports.failed');
  };
  const [file, setFile] = useState<{ name: string; headers: string[]; rows: string[][] } | null>(null);
  const [mapping, setMapping] = useState<Record<string, number | null>>({});
  const [date, setDate] = useState(() => todayIn(settings?.timeZone ?? 'Asia/Kolkata'));
  const [checked, setChecked] = useState<{ result: ImportResult; key: string } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const fields = IMPORT_FIELDS[kind];
  const rows = useMemo(() => (file ? mapImportRows(file.rows, mapping) : []), [file, mapping]);
  const stateKey = JSON.stringify([kind, mapping, file?.name, rows.length, date]);
  const missing = fields.filter((f) => f.required && (mapping[f.key] ?? null) === null);
  const label = (key: string) => t(`imports.fields.${key}`);

  const choose = (k: ImportKind) => {
    setKind(k);
    setChecked(null);
    if (file) setMapping(guessImportMapping(file.headers, k));
  };
  const load = async (f: File) => {
    if (f.size > MAX_FILE_BYTES) return toast(t('imports.tooLarge'), 'error');
    try {
      const [headers = [], ...body] = await readSpreadsheet(f);
      if (!body.length) return toast(t('imports.empty'), 'error');
      if (body.length > MAX_IMPORT_ROWS) return toast(t('imports.tooMany', { max: MAX_IMPORT_ROWS }), 'error');
      setFile({ name: f.name, headers: headers.map((h) => h.trim()), rows: body });
      setMapping(guessImportMapping(headers, kind));
      setChecked(null);
    } catch {
      toast(t('imports.unreadable'), 'error');
    }
  };
  const template = () => {
    const csv = `﻿${fields.map((f) => csvCell(label(f.key))).join(',')}\r\n`;
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: `${kind}-template.csv` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const preview = useMutation({
    mutationFn: () => api!.preview(kind, rows, dated ? date : undefined),
    onSuccess: (result) => setChecked({ result, key: stateKey }),
    onError: (e) => toast(importError(e), 'error'),
  });
  const run = useMutation({
    mutationFn: () => api!.run(kind, rows, dated ? date : undefined),
    onSuccess: (result) => {
      setChecked({ result, key: stateKey });
      if (!result.saved) return toast(t('imports.notSaved'), 'error');
      for (const k of ['accounts', 'contacts', 'items', 'journals']) void qc.invalidateQueries({ queryKey: [k] });
      toast(t(kind === 'opening_balances' ? 'imports.openingDone' : 'imports.done', { count: result.rows }));
      setFile(null);
    },
    onError: (e) => toast(importError(e), 'error'),
  });

  if (!api || !kinds.length) {
    return (
      <Card>
        <EmptyState icon={<Building2 className="size-5" />} title={api ? t('imports.noPermission') : t('team.noOrganization')} body={api ? undefined : t('team.noOrganizationBody')} />
      </Card>
    );
  }
  const result = checked?.key === stateKey ? checked.result : null;
  const ready = !!result && result.valid === result.rows && !result.saved;
  const problems = result?.results.filter((r) => !r.ok) ?? [];
  return (
    <motion.div variants={stagger(0.06)} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={fadeUp}>
        <PageHeader eyebrow={<span dir="auto">{session.organization}</span>} title={t('imports.title')} description={t('imports.description')} />
      </motion.div>
      {(['accounts', 'contacts', 'opening_balances'] as const).every((k) => kinds.includes(k)) && (
        <motion.div variants={fadeUp}>
          <TallyImportCard api={api} />
        </motion.div>
      )}
      <motion.div variants={fadeUp}>
        <Card className="space-y-4 p-5">
          <Segmented<ImportKind> label={t('imports.what')} value={kind} onChange={choose} options={kinds.map((k) => ({ value: k, label: t(`imports.kinds.${k}`) }))} />
          <p className="text-sm text-ink-600 dark:text-ink-300">{t(`imports.about.${kind}`)}</p>
          <div className="flex flex-wrap items-center gap-3">
            <input ref={input} type="file" accept=".csv,.txt,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" tabIndex={-1} aria-hidden data-testid="import-file" onChange={(e) => e.target.files?.[0] && void load(e.target.files[0]).finally(() => (e.target.value = ''))} />
            <Button icon={<FileUp className="size-4" />} onClick={() => input.current?.click()}>
              {t('imports.chooseFile')}
            </Button>
            <Button variant="ghost" icon={<Download className="size-4" />} onClick={template}>
              {t('imports.template')}
            </Button>
            {file && (
              <span className="text-sm text-ink-500" dir="auto">
                {t('imports.fileRows', { name: file.name, count: rows.length })}
              </span>
            )}
          </div>
        </Card>
      </motion.div>

      {file && (
        <motion.div variants={fadeUp} initial="hidden" animate="show">
          <Card className="overflow-hidden">
            <div className="border-b border-ink-100 px-5 py-3 dark:border-ink-800">
              <h2 className="font-semibold">{t('imports.matchTitle')}</h2>
              <p className="text-sm text-ink-500">{t('imports.matchBody')}</p>
            </div>
            <div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-3">
              {dated && <TextField label={t('imports.asOf')} type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />}
              {fields.map((f) => (
                <SelectField
                  key={f.key}
                  label={`${label(f.key)}${f.required ? ' *' : ''}`}
                  value={mapping[f.key] === null || mapping[f.key] === undefined ? '' : String(mapping[f.key])}
                  onChange={(e) => setMapping((m) => ({ ...m, [f.key]: e.target.value === '' ? null : Number(e.target.value) }))}
                  error={f.required && (mapping[f.key] ?? null) === null ? t('imports.required') : undefined}
                  options={[{ value: '', label: t('imports.notInFile') }, ...file.headers.map((h, i) => ({ value: String(i), label: h || t('imports.column', { n: i + 1 }) }))]}
                />
              ))}
            </div>
            <div className="overflow-x-auto border-t border-ink-100 dark:border-ink-800">
              <table className="w-full text-sm">
                <caption className="sr-only">{t('imports.sample')}</caption>
                <thead className="text-xs uppercase tracking-wide text-ink-400">
                  <tr>
                    <th scope="col" className="px-4 py-2 text-start font-semibold">
                      #
                    </th>
                    {fields
                      .filter((f) => (mapping[f.key] ?? null) !== null)
                      .map((f) => (
                        <th key={f.key} scope="col" className="px-4 py-2 text-start font-semibold whitespace-nowrap">
                          {label(f.key)}
                        </th>
                      ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
                  {rows.slice(0, 5).map((r, n) => (
                    <tr key={n}>
                      <td className="px-4 py-1.5 text-ink-400">{n + 1}</td>
                      {fields
                        .filter((f) => (mapping[f.key] ?? null) !== null)
                        .map((f) => (
                          <td key={f.key} className="max-w-48 truncate px-4 py-1.5" dir="auto">
                            {r[f.key]}
                          </td>
                        ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center gap-3 border-t border-ink-100 px-5 py-3 dark:border-ink-800">
              <Button variant="secondary" loading={preview.isPending} disabled={!!missing.length} onClick={() => preview.mutate()}>
                {t('imports.check', { count: rows.length })}
              </Button>
              <Button icon={<Upload className="size-4" />} loading={run.isPending} disabled={!ready} onClick={() => run.mutate()}>
                {t('imports.run', { count: rows.length })}
              </Button>
              {!result && <span className="text-sm text-ink-500">{t('imports.checkFirst')}</span>}
            </div>
          </Card>
        </motion.div>
      )}

      {result && (
        <motion.div variants={fadeUp} initial="hidden" animate="show">
          <Card className="p-5">
            <p role="status" className={clsx('flex items-center gap-2 font-medium', problems.length ? 'text-expense' : 'text-income')}>
              {problems.length ? <AlertTriangle className="size-4" aria-hidden /> : <CheckCircle2 className="size-4" aria-hidden />}
              {result.saved ? t('imports.saved', { count: result.rows }) : problems.length ? t('imports.someWrong', { bad: problems.length, count: result.rows }) : t('imports.allRight', { count: result.rows })}
            </p>
            {result.summary && 'debit' in result.summary && (
              <p className="mt-2 text-sm text-ink-600 dark:text-ink-300">
                {t('imports.openingTotals', { debit: money.format(result.summary.debit), credit: money.format(result.summary.credit) })} {result.summary.difference !== 0 && t('imports.openingDifference', { amount: money.format(Math.abs(result.summary.difference)) })}
              </p>
            )}
            {result.summary && 'count' in result.summary && (
              <p className="mt-2 text-sm text-ink-600 dark:text-ink-300">{t(`imports.owedTotal.${kind}`, { count: result.summary.count, amount: money.format(result.summary.total) })}</p>
            )}
            {result.saved && result.journalEntry && (
              <Link to={`/journals/${result.journalEntry.id}`} className="mt-2 inline-block text-sm font-medium text-brand-700 hover:underline dark:text-brand-300">
                {t('imports.openDraft')}
              </Link>
            )}
            {problems.length > 0 && (
              <ul className="mt-3 divide-y divide-ink-100 rounded-xl border border-ink-100 text-sm dark:divide-ink-800 dark:border-ink-800">
                {problems.slice(0, 100).map((r) => (
                  <li key={r.row} className="flex gap-3 px-3 py-2">
                    <span className="w-16 shrink-0 font-mono text-xs text-ink-500">{t('imports.row', { n: r.row })}</span>
                    <span className="min-w-0 flex-1">
                      {r.errors.map((e, i) => (
                        <span key={i} className="block" dir="auto">
                          {e.field && IMPORT_FIELDS[kind].some((f) => f.key === e.field) && <span className="font-medium">{label(e.field)}: </span>}
                          {e.message}
                        </span>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </motion.div>
      )}
    </motion.div>
  );
}
