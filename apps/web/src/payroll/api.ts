import { computePayslip, employeeSchema, monthEnd, monthLabel, payRunSchema, pdfTableBytes, type PayslipLine } from '@ledgernest/shared';
import { useContext, useMemo } from 'react';
import { ApiError, type AuthClient } from '../auth/client';
import { ApiClientContext } from '../auth/apiClientContext';
import { useSession } from '../layout/session';
import type { Employee, PayRun, PayrollApi } from './types';

export function createLivePayrollApi(client: AuthClient, organizationId: string): PayrollApi {
  const r = <T>(path: string, init: RequestInit & { json?: unknown } = {}) => client.request<T>(`/payroll${path}`, { ...init, headers: { 'X-Organization-Id': organizationId } });
  return {
    employees: () => r('/employees'),
    createEmployee: (input) => r('/employees', { method: 'POST', json: input }),
    updateEmployee: (id, input) => r(`/employees/${id}`, { method: 'PUT', json: input }),
    archiveEmployee: (id) => r(`/employees/${id}/archive`, { method: 'POST' }),
    runs: () => r('/runs'),
    createRun: (input) => r('/runs', { method: 'POST', json: input }),
    removeRun: (id) => r(`/runs/${id}`, { method: 'DELETE' }),
    post: (id) => r(`/runs/${id}/post`, { method: 'POST' }),
    unpost: (id) => r(`/runs/${id}/unpost`, { method: 'POST' }),
    pay: (id, input) => r(`/runs/${id}/pay`, { method: 'POST', json: input }),
    payslipPdf: async (id) => {
      const { blob, filename } = await client.download(`/payroll/payslips/${id}/pdf`, { headers: { 'X-Organization-Id': organizationId } });
      return { blob, filename: filename ?? 'payslip.pdf' };
    },
  };
}

/** The demo company's payroll, kept in this browser: payslips worked out as the API does; nothing is posted */
const KEY = 'ledgernest.demo.payroll.v1';
type Store = { employees: Employee[]; runs: PayRun[] };
const load = (): Store => {
  try {
    return (JSON.parse(localStorage.getItem(KEY) ?? 'null') as Store | null) ?? { employees: [], runs: [] };
  } catch {
    return { employees: [], runs: [] };
  }
};
const save = (s: Store) => localStorage.setItem(KEY, JSON.stringify(s));
export const resetDemoPayroll = () => localStorage.removeItem(KEY);
const refuse = (status: 400 | 404 | 409, reason: string) => new ApiError(status === 400 ? 'validation' : status === 404 ? 'not_found' : 'conflict', status, undefined, undefined, { reason });

