import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  computePayslip,
  monthEnd,
  monthLabel,
  pdfTableBytes,
  rupeesInWords,
  type employeeSchema,
  type PayslipLine,
  type payRunPaySchema,
  type payRunSchema,
  type TaxRegime,
} from '@ledgernest/shared';
import type { Request } from 'express';
import type { z } from 'zod';
import type { Actor, Tenant } from '../access/types.js';
import { ensureFxAccount } from '../accounts/system-accounts.js';
import { AuditService } from '../audit/audit.service.js';
import { organizationLogo } from '../common/pdf-logo.js';
import type { Prisma } from '../generated/prisma/client.js';
import { JournalsService } from '../journals/journals.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

type Ctx = { actor: Actor; tenant: Tenant; req: Request };
type Tx = Prisma.TransactionClient;
type EmployeeIn = z.output<typeof employeeSchema>;

const refuse = (
  Ex: typeof ConflictException | typeof BadRequestException,
  message: string,
  reason: string,
  extra: object = {},
) => new Ex({ message, details: { reason, ...extra } });
const iso = (d: Date) => d.toISOString().slice(0, 10);
const asDate = (day: string) => new Date(`${day}T00:00:00Z`);
const rupees = (minor: number) => (minor / 100).toFixed(2);

type EmployeeRow = Prisma.EmployeeGetPayload<object>;

/**
 * Payroll: employees with their monthly salary, and each month's run of payslips. A run is drafted (loss-of-pay days
 * given), posted at the month's end (salaries and the employer's PF and ESI as expenses, against what's owed to staff
 * and the PF, ESI, professional tax and TDS due), then paid from a bank account.
 */
