import { useState, type FormEvent } from 'react';
import { motion } from 'motion/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { INDIAN_STATES, todayIn, toMinor, type EmployeeInput } from '@ledgernest/shared';
import { Banknote, CheckCircle2, FileDown, Pencil, Play, Trash2, Undo2, UserPlus, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAccountsApi } from '../accounts/useAccountsApi';
import { ApiError } from '../auth/client';
import { useMoney } from '../lib/useMoney';
import { saveBlob } from '../lib/saveBlob';
import { useSession } from '../layout/session';
import { fadeUp, stagger } from '../motion/tokens';
import Button from '../ui/Button';
import { SelectField, TextField } from '../ui/Field';
import { Card, EmptyState, PageHeader, Pill, Segmented, SkeletonRows } from '../ui/Kit';
import Modal from '../ui/Modal';
import { useToast } from '../ui/toastContext';
import { useIntlLocale } from '../i18n';
import { usePayrollApi } from './api';
import type { Employee, PayRun, PayrollApi } from './types';

/** "October 2026" in the reader's language (the API's label is English) */
function useMonthLabel() {
  const locale = useIntlLocale();
  return (month: string) => new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}-01T00:00:00Z`));
}

const REASONS = ['code_taken', 'run_exists', 'no_employees', 'not_draft', 'not_posted', 'already_paid', 'bank_invalid', 'before_month'];
const useFail = () => {
  const { t } = useTranslation();
  const toast = useToast();
  return (e: unknown) => {
    const reason = e instanceof ApiError ? e.details?.reason : undefined;
    toast(typeof reason === 'string' && REASONS.includes(reason) ? t(`payroll.errors.${reason}`) : t('payroll.errors.failed'), 'error');
  };
};

/** Payroll: employees with their monthly salary, and each month's run of payslips, posted and paid */
export default function Payroll() {
  const { t } = useTranslation();
  const session = useSession();
  const api = usePayrollApi();
  const canManage = session.permissions.has('payroll.manage');
  const [tab, setTab] = useState<'runs' | 'employees'>('runs');
  const employees = useQuery({ queryKey: ['payroll', session.organizationId, 'employees'], queryFn: () => api!.employees(), enabled: !!api });
  const runs = useQuery({ queryKey: ['payroll', session.organizationId, 'runs'], queryFn: () => api!.runs(), enabled: !!api });
  const [editing, setEditing] = useState<Employee | true | null>(null);
  const [running, setRunning] = useState(false);
  if (!api) return null;
  const active = (employees.data?.employees ?? []).filter((e) => !e.archived);
  return (
    <motion.div variants={stagger(0.06)} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={fadeUp}>
        <PageHeader
          eyebrow={<span dir="auto">{session.organization}</span>}
          title={t('payroll.title')}
          description={t('payroll.description')}
          actions={
            canManage ? (
              <>
                <Button variant="secondary" icon={<UserPlus className="size-4" />} onClick={() => setEditing(true)}>
                  {t('payroll.addEmployee')}
                </Button>
                {active.length > 0 && (
                  <Button icon={<Play className="size-4" />} onClick={() => setRunning(true)}>
                    {t('payroll.runPayroll')}
                  </Button>
                )}
              </>
            ) : undefined
          }
        />
      </motion.div>
      <motion.div variants={fadeUp}>
        <Segmented<'runs' | 'employees'> label={t('payroll.view')} value={tab} onChange={setTab} options={[{ value: 'runs', label: t('payroll.tabs.runs') }, { value: 'employees', label: t('payroll.tabs.employees', { count: active.length }) }]} />
      </motion.div>
      <motion.div variants={fadeUp}>
        {tab === 'employees' ? (
          <Card className="overflow-x-auto p-0">
            {!employees.data ? (
              <SkeletonRows rows={4} />
            ) : !employees.data.employees.length ? (
              <EmptyState icon={<Users className="size-5" />} title={t('payroll.noEmployees')} body={t('payroll.noEmployeesBody')} />
            ) : (
              <EmployeesTable employees={employees.data.employees} canManage={canManage} onEdit={(e) => setEditing(e)} />
            )}
          </Card>
        ) : !runs.data ? (
          <Card>
            <SkeletonRows rows={4} />
          </Card>
        ) : !runs.data.runs.length ? (
          <Card>
            <EmptyState icon={<Banknote className="size-5" />} title={t('payroll.noRuns')} body={t(active.length ? 'payroll.noRunsBody' : 'payroll.addFirst')} />
          </Card>
        ) : (
          <div className="space-y-4">
            {runs.data.runs.map((r) => (
              <RunCard key={r.id} run={r} api={api} canManage={canManage} />
            ))}
          </div>
        )}
      </motion.div>
      {editing && <EmployeeDialog api={api} employee={editing === true ? null : editing} onClose={() => setEditing(null)} />}
      {running && <RunDialog api={api} employees={active} onClose={() => setRunning(false)} />}
    </motion.div>
  );
}

function EmployeesTable({ employees, canManage, onEdit }: { employees: Employee[]; canManage: boolean; onEdit: (e: Employee) => void }) {
  const { t } = useTranslation();
  const money = useMoney();
  return (
    <table className="stack-sm w-full min-w-[640px] text-sm" aria-label={t('payroll.tabs.employees', { count: employees.length })}>
      <thead className="border-b border-ink-100 text-xs uppercase tracking-wide text-ink-400 dark:border-ink-800">
        <tr>
          <th className="px-4 py-2.5 text-start font-semibold">{t('payroll.columns.employee')}</th>
          <th className="px-4 py-2.5 text-start font-semibold">{t('payroll.columns.joined')}</th>
          <th className="px-4 py-2.5 text-end font-semibold">{t('payroll.columns.monthly')}</th>
          <th className="w-12" />
        </tr>
      </thead>
      <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
        {employees.map((e) => (
          <tr key={e.id} className={e.archived ? 'text-ink-400' : undefined}>
            <td className="px-4 py-2.5">
              <span className="font-medium" dir="auto">
                {e.name}
              </span>{' '}
              <span className="whitespace-nowrap font-mono text-xs text-ink-500">{e.code}</span>
              {e.designation && <span className="block text-xs text-ink-500">{e.designation}</span>}
            </td>
            <td className="px-4 py-2.5 text-ink-600 dark:text-ink-300" data-label={t('payroll.columns.joined')}>{e.dateOfJoining}</td>
            <td className="px-4 py-2.5 text-end font-mono font-semibold tabular-nums sm:font-normal" dir="ltr" data-end>
              {money.format(e.gross)}
            </td>
            <td className="px-2 text-end" data-end>
              {canManage && !e.archived && <Button size="sm" variant="ghost" icon={<Pencil className="size-4" />} aria-label={t('payroll.edit', { name: e.name })} onClick={() => onEdit(e)} />}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function RunCard({ run, api, canManage }: { run: PayRun; api: PayrollApi; canManage: boolean }) {
  const { t } = useTranslation();
  const monthOf = useMonthLabel();
  const money = useMoney();
  const toast = useToast();
  const fail = useFail();
  const queryClient = useQueryClient();
  const [paying, setPaying] = useState(false);
  const done = (message: string) => () => {
    for (const k of ['payroll', 'journals', 'reports']) void queryClient.invalidateQueries({ queryKey: [k] });
    toast(message);
  };
  const post = useMutation({ mutationFn: () => api.post(run.id), onSuccess: done(t('payroll.posted', { month: monthOf(run.month) })), onError: fail });
  const unpost = useMutation({ mutationFn: () => api.unpost(run.id), onSuccess: done(t('payroll.unposted', { month: monthOf(run.month) })), onError: fail });
  const remove = useMutation({ mutationFn: () => api.removeRun(run.id), onSuccess: done(t('payroll.deleted', { month: monthOf(run.month) })), onError: fail });
  const slip = useMutation({ mutationFn: (id: string) => api.payslipPdf(id), onSuccess: (f) => saveBlob(f), onError: fail });
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-ink-100 px-5 py-3 dark:border-ink-800">
        <h2 className="flex-1 font-semibold">{t('payroll.runTitle', { month: monthOf(run.month) })}</h2>
        <Pill tone={run.status === 'draft' ? 'neutral' : 'brand'}>{t(`payroll.statuses.${run.status}`)}</Pill>
        {canManage && run.status === 'draft' && (
          <>
            <Button size="sm" icon={<CheckCircle2 className="size-4" />} loading={post.isPending} onClick={() => post.mutate()}>
              {t('payroll.post')}
            </Button>
            <Button size="sm" variant="ghost" icon={<Trash2 className="size-4" />} loading={remove.isPending} onClick={() => remove.mutate()}>
              {t('payroll.delete')}
            </Button>
          </>
        )}
        {canManage && run.status === 'posted' && (
          <>
            <Button size="sm" icon={<Banknote className="size-4" />} onClick={() => setPaying(true)}>
              {t('payroll.pay')}
            </Button>
            <Button size="sm" variant="ghost" icon={<Undo2 className="size-4" />} loading={unpost.isPending} onClick={() => unpost.mutate()}>
              {t('payroll.unpost')}
            </Button>
          </>
        )}
      </div>
      <div className="relative overflow-x-auto">
        <table className="stack-sm w-full min-w-[640px] text-sm" aria-label={t('payroll.payslipsOf', { month: monthOf(run.month) })}>
          <thead className="text-xs uppercase tracking-wide text-ink-400">
            <tr>
              <th className="px-4 py-2 text-start font-semibold">{t('payroll.columns.employee')}</th>
              <th className="px-4 py-2 text-end font-semibold">{t('payroll.columns.days')}</th>
              <th className="px-4 py-2 text-end font-semibold">{t('payroll.columns.gross')}</th>
              <th className="px-4 py-2 text-end font-semibold">{t('payroll.columns.deductions')}</th>
              <th className="px-4 py-2 text-end font-semibold">{t('payroll.columns.net')}</th>
              <th className="w-12" />
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
            {run.payslips.map((p) => (
              <tr key={p.id}>
                <td className="px-4 py-2" dir="auto">
                  {p.employee.name} <span className="whitespace-nowrap font-mono text-xs text-ink-500">{p.employee.code}</span>
                  <span className="block text-xs text-ink-500">{p.deductions.map((d) => `${t(`payroll.lines.${d.code}`, { defaultValue: d.label })} ${money.plain(d.amount)}`).join(' · ')}</span>
                </td>
                <td className="px-4 py-2 text-end font-mono max-sm:text-start" dir="ltr" data-label={t('payroll.columns.days')}>
                  {p.daysPaid}/{p.daysInMonth}
                </td>
                <td className="px-4 py-2 text-end font-mono tabular-nums max-sm:text-xs" dir="ltr" data-end data-label={t('payroll.columns.gross')}>
                  {money.plain(p.gross)}
                </td>
                <td className="px-4 py-2 text-end font-mono tabular-nums max-sm:text-xs" dir="ltr" data-end data-label={t('payroll.columns.deductions')}>
                  {money.plain(p.totalDeductions)}
                </td>
                <td className="px-4 py-2 text-end font-mono font-semibold tabular-nums" dir="ltr" data-end data-label={t('payroll.columns.net')}>
                  {money.plain(p.net)}
                </td>
                <td className="px-2 text-end" data-end>
                  <Button size="sm" variant="ghost" icon={<FileDown className="size-4" />} aria-label={t('payroll.payslipFor', { name: p.employee.name })} onClick={() => slip.mutate(p.id)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dl className="grid gap-x-6 gap-y-1 border-t border-ink-100 px-5 py-3 text-sm sm:grid-cols-3 dark:border-ink-800" aria-label={t('payroll.totals')}>
        {(
          [
            ['gross', run.gross],
            ['net', run.net],
            ['employerCost', run.employerCost],
            ['pf', run.dues.pf],
            ['esi', run.dues.esi],
            ['pt', run.dues.pt],
            ['tds', run.dues.tds],
          ] as const
        ).map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3">
            <dt className="text-ink-500">{t(`payroll.dues.${k}`)}</dt>
            <dd className="font-mono tabular-nums" dir="ltr">
              {money.format(v)}
            </dd>
          </div>
        ))}
      </dl>
      {paying && <PayDialog api={api} run={run} onClose={() => setPaying(false)} />}
    </Card>
  );
}

function PayDialog({ api, run, onClose }: { api: PayrollApi; run: PayRun; onClose: () => void }) {
  const { t } = useTranslation();
  const monthOf = useMonthLabel();
  const money = useMoney();
  const toast = useToast();
  const fail = useFail();
  const session = useSession();
  const queryClient = useQueryClient();
  const accountsApi = useAccountsApi();
  const accounts = useQuery({ queryKey: ['accounts', session.organizationId, session.role ?? session.customRoleName, 'all'], queryFn: () => accountsApi!.list(true), enabled: !!accountsApi });
  const banks = (accounts.data ?? []).filter((a) => a.type === 'asset' && (a.subtype === 'bank' || a.subtype === 'cash') && !a.archived && !a.currency);
  const [bankAccountId, setBank] = useState('');
  const [date, setDate] = useState(() => todayIn('Asia/Kolkata'));
  const bank = bankAccountId || banks[0]?.id || '';
  const pay = useMutation({
    mutationFn: () => api.pay(run.id, { date, bankAccountId: bank }),
    onSuccess: () => {
      for (const k of ['payroll', 'journals', 'reports', 'banking']) void queryClient.invalidateQueries({ queryKey: [k] });
      toast(t('payroll.paid', { month: monthOf(run.month) }));
      onClose();
    },
    onError: fail,
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={t('payroll.payTitle', { month: monthOf(run.month) })}
      description={t('payroll.payBody', { amount: money.format(run.net) })}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="pay-run-form" loading={pay.isPending} disabled={!bank}>
            {t('payroll.pay')}
          </Button>
        </>
      }
    >
      <form id="pay-run-form" onSubmit={(e: FormEvent) => (e.preventDefault(), pay.mutate())} noValidate className="grid gap-3 sm:grid-cols-2">
        <TextField label={t('payroll.fields.paidOn')} type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
        <SelectField label={t('payroll.fields.bank')} value={bank} onChange={(e) => setBank(e.target.value)} options={banks.map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` }))} />
      </form>
    </Modal>
  );
}

