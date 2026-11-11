import { ForbiddenException, HttpException, Injectable } from '@nestjs/common';
import {
  contactCreateSchema,
  currencyDigits,
  IMPORT_FIELDS,
  IMPORT_PERMISSIONS,
  importAccountType,
  importContactKind,
  importSubtype,
  itemCreateSchema,
  todayIn,
  toMinor,
  type ImportKind,
} from '@ledgernest/shared';
import type { Request } from 'express';
import { ZodError } from 'zod';
import type { Actor, Tenant } from '../access/types.js';
import { AccountsService } from '../accounts/accounts.service.js';
import { AuditService } from '../audit/audit.service.js';
import { ContactsService } from '../contacts/contacts.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { ItemsService } from '../items/items.service.js';
import { JournalsService } from '../journals/journals.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

type Ctx = { actor: Actor; tenant: Tenant; req: Request };
type Tx = Prisma.TransactionClient;
type Row = Record<string, string>;
export type RowResult = {
  row: number;
  ok: boolean;
  errors: { field: string | null; message: string }[];
  label?: string;
};

/** A row's problem, as the person importing should read it */
class RowProblem extends Error {
  constructor(
    message: string,
    readonly field: string | null = null,
  ) {
    super(message);
  }
}
class Rollback extends Error {}

const problems = (e: unknown): RowResult['errors'] => {
  if (e instanceof RowProblem) return [{ field: e.field, message: e.message }];
  if (e instanceof ZodError)
    return e.issues.map((i) => ({
      field: i.path.length ? String(i.path.join('.')) : null,
      message: i.message,
    }));
  if (e instanceof HttpException) {
    const body = e.getResponse() as {
      message?: string | string[];
      details?: { field?: string };
    };
    return [
      {
        field: body.details?.field ?? null,
        message: Array.isArray(body.message)
          ? body.message.join(' ')
          : (body.message ?? e.message),
      },
    ];
  }
  throw e;
};

/**
 * Imports from a spreadsheet. Each row goes through the same checks as adding it by hand, inside one
 * transaction with a savepoint per row, so every problem is reported at once; a preview always rolls back,
 * and an import saves only when every row is right.
 */