export function createDemoPayrollApi(): PayrollApi {
  const wait = <T>(fn: () => T) => new Promise<T>((resolve, reject) => setTimeout(() => Promise.resolve().then(fn).then(resolve, reject), 120));
  const toEmployee = (id: string, input: unknown): Employee => {
    const d = employeeSchema.parse(input);
    return { ...d, id, gross: d.basic + d.hra + d.specialAllowance + d.otherAllowance, archived: false };
  };
  const status = (id: string, from: PayRun['status'][], to: PayRun['status'], reason: string, extra: Partial<PayRun> = {}) => {
    const s = load();
    const r = s.runs.find((x) => x.id === id);
    if (!r) throw refuse(404, 'not_found');
    if (!from.includes(r.status)) throw refuse(409, reason);
    Object.assign(r, { status: to, ...extra });
    save(s);
    return r;
  };
  return {
    employees: () => wait(() => ({ employees: load().employees })),
    createEmployee: (input) =>
      wait(() => {
        const s = load();
        const e = toEmployee(crypto.randomUUID(), input);
        if (s.employees.some((x) => x.code.toLowerCase() === e.code.toLowerCase())) throw refuse(409, 'code_taken');
        s.employees.push(e);
        save(s);
        return e;
      }),
    updateEmployee: (id, input) =>
      wait(() => {
        const s = load();
        const i = s.employees.findIndex((x) => x.id === id);
        if (i < 0) throw refuse(404, 'not_found');
        s.employees[i] = toEmployee(id, input);
        save(s);
        return s.employees[i]!;
      }),
    archiveEmployee: (id) =>
      wait(() => {
        const s = load();
        s.employees = s.employees.map((x) => (x.id === id ? { ...x, archived: true } : x));
        save(s);
      }),
    runs: () => wait(() => ({ runs: [...load().runs].sort((a, b) => b.month.localeCompare(a.month)) })),
    createRun: (input) =>
      wait(() => {
        const d = payRunSchema.parse(input);
        const s = load();
        if (s.runs.some((r) => r.month === d.month)) throw refuse(409, 'run_exists');
        const end = monthEnd(d.month);
        const people = s.employees.filter((e) => !e.archived && e.dateOfJoining <= end && (!e.dateOfLeaving || e.dateOfLeaving >= `${d.month}-01`));
        if (!people.length) throw refuse(409, 'no_employees');
        const lop = new Map(d.lossOfPay.map((l) => [l.employeeId, l.days]));
        const slips = people.map((e) => {
          const p = computePayslip(e, d.month, lop.get(e.id) ?? 0);
          return { id: crypto.randomUUID(), employee: { id: e.id, code: e.code, name: e.name, designation: e.designation }, ...p };
        });
        const sum = (code: string, side: 'deductions' | 'employer') => slips.reduce((t, p) => t + (p[side].find((l: PayslipLine) => l.code === code)?.amount ?? 0), 0);
        const run: PayRun = {
          id: crypto.randomUUID(),
          month: d.month,
          label: monthLabel(d.month),
          status: 'draft',
          gross: slips.reduce((t, p) => t + p.gross, 0),
          deductions: slips.reduce((t, p) => t + p.totalDeductions, 0),
          net: slips.reduce((t, p) => t + p.net, 0),
          employerCost: slips.reduce((t, p) => t + p.employerCost, 0),
          journalEntryId: null,
          paidOn: null,
          dues: { pf: sum('pf', 'deductions') + sum('pf_employer', 'employer') + sum('pf_admin', 'employer') + sum('edli', 'employer'), esi: sum('esi', 'deductions') + sum('esi_employer', 'employer'), pt: sum('pt', 'deductions'), tds: sum('tds', 'deductions') },
          payslips: slips,
        };
        s.runs.push(run);
        save(s);
        return run;
      }),
    removeRun: (id) =>
      wait(() => {
        const s = load();
        const r = s.runs.find((x) => x.id === id);
        if (r && r.status !== 'draft') throw refuse(409, 'not_draft');
        s.runs = s.runs.filter((x) => x.id !== id);
        save(s);
      }),
    post: (id) => wait(() => status(id, ['draft'], 'posted', 'not_draft')),
    unpost: (id) => wait(() => status(id, ['posted'], 'draft', 'already_paid')),
    pay: (id, input) => wait(() => status(id, ['posted'], 'paid', 'not_posted', { paidOn: input.date })),
    payslipPdf: (id) =>
      wait(() => {
        const run = load().runs.find((r) => r.payslips.some((p) => p.id === id));
        const p = run?.payslips.find((x) => x.id === id);
        if (!run || !p) throw refuse(404, 'not_found');
        const fmt = (m: number) => (m / 100).toFixed(2);
        const rows: string[][] = [['Earnings', 'Amount', 'Deductions', 'Amount']];
        for (let i = 0; i < Math.max(p.earnings.length, p.deductions.length); i++) rows.push([p.earnings[i]?.label ?? '', p.earnings[i] ? fmt(p.earnings[i]!.amount) : '', p.deductions[i]?.label ?? '', p.deductions[i] ? fmt(p.deductions[i]!.amount) : '']);
        rows.push(['Gross pay', fmt(p.gross), 'Total deductions', fmt(p.totalDeductions)]);
        const bytes = pdfTableBytes({ title: `Payslip for ${run.label}`, subtitle: 'Nest Demo Private Limited', info: [`${p.employee.name} (${p.employee.code})`, `Days in the month ${p.daysInMonth} · Days paid ${p.daysPaid}`], rows, after: [`Net pay: Rs ${fmt(p.net)}`], footer: `Nest Demo Private Limited · ${p.employee.code}` });
        return { blob: new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' }), filename: `payslip-${run.month}-${p.employee.code.toLowerCase()}.pdf` };
      }),
  };
}

export function usePayrollApi(): PayrollApi | null {
  const client = useContext(ApiClientContext);
  const { organizationId } = useSession();
  return useMemo(() => (client ? (organizationId ? createLivePayrollApi(client, organizationId) : null) : createDemoPayrollApi()), [client, organizationId]);
}