@Injectable()
export class PayrollService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly journals: JournalsService,
  ) {}

  private lock(tx: Tx, organizationId: string) {
    return tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'payroll:' + organizationId}))`;
  }

  private employeeView(e: EmployeeRow) {
    return {
      id: e.id,
      code: e.code,
      name: e.name,
      designation: e.designation,
      department: e.department,
      email: e.email,
      phone: e.phone,
      gender: e.gender,
      dateOfJoining: iso(e.dateOfJoining),
      dateOfLeaving: e.dateOfLeaving ? iso(e.dateOfLeaving) : null,
      pan: e.pan,
      uan: e.uan,
      esiNumber: e.esiNumber,
      stateCode: e.stateCode,
      basic: Number(e.basic),
      hra: Number(e.hra),
      specialAllowance: Number(e.specialAllowance),
      otherAllowance: Number(e.otherAllowance),
      /** Monthly gross */
      gross:
        Number(e.basic) +
        Number(e.hra) +
        Number(e.specialAllowance) +
        Number(e.otherAllowance),
      pf: e.pf,
      pfCapped: e.pfCapped,
      esi: e.esi,
      pt: e.pt,
      taxRegime: e.taxRegime as TaxRegime,
      monthlyTds: e.monthlyTds === null ? null : Number(e.monthlyTds),
      bankAccountName: e.bankAccountName,
      bankAccountNumber: e.bankAccountNumber,
      ifsc: e.ifsc,
      archived: !!e.archivedAt,
    };
  }

  async employees(organizationId: string) {
    const rows = await this.prisma.employee.findMany({
      where: { organizationId },
      orderBy: [{ archivedAt: 'asc' }, { code: 'asc' }],
    });
    return { employees: rows.map((e) => this.employeeView(e)) };
  }

  private data(input: EmployeeIn) {
    return {
      code: input.code,
      name: input.name,
      designation: input.designation,
      department: input.department,
      email: input.email,
      phone: input.phone,
      gender: input.gender,
      dateOfJoining: asDate(input.dateOfJoining),
      dateOfLeaving: input.dateOfLeaving ? asDate(input.dateOfLeaving) : null,
      pan: input.pan,
      uan: input.uan,
      esiNumber: input.esiNumber,
      stateCode: input.stateCode,
      basic: BigInt(input.basic),
      hra: BigInt(input.hra),
      specialAllowance: BigInt(input.specialAllowance),
      otherAllowance: BigInt(input.otherAllowance),
      pf: input.pf,
      pfCapped: input.pfCapped,
      esi: input.esi,
      pt: input.pt,
      taxRegime: input.taxRegime,
      monthlyTds: input.monthlyTds === null ? null : BigInt(input.monthlyTds),
      bankAccountName: input.bankAccountName,
      bankAccountNumber: input.bankAccountNumber,
      ifsc: input.ifsc,
    };
  }

  private async codeFree(
    organizationId: string,
    code: string,
    except?: string,
  ) {
    if (
      await this.prisma.employee.findFirst({
        where: {
          organizationId,
          code: { equals: code, mode: 'insensitive' },
          ...(except && { id: { not: except } }),
        },
        select: { id: true },
      })
    )
      throw refuse(
        ConflictException,
        `Another employee has the code ${code}.`,
        'code_taken',
        { field: 'code' },
      );
  }

  async createEmployee(input: EmployeeIn, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    await this.codeFree(organizationId, input.code);
    const e = await this.prisma.employee.create({
      data: { organizationId, ...this.data(input) },
    });
    await this.audit.record({
      action: 'org.employee.create',
      actorId: ctx.actor.userId,
      organizationId,
      entityType: 'employee',
      entityId: e.id,
      after: { code: e.code, name: e.name },
      req: ctx.req,
    });
    return this.employeeView(e);
  }

  async updateEmployee(id: string, input: EmployeeIn, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    const before = await this.prisma.employee.findFirst({
      where: { organizationId, id },
    });
    if (!before) throw new NotFoundException('Employee not found.');
    await this.codeFree(organizationId, input.code, id);
    const e = await this.prisma.employee.update({
      where: { id },
      data: this.data(input),
    });
    await this.audit.record({
      action: 'org.employee.update',
      actorId: ctx.actor.userId,
      organizationId,
      entityType: 'employee',
      entityId: id,
      // Salaries are private: the log says what changed, not to what
      after: {
        code: e.code,
        salaryChanged:
          before.basic !== e.basic ||
          before.hra !== e.hra ||
          before.specialAllowance !== e.specialAllowance ||
          before.otherAllowance !== e.otherAllowance,
      },
      req: ctx.req,
    });
    return this.employeeView(e);
  }

  /** Left: kept for past payslips, on no new run */
  async archiveEmployee(id: string, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    const e = await this.prisma.employee.findFirst({
      where: { organizationId, id },
      select: { id: true, code: true },
    });
    if (!e) throw new NotFoundException('Employee not found.');
    await this.prisma.employee.update({
      where: { id },
      data: { archivedAt: new Date() },
    });
    await this.audit.record({
      action: 'org.employee.archive',
      actorId: ctx.actor.userId,
      organizationId,
      entityType: 'employee',
      entityId: id,
      before: { code: e.code },
      req: ctx.req,
    });
  }

  private runSelect = {
    id: true,
    month: true,
    status: true,
    gross: true,
    deductions: true,
    net: true,
    employerCost: true,
    journalEntryId: true,
    paidOn: true,
    payEntryId: true,
    createdAt: true,
    payslips: {
      orderBy: { employee: { code: 'asc' as const } },
      select: {
        id: true,
        daysInMonth: true,
        daysPaid: true,
        earnings: true,
        deductions: true,
        employer: true,
        gross: true,
        totalDeductions: true,
        net: true,
        employerCost: true,
        employee: {
          select: { id: true, code: true, name: true, designation: true },
        },
      },
    },
  } as const;

  private runView(
    r: Prisma.PayRunGetPayload<{ select: PayrollService['runSelect'] }>,
  ) {
    const sum = (code: string, side: 'deductions' | 'employer') =>
      r.payslips.reduce(
        (t, p) =>
          t +
          ((p[side] as unknown as PayslipLine[]).find((l) => l.code === code)
            ?.amount ?? 0),
        0,
      );
    return {
      id: r.id,
      month: r.month,
      label: monthLabel(r.month),
      status: r.status as 'draft' | 'posted' | 'paid',
      gross: Number(r.gross),
      deductions: Number(r.deductions),
      net: Number(r.net),
      employerCost: Number(r.employerCost),
      journalEntryId: r.journalEntryId,
      paidOn: r.paidOn ? iso(r.paidOn) : null,
      payEntryId: r.payEntryId,
      /** What's due to each authority for the month */
      dues: {
        pf:
          sum('pf', 'deductions') +
          sum('pf_employer', 'employer') +
          sum('pf_admin', 'employer') +
          sum('edli', 'employer'),
        esi: sum('esi', 'deductions') + sum('esi_employer', 'employer'),
        pt: sum('pt', 'deductions'),
        tds: sum('tds', 'deductions'),
      },
      payslips: r.payslips.map((p) => ({
        id: p.id,
        employee: p.employee,
        daysInMonth: p.daysInMonth,
        daysPaid: Number(p.daysPaid),
        earnings: p.earnings as unknown as PayslipLine[],
        deductions: p.deductions as unknown as PayslipLine[],
        employer: p.employer as unknown as PayslipLine[],
        gross: Number(p.gross),
        totalDeductions: Number(p.totalDeductions),
        net: Number(p.net),
        employerCost: Number(p.employerCost),
      })),
    };
  }

  async runs(organizationId: string) {
    const rows = await this.prisma.payRun.findMany({
      where: { organizationId },
      orderBy: { month: 'desc' },
      select: this.runSelect,
    });
    return { runs: rows.map((r) => this.runView(r)) };
  }

  async run(organizationId: string, id: string) {
    const r = await this.prisma.payRun.findFirst({
      where: { organizationId, id },
      select: this.runSelect,
    });
    if (!r) throw new NotFoundException('Pay run not found.');
    return this.runView(r);
  }

  /** A month's draft run: a payslip for everyone on the payroll that month, less any days not paid */
  async createRun(input: z.output<typeof payRunSchema>, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    const id = await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, organizationId);
      if (
        await tx.payRun.findFirst({
          where: { organizationId, month: input.month },
          select: { id: true },
        })
      )
        throw refuse(
          ConflictException,
          `There’s already a run for ${monthLabel(input.month)}.`,
          'run_exists',
        );
      const start = asDate(`${input.month}-01`);
      const end = asDate(monthEnd(input.month));
      // Joined by the month's end and not left before it began
      const people = await tx.employee.findMany({
        where: {
          organizationId,
          archivedAt: null,
          dateOfJoining: { lte: end },
          OR: [{ dateOfLeaving: null }, { dateOfLeaving: { gte: start } }],
        },
        orderBy: { code: 'asc' },
      });
      if (!people.length)
        throw refuse(
          ConflictException,
          `No one is on the payroll in ${monthLabel(input.month)}.`,
          'no_employees',
        );
      const lop = new Map(input.lossOfPay.map((l) => [l.employeeId, l.days]));
      const slips = people.map((e) => {
        // Days before joining or after leaving aren't paid either
        const days = Number(monthEnd(input.month).slice(8));
        const from =
          e.dateOfJoining > start ? e.dateOfJoining.getUTCDate() - 1 : 0;
        const after =
          e.dateOfLeaving && e.dateOfLeaving < end
            ? days - e.dateOfLeaving.getUTCDate()
            : 0;
        const notPaid = Math.min(days, (lop.get(e.id) ?? 0) + from + after);
        return {
          e,
          p: computePayslip(
            {
              basic: Number(e.basic),
              hra: Number(e.hra),
              specialAllowance: Number(e.specialAllowance),
              otherAllowance: Number(e.otherAllowance),
              pf: e.pf,
              pfCapped: e.pfCapped,
              esi: e.esi,
              pt: e.pt,
              stateCode: e.stateCode,
              gender: e.gender as 'male' | 'female' | 'other' | null,
              taxRegime: e.taxRegime as TaxRegime,
              monthlyTds: e.monthlyTds === null ? null : Number(e.monthlyTds),
            },
            input.month,
            notPaid,
          ),
        };
      });
      const total = (f: (p: (typeof slips)[number]['p']) => number) =>
        BigInt(slips.reduce((t, s) => t + f(s.p), 0));
      const run = await tx.payRun.create({
        data: {
          organizationId,
          month: input.month,
          gross: total((p) => p.gross),
          deductions: total((p) => p.totalDeductions),
          net: total((p) => p.net),
          employerCost: total((p) => p.employerCost),
          createdById: ctx.actor.userId,
        },
        select: { id: true },
      });
      await tx.payslip.createMany({
        data: slips.map(({ e, p }) => ({
          organizationId,
          payRunId: run.id,
          employeeId: e.id,
          daysInMonth: p.daysInMonth,
          daysPaid: p.daysPaid,
          earnings: p.earnings as unknown as Prisma.InputJsonValue,
          deductions: p.deductions as unknown as Prisma.InputJsonValue,
          employer: p.employer as unknown as Prisma.InputJsonValue,
          gross: BigInt(p.gross),
          totalDeductions: BigInt(p.totalDeductions),
          net: BigInt(p.net),
          employerCost: BigInt(p.employerCost),
        })),
      });
      await this.audit.record(
        {
          action: 'org.payroll.run',
          actorId: ctx.actor.userId,
          organizationId,
          entityType: 'pay_run',
          entityId: run.id,
          after: { month: input.month, employees: slips.length },
          req: ctx.req,
        },
        tx,
      );
      return run.id;
    });
    return this.run(organizationId, id);
  }

  async removeRun(id: string, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    const r = await this.prisma.payRun.findFirst({
      where: { organizationId, id },
      select: { status: true, month: true },
    });
    if (!r) throw new NotFoundException('Pay run not found.');
    if (r.status !== 'draft')
      throw refuse(
        ConflictException,
        'Only a draft run can be deleted. Undo posting it first.',
        'not_draft',
      );
    await this.prisma.payRun.delete({ where: { id } });
    await this.audit.record({
      action: 'org.payroll.delete',
      actorId: ctx.actor.userId,
      organizationId,
      entityType: 'pay_run',
      entityId: id,
      before: { month: r.month },
      req: ctx.req,
    });
  }

  /**
   * Posts the month at its end: salaries and the employer's PF and ESI as expenses, against what's owed to staff
   * (net pay) and what's due to the PF and ESI offices, professional tax and TDS on salary.
   */
  async post(id: string, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, organizationId);
      const r = await tx.payRun.findFirst({
        where: { organizationId, id },
        select: this.runSelect,
      });
      if (!r) throw new NotFoundException('Pay run not found.');
      if (r.status !== 'draft')
        throw refuse(
          ConflictException,
          'This run is already posted.',
          'not_draft',
        );
      const v = this.runView(r);
      const acc = (key: Parameters<typeof ensureFxAccount>[2]) =>
        ensureFxAccount(tx, organizationId, key);
      const label = `Salaries for ${v.label}`;
      const line = (accountId: string, debit: number, credit: number) => ({
        accountId,
        description: label,
        debit,
        credit,
      });
      const lines = [
        line(await acc('salaries'), v.gross, 0),
        line(await acc('employer_contributions'), v.employerCost, 0),
        line(await acc('salaries_payable'), 0, v.net),
        line(await acc('pf_payable'), 0, v.dues.pf),
        line(await acc('esi_payable'), 0, v.dues.esi),
        line(await acc('pt_payable'), 0, v.dues.pt),
        line(await acc('tds_salary_payable'), 0, v.dues.tds),
      ].filter((l) => l.debit > 0 || l.credit > 0);
      const entry = await this.journals.postEntryInTx(
        tx,
        organizationId,
        {
          date: monthEnd(r.month),
          memo: label,
          reference: `PAYROLL ${r.month}`,
          lines,
        },
        ctx.actor.userId,
      );
      await tx.payRun.update({
        where: { id },
        data: { status: 'posted', journalEntryId: entry.id },
      });
      await this.audit.record(
        {
          action: 'org.payroll.post',
          actorId: ctx.actor.userId,
          organizationId,
          entityType: 'pay_run',
          entityId: id,
          after: { month: r.month, entry: entry.number },
          req: ctx.req,
        },
        tx,
      );
    });
    return this.run(organizationId, id);
  }

  /** Back to a draft (before it's paid): its entry is reversed */
  async unpost(id: string, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, organizationId);
      const r = await tx.payRun.findFirst({
        where: { organizationId, id },
        select: { status: true, month: true, journalEntryId: true },
      });
      if (!r) throw new NotFoundException('Pay run not found.');
      if (r.status !== 'posted')
        throw refuse(
          ConflictException,
          r.status === 'paid'
            ? 'This run is paid: it can’t go back to a draft.'
            : 'This run isn’t posted.',
          r.status === 'paid' ? 'already_paid' : 'not_posted',
        );
      await this.journals.reverseInTx(
        tx,
        organizationId,
        r.journalEntryId!,
        ctx.actor.userId,
        { memo: `Salaries for ${monthLabel(r.month)} reopened` },
        { system: true },
      );
      await tx.payRun.update({
        where: { id },
        data: { status: 'draft', journalEntryId: null },
      });
      await this.audit.record(
        {
          action: 'org.payroll.unpost',
          actorId: ctx.actor.userId,
          organizationId,
          entityType: 'pay_run',
          entityId: id,
          after: { month: r.month },
          req: ctx.req,
        },
        tx,
      );
    });
    return this.run(organizationId, id);
  }

  /** Net pay sent from a bank account: what's owed to staff comes down */
  async pay(id: string, input: z.output<typeof payRunPaySchema>, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, organizationId);
      const r = await tx.payRun.findFirst({
        where: { organizationId, id },
        select: { status: true, month: true, net: true },
      });
      if (!r) throw new NotFoundException('Pay run not found.');
      if (r.status !== 'posted')
        throw refuse(
          ConflictException,
          r.status === 'paid'
            ? 'This run is already paid.'
            : 'Post the run before paying it.',
          r.status === 'paid' ? 'already_paid' : 'not_posted',
        );
      if (input.date < monthEnd(r.month).slice(0, 8) + '01')
        throw refuse(
          BadRequestException,
          'Salaries can’t be paid before their month.',
          'before_month',
          { field: 'date' },
        );
      const bank = await tx.account.findFirst({
        where: { organizationId, id: input.bankAccountId },
        select: {
          id: true,
          type: true,
          subtype: true,
          currency: true,
          archivedAt: true,
        },
      });
      if (
        !bank ||
        bank.type !== 'asset' ||
        !['bank', 'cash'].includes(bank.subtype) ||
        bank.archivedAt ||
        bank.currency
      )
        throw refuse(
          BadRequestException,
          'Choose an active bank or cash account in rupees.',
          'bank_invalid',
          { field: 'bankAccountId' },
        );
      const label = `Salaries paid for ${monthLabel(r.month)}`;
      const entry = await this.journals.postEntryInTx(
        tx,
        organizationId,
        {
          date: input.date,
          memo: label,
          reference: `PAYROLL ${r.month}`,
          lines: [
            {
              accountId: await ensureFxAccount(
                tx,
                organizationId,
                'salaries_payable',
              ),
              description: label,
              debit: Number(r.net),
              credit: 0,
            },
            {
              accountId: bank.id,
              description: label,
              debit: 0,
              credit: Number(r.net),
            },
          ],
        },
        ctx.actor.userId,
      );
      await tx.payRun.update({
        where: { id },
        data: {
          status: 'paid',
          paidOn: asDate(input.date),
          payEntryId: entry.id,
        },
      });
      await this.audit.record(
        {
          action: 'org.payroll.pay',
          actorId: ctx.actor.userId,
          organizationId,
          entityType: 'pay_run',
          entityId: id,
          after: { month: r.month, entry: entry.number },
          req: ctx.req,
        },
        tx,
      );
    });
    return this.run(organizationId, id);
  }

  /** One payslip as a PDF for the employee */
  async payslipPdf(organizationId: string, id: string) {
    const p = await this.prisma.payslip.findFirst({
      where: { organizationId, id },
      select: {
        daysInMonth: true,
        daysPaid: true,
        earnings: true,
        deductions: true,
        employer: true,
        gross: true,
        totalDeductions: true,
        net: true,
        payRun: { select: { month: true } },
        employee: {
          select: {
            code: true,
            name: true,
            designation: true,
            department: true,
            pan: true,
            uan: true,
            esiNumber: true,
            dateOfJoining: true,
            bankAccountNumber: true,
            ifsc: true,
          },
        },
      },
    });
    if (!p) throw new NotFoundException('Payslip not found.');
    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: {
        name: true,
        legalName: true,
        addressLine1: true,
        city: true,
        region: true,
        postalCode: true,
      },
    });
    const e = p.employee;
    const earnings = p.earnings as unknown as PayslipLine[];
    const deductions = p.deductions as unknown as PayslipLine[];
    const rows: string[][] = [['Earnings', 'Amount', 'Deductions', 'Amount']];
    for (let i = 0; i < Math.max(earnings.length, deductions.length); i++)
      rows.push([
        earnings[i]?.label ?? '',
        earnings[i] ? rupees(earnings[i].amount) : '',
        deductions[i]?.label ?? '',
        deductions[i] ? rupees(deductions[i].amount) : '',
      ]);
    rows.push([
      'Gross pay',
      rupees(Number(p.gross)),
      'Total deductions',
      rupees(Number(p.totalDeductions)),
    ]);
    const seller = org.legalName ?? org.name;
    const bytes = pdfTableBytes({
      logo: await organizationLogo(this.prisma, organizationId),
      title: `Payslip for ${monthLabel(p.payRun.month)}`,
      subtitle: `${seller}${[org.addressLine1, org.city, org.region, org.postalCode].some(Boolean) ? ` · ${[org.addressLine1, org.city, org.region, org.postalCode].filter(Boolean).join(', ')}` : ''}`,
      info: [
        `${e.name} (${e.code})${e.designation ? ` · ${e.designation}` : ''}${e.department ? ` · ${e.department}` : ''}`,
        [
          `Joined ${iso(e.dateOfJoining)}`,
          e.pan && `PAN ${e.pan}`,
          e.uan && `UAN ${e.uan}`,
          e.esiNumber && `ESI ${e.esiNumber}`,
        ]
          .filter(Boolean)
          .join(' · '),
        `Days in the month ${p.daysInMonth} · Days paid ${Number(p.daysPaid)}`,
        ...(e.bankAccountNumber
          ? [
              `Paid to account ending ${e.bankAccountNumber.slice(-4)}${e.ifsc ? ` · ${e.ifsc}` : ''}`,
            ]
          : []),
      ],
      rows,
      after: [
        `Net pay: Rs ${rupees(Number(p.net))}`,
        `In words: ${rupeesInWords(Number(p.net))}`,
        '',
        'This is a computer-generated payslip and needs no signature.',
      ],
      footer: `${seller} · Payslip ${monthLabel(p.payRun.month)} · ${e.code}`,
    });
    return {
      pdf: Buffer.from(bytes),
      fileName: `payslip-${p.payRun.month}-${e.code.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf`,
    };
  }
}