@Injectable()
export class ImportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly accounts: AccountsService,
    private readonly contacts: ContactsService,
    private readonly items: ItemsService,
    private readonly journals: JournalsService,
  ) {}

  async run(
    kind: ImportKind,
    input: Row[],
    ctx: Ctx,
    opts: { commit: boolean; date?: string },
  ) {
    // Our own exports (and many spreadsheets) guard cells starting with = + - @ with an apostrophe: take it off
    const rows = input.map(
      (r) =>
        Object.fromEntries(
          Object.entries(r).map(([k, v]) => [
            k,
            typeof v === 'string' ? v.replace(/^'(?=[=+\-@])/, '') : v,
          ]),
        ) as Row,
    );
    const need = IMPORT_PERMISSIONS[kind];
    if (!ctx.tenant.permissions.has(need))
      throw new ForbiddenException({
        message: 'You don’t have permission to import these.',
        details: { missing: [need] },
      });
    const required = IMPORT_FIELDS[kind].filter((f) => f.required);
    const results: RowResult[] = rows.map((r, n) => ({
      row: n + 1,
      ok: true,
      errors: required
        .filter((f) => !r[f.key]?.trim())
        .map((f) => ({ field: f.key, message: 'This is required.' })),
    }));
    for (const r of results) r.ok = !r.errors.length;
    if (kind === 'opening_balances')
      return this.openings(rows, results, ctx, opts);

    let saved = false;
    try {
      await this.prisma.$transaction(
        async (tx) => {
          const attempt = async (n: number, fn: () => Promise<string>) => {
            await tx.$executeRawUnsafe(`SAVEPOINT row_${n}`);
            try {
              results[n]!.label = await fn();
              await tx.$executeRawUnsafe(`RELEASE SAVEPOINT row_${n}`);
              return true;
            } catch (e) {
              await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT row_${n}`);
              results[n]!.ok = false;
              results[n]!.errors.push(...problems(e));
              return false;
            }
          };
          if (kind === 'accounts') {
            // Parents first: rows whose parent isn't there yet wait for a later pass
            let waiting = results.filter((r) => r.ok).map((r) => r.row - 1);
            for (let progress = true; waiting.length && progress;) {
              progress = false;
              const next: number[] = [];
              for (const n of waiting) {
                const parentCode = rows[n]!.parentCode?.trim();
                if (
                  parentCode &&
                  !(await tx.account.findFirst({
                    where: {
                      organizationId: ctx.tenant.organizationId,
                      code: parentCode,
                    },
                    select: { id: true },
                  }))
                ) {
                  next.push(n);
                  continue;
                }
                if (await attempt(n, () => this.account(tx, rows[n]!, ctx)))
                  progress = true;
              }
              waiting = next;
            }
            for (const n of waiting) {
              results[n]!.ok = false;
              results[n]!.errors.push({
                field: 'parentCode',
                message: `There’s no account with the code ${rows[n]!.parentCode}.`,
              });
            }
          } else {
            for (const r of results.filter((x) => x.ok))
              await attempt(r.row - 1, () =>
                kind === 'contacts'
                  ? this.contact(tx, rows[r.row - 1]!, ctx)
                  : this.item(tx, rows[r.row - 1]!, ctx),
              );
          }
          if (!opts.commit || results.some((r) => !r.ok)) throw new Rollback();
          await this.audit.record(
            {
              action: `org.import.${kind}`,
              actorId: ctx.actor.userId,
              organizationId: ctx.tenant.organizationId,
              entityType: 'import',
              entityId: kind,
              after: { rows: rows.length },
              req: ctx.req,
            },
            tx,
          );
          saved = true;
        },
        { timeout: 120_000, maxWait: 10_000 },
      );
    } catch (e) {
      if (!(e instanceof Rollback)) throw e;
    }
    return {
      kind,
      saved,
      rows: results.length,
      valid: results.filter((r) => r.ok).length,
      results,
    };
  }

  private async account(tx: Tx, r: Row, ctx: Ctx) {
    const type = importAccountType(r.type ?? '');
    if (!type)
      throw new RowProblem(
        `“${r.type}” isn’t an account type: use asset, liability, equity, income or expense.`,
        'type',
      );
    const subtype = importSubtype(type, r.subtype ?? '');
    if (!subtype)
      throw new RowProblem(
        `“${r.subtype}” isn’t a sub-type of ${type}.`,
        'subtype',
      );
    const parent = r.parentCode?.trim()
      ? await tx.account.findFirst({
          where: {
            organizationId: ctx.tenant.organizationId,
            code: r.parentCode.trim(),
          },
          select: { id: true },
        })
      : null;
    const a = await this.accounts.createInTx(
      tx,
      {
        code: r.code!.trim(),
        name: r.name!.trim(),
        type,
        subtype,
        parentId: parent?.id ?? null,
        description: r.description?.trim() || null,
        currency: r.currency?.trim().toUpperCase() || null,
      },
      ctx,
    );
    return `${a.code} · ${a.name}`;
  }

  private async contact(tx: Tx, r: Row, ctx: Ctx) {
    const kind = importContactKind(r.kind ?? '');
    if (!kind)
      throw new RowProblem(
        `“${r.kind}” isn’t customer, vendor or both.`,
        'kind',
      );
    const terms = r.paymentTermsDays?.trim()
      ? Number(r.paymentTermsDays.replace(/\s*days?$/i, ''))
      : undefined;
    if (terms !== undefined && !Number.isInteger(terms))
      throw new RowProblem(
        'Payment terms are a number of days.',
        'paymentTermsDays',
      );
    const v = contactCreateSchema.parse({
      name: r.name,
      ...kind,
      legalName: r.legalName || null,
      taxId: r.taxId?.toUpperCase() || null,
      email: r.email || null,
      phone: r.phone || null,
      billingAddress: {
        line1: r.line1 || null,
        line2: null,
        city: r.city || null,
        region: r.region || null,
        postalCode: r.postalCode || null,
        country: r.country?.toUpperCase() || (r.taxId ? 'IN' : null),
      },
      currency: r.currency?.toUpperCase() || null,
      ...(terms !== undefined && { paymentTermsDays: terms }),
      notes: r.notes || null,
    });
    const c = await this.contacts.createInTx(tx, v, ctx);
    return c.name;
  }

  private async item(tx: Tx, r: Row, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    const money = (field: string) => {
      const text = r[field]?.trim();
      if (!text) return null;
      const v = toMinor(text, 2);
      if (v === null) throw new RowProblem(`“${text}” isn’t an amount.`, field);
      return v;
    };
    const byCode = async (field: string) => {
      const code = r[field]?.trim();
      if (!code) return null;
      const a = await tx.account.findFirst({
        where: { organizationId, code },
        select: { id: true },
      });
      if (!a)
        throw new RowProblem(
          `There’s no account with the code ${code}.`,
          field,
        );
      return a.id;
    };
    const kind = (r.kind ?? '').trim().toLowerCase();
    const v = itemCreateSchema.parse({
      name: r.name,
      kind: kind
        ? ['goods', 'good', 'product'].includes(kind)
          ? 'goods'
          : ['service', 'services'].includes(kind)
            ? 'service'
            : kind
        : 'service',
      sku: r.sku || null,
      unit: r.unit || null,
      description: r.description || null,
      salePrice: money('salePrice'),
      purchasePrice: money('purchasePrice'),
      hsnSac: r.hsnSac || null,
      incomeAccountId: await byCode('incomeAccountCode'),
      expenseAccountId: await byCode('expenseAccountCode'),
      mrp: money('mrp'),
      barcode: r.barcode || null,
      brand: r.brand || null,
      category: r.category || null,
    });
    const i = await this.items.createInTx(tx, v, ctx);
    return i.name;
  }

  /**
   * Opening balances: one draft journal entry dated the day given, a line per account, with any difference
   * going to Opening balance equity. It stays a draft to look over and post.
   */
  private async openings(
    rows: Row[],
    results: RowResult[],
    ctx: Ctx,
    opts: { commit: boolean; date?: string },
  ) {
    const organizationId = ctx.tenant.organizationId;
    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { baseCurrency: true, timeZone: true, locale: true },
    });
    const digits = currencyDigits(org.baseCurrency);
    const accounts = new Map(
      (
        await this.prisma.account.findMany({
          where: { organizationId },
          select: {
            id: true,
            code: true,
            name: true,
            archivedAt: true,
            currency: true,
            _count: { select: { children: true } },
          },
        })
      ).map((a) => [a.code, a]),
    );
    const lines: {
      accountId: string;
      description: string;
      debit: number;
      credit: number;
    }[] = [];
    for (const [n, r] of rows.entries()) {
      const res = results[n]!;
      if (!res.ok) continue;
      const fail = (message: string, field: string) => (
        (res.ok = false),
        res.errors.push({ field, message })
      );
      const a = accounts.get(r.accountCode!.trim());
      if (!a)
        fail(
          `There’s no account with the code ${r.accountCode}.`,
          'accountCode',
        );
      else if (a.archivedAt) fail('That account is archived.', 'accountCode');
      else if (a._count.children)
        fail(
          'That account has sub-accounts: give the balance to one of them.',
          'accountCode',
        );
      else if (a.currency)
        fail(
          'Foreign-currency balances go in by hand, with their rate.',
          'accountCode',
        );
      const debit = toMinor(r.debit?.trim() ?? '', digits);
      const credit = toMinor(r.credit?.trim() ?? '', digits);
      if (debit === null) fail(`“${r.debit}” isn’t an amount.`, 'debit');
      if (credit === null) fail(`“${r.credit}” isn’t an amount.`, 'credit');
      if (res.ok && (debit ?? 0) > 0 === (credit ?? 0) > 0)
        fail('Give a debit or a credit.', 'debit');
      if (res.ok && a) {
        lines.push({
          accountId: a.id,
          description: 'Opening balance',
          debit: debit ?? 0,
          credit: credit ?? 0,
        });
        res.label = `${a.code} · ${a.name}`;
      }
    }
    const debit = lines.reduce((s, l) => s + l.debit, 0);
    const credit = lines.reduce((s, l) => s + l.credit, 0);
    const summary = { debit, credit, difference: debit - credit };
    let entry: { id: string } | null = null;
    if (opts.commit && results.every((r) => r.ok) && lines.length) {
      await this.prisma.$transaction((tx) =>
        AccountsService.createSystemAccounts(tx, organizationId, org.locale),
      );
      const equity = await this.prisma.account.findFirstOrThrow({
        where: { organizationId, systemKey: 'opening_balance_equity' },
        select: { id: true },
      });
      const diff = debit - credit;
      entry = await this.journals.createDraft(
        {
          date: opts.date ?? todayIn(org.timeZone),
          memo: 'Opening balances',
          reference: 'OPENING',
          lines: [
            ...lines,
            ...(diff
              ? [
                  {
                    accountId: equity.id,
                    description: 'Opening balance difference',
                    debit: diff < 0 ? -diff : 0,
                    credit: diff > 0 ? diff : 0,
                  },
                ]
              : []),
          ],
        },
        ctx,
      );
      await this.audit.record({
        action: 'org.import.opening_balances',
        actorId: ctx.actor.userId,
        organizationId,
        entityType: 'journal',
        entityId: entry.id,
        after: { rows: rows.length, ...summary },
        req: ctx.req,
      });
    }
    return {
      kind: 'opening_balances' as const,
      saved: !!entry,
      rows: results.length,
      valid: results.filter((r) => r.ok).length,
      results,
      summary,
      journalEntry: entry && { id: entry.id },
    };
  }
}