function RunDialog({ api, employees, onClose }: { api: PayrollApi; employees: Employee[]; onClose: () => void }) {
  const { t } = useTranslation();
  const monthOf = useMonthLabel();
  const toast = useToast();
  const fail = useFail();
  const queryClient = useQueryClient();
  const [month, setMonth] = useState(() => todayIn('Asia/Kolkata').slice(0, 7));
  const [lop, setLop] = useState<Record<string, string>>({});
  const run = useMutation({
    mutationFn: () => api.createRun({ month, lossOfPay: Object.entries(lop).filter(([, v]) => Number(v) > 0).map(([employeeId, v]) => ({ employeeId, days: Number(v) })) }),
    onSuccess: (r) => {
      void queryClient.invalidateQueries({ queryKey: ['payroll'] });
      toast(t('payroll.ran', { month: monthOf(r.month) }));
      onClose();
    },
    onError: fail,
  });
  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title={t('payroll.runTitleNew')}
      description={t('payroll.runBody')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="pay-run-new" loading={run.isPending} disabled={!/^\d{4}-\d{2}$/.test(month)}>
            {t('payroll.runPayroll')}
          </Button>
        </>
      }
    >
      <form id="pay-run-new" onSubmit={(e: FormEvent) => (e.preventDefault(), run.mutate())} noValidate className="space-y-3">
        <div className="w-48">
          <TextField label={t('payroll.fields.month')} type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        </div>
        <p className="text-sm font-medium">{t('payroll.lopTitle')}</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {employees.map((e) => (
            <TextField key={e.id} label={t('payroll.lopFor', { name: e.name })} value={lop[e.id] ?? ''} onChange={(ev) => setLop((l) => ({ ...l, [e.id]: ev.target.value }))} inputMode="decimal" placeholder="0" dir="ltr" className="text-end" />
          ))}
        </div>
      </form>
    </Modal>
  );
}

const rupees = (minor: number) => (minor ? (minor / 100).toFixed(2) : '');

function EmployeeDialog({ api, employee, onClose }: { api: PayrollApi; employee: Employee | null; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const fail = useFail();
  const queryClient = useQueryClient();
  const e = employee;
  const [f, setF] = useState({
    code: e?.code ?? '',
    name: e?.name ?? '',
    designation: e?.designation ?? '',
    dateOfJoining: e?.dateOfJoining ?? todayIn('Asia/Kolkata'),
    gender: e?.gender ?? '',
    stateCode: e?.stateCode ?? '27',
    pan: e?.pan ?? '',
    uan: e?.uan ?? '',
    basic: rupees(e?.basic ?? 0),
    hra: rupees(e?.hra ?? 0),
    specialAllowance: rupees(e?.specialAllowance ?? 0),
    otherAllowance: rupees(e?.otherAllowance ?? 0),
    taxRegime: e?.taxRegime ?? 'new',
    pf: e?.pf ?? true,
    esi: e?.esi ?? true,
    pt: e?.pt ?? true,
  });
  const set = (k: keyof typeof f) => (v: string | boolean) => setF((x) => ({ ...x, [k]: v }));
  const money = (v: string) => toMinor(v.replace(/,/g, ''), 2) ?? 0;
  const save = useMutation({
    mutationFn: () => {
      const input: EmployeeInput = {
        code: f.code,
        name: f.name,
        designation: f.designation || null,
        dateOfJoining: f.dateOfJoining,
        gender: (f.gender || null) as EmployeeInput['gender'],
        stateCode: f.stateCode || null,
        pan: f.pan || null,
        uan: f.uan || null,
        basic: money(f.basic),
        hra: money(f.hra),
        specialAllowance: money(f.specialAllowance),
        otherAllowance: money(f.otherAllowance),
        taxRegime: f.taxRegime as EmployeeInput['taxRegime'],
        pf: f.pf,
        esi: f.esi,
        pt: f.pt,
      };
      return e ? api.updateEmployee(e.id, input) : api.createEmployee(input);
    },
    onSuccess: (x) => {
      void queryClient.invalidateQueries({ queryKey: ['payroll'] });
      toast(t('payroll.saved', { name: x.name }));
      onClose();
    },
    onError: fail,
  });
  const ready = f.code.trim() && f.name.trim() && money(f.basic) > 0;
  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title={e ? t('payroll.editTitle', { name: e.name }) : t('payroll.newEmployee')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="employee-form" loading={save.isPending} disabled={!ready}>
            {t('payroll.saveEmployee')}
          </Button>
        </>
      }
    >
      <form id="employee-form" onSubmit={(ev: FormEvent) => (ev.preventDefault(), ready && save.mutate())} noValidate className="grid gap-3 sm:grid-cols-2">
        <TextField label={t('payroll.fields.code')} value={f.code} onChange={(ev) => set('code')(ev.target.value)} placeholder="E-001" dir="ltr" data-autofocus />
        <TextField label={t('payroll.fields.name')} value={f.name} onChange={(ev) => set('name')(ev.target.value)} dir="auto" />
        <TextField label={t('payroll.fields.designation')} value={f.designation} onChange={(ev) => set('designation')(ev.target.value)} dir="auto" />
        <TextField label={t('payroll.fields.dateOfJoining')} type="date" value={f.dateOfJoining} onChange={(ev) => set('dateOfJoining')(ev.target.value)} />
        <SelectField label={t('payroll.fields.state')} value={f.stateCode} onChange={(ev) => set('stateCode')(ev.target.value)} options={INDIAN_STATES.map((s) => ({ value: s.code, label: s.name }))} hint={t('payroll.fields.stateHint')} />
        <SelectField label={t('payroll.fields.gender')} value={f.gender} onChange={(ev) => set('gender')(ev.target.value)} options={[{ value: '', label: '—' }, ...(['male', 'female', 'other'] as const).map((g) => ({ value: g, label: t(`payroll.genders.${g}`) }))]} />
        <TextField label="PAN" value={f.pan} onChange={(ev) => set('pan')(ev.target.value.toUpperCase())} dir="ltr" className="font-mono uppercase" />
        <TextField label="UAN" value={f.uan} onChange={(ev) => set('uan')(ev.target.value)} inputMode="numeric" dir="ltr" className="font-mono" />
        {(['basic', 'hra', 'specialAllowance', 'otherAllowance'] as const).map((k) => (
          <TextField key={k} label={t(`payroll.fields.${k}`)} value={f[k]} onChange={(ev) => set(k)(ev.target.value)} inputMode="decimal" dir="ltr" className="text-end font-mono" />
        ))}
        <SelectField label={t('payroll.fields.taxRegime')} value={f.taxRegime} onChange={(ev) => set('taxRegime')(ev.target.value)} options={[{ value: 'new', label: t('payroll.regimes.new') }, { value: 'old', label: t('payroll.regimes.old') }]} />
        <fieldset className="flex flex-wrap items-center gap-4 text-sm sm:col-span-2">
          {(['pf', 'esi', 'pt'] as const).map((k) => (
            <label key={k} className="flex items-center gap-2">
              <input type="checkbox" checked={f[k]} onChange={(ev) => set(k)(ev.target.checked)} className="size-4 rounded accent-brand-600" />
              {t(`payroll.fields.${k}`)}
            </label>
          ))}
        </fieldset>
      </form>
    </Modal>
  );
}

