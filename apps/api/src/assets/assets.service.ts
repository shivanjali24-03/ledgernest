import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  assetTag,
  depreciationFor,
  journalNumber,
  nextDay,
  type DepreciationMethod,
  type fixedAssetSchema,
  type disposeSchema,
} from '@ledgernest/shared';
import type { Request } from 'express';
import type { z } from 'zod';
import type { Actor, Tenant } from '../access/types.js';
import { AuditService } from '../audit/audit.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { JournalsService } from '../journals/journals.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

type Ctx = { actor: Actor; tenant: Tenant; req: Request };
type Tx = Prisma.TransactionClient;
type AssetIn = z.output<typeof fixedAssetSchema>;

const refuse = (
  Ex: typeof ConflictException | typeof BadRequestException,
  message: string,
  reason: string,
  extra: object = {},
) => new Ex({ message, details: { reason, ...extra } });
const iso = (d: Date) => d.toISOString().slice(0, 10);
const asDate = (day: string) => new Date(`${day}T00:00:00Z`);
const accountRef = { select: { id: true, code: true, name: true } } as const;
const entryRef = {
  select: { id: true, number: true, fiscalYear: { select: { name: true } } },
} as const;
const label = (
  e: { number: number | null; fiscalYear: { name: string } | null } | null,
) =>
  e?.number && e.fiscalYear ? journalNumber(e.fiscalYear.name, e.number) : null;

const select = {
  id: true,
  name: true,
  tag: true,
  description: true,
  cost: true,
  residual: true,
  inServiceDate: true,
  method: true,
  usefulLifeMonths: true,
  wdvRatePpm: true,
  openingAccumulated: true,
  accumulated: true,
  depreciatedTo: true,
  status: true,
  disposedOn: true,
  proceeds: true,
  createdAt: true,
  costAccount: accountRef,
  accumulatedAccount: accountRef,
  expenseAccount: accountRef,
  disposalEntry: entryRef,
} as const;
type Row = Prisma.FixedAssetGetPayload<{ select: typeof select }>;

/**
 * The fixed asset register. Depreciation is charged in runs up to a day (a month's end, usually): one entry,
 * a line per asset, each from the day after its last charge. The latest run can be undone. Disposing of an
 * asset charges it up to the day, takes it and its depreciation off the books, and books the gain or loss.
 */
@Injectable()
export class AssetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly journals: JournalsService,
  ) {}

  private lock(tx: Tx, organizationId: string) {
    return tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'assets:' + organizationId}))`;
  }

  private view(a: Row) {
    return {
      id: a.id,
      name: a.name,
      tag: a.tag,
      description: a.description,
      cost: Number(a.cost),
      residual: Number(a.residual),
      inServiceDate: iso(a.inServiceDate),
      method: a.method as DepreciationMethod,
      usefulLifeMonths: a.usefulLifeMonths,
      wdvRate: a.wdvRatePpm === null ? null : a.wdvRatePpm / 10_000,
      openingAccumulated: Number(a.openingAccumulated),
      accumulated: Number(a.accumulated),
      bookValue: a.status === 'disposed' ? 0 : Number(a.cost - a.accumulated),
      depreciatedTo: a.depreciatedTo && iso(a.depreciatedTo),
      status: a.status as 'active' | 'disposed',
      disposedOn: a.disposedOn && iso(a.disposedOn),
      proceeds: a.proceeds === null ? null : Number(a.proceeds),
      costAccount: a.costAccount,
      accumulatedAccount: a.accumulatedAccount,
      expenseAccount: a.expenseAccount,
      disposalEntry: a.disposalEntry && {
        id: a.disposalEntry.id,
        number: label(a.disposalEntry),
      },
      createdAt: a.createdAt,
    };
  }

  async list(organizationId: string) {
    const rows = await this.prisma.fixedAsset.findMany({
      where: { organizationId },
      orderBy: [{ status: 'asc' }, { tag: 'asc' }],
      select,
    });
    return rows.map((r) => this.view(r));
  }

  async get(organizationId: string, id: string) {
    const a = await this.prisma.fixedAsset.findFirst({
      where: { organizationId, id },
      select: {
        ...select,
        depreciation: {
          orderBy: { toDate: 'desc' },
          select: {
            fromDate: true,
            toDate: true,
            amount: true,
            run: { select: { id: true, journalEntry: entryRef } },
          },
        },
      },
    });
    if (!a) throw new NotFoundException('Asset not found.');
    return {
      ...this.view(a),
      history: a.depreciation.map((d) => ({
        from: iso(d.fromDate),
        to: iso(d.toDate),
        amount: Number(d.amount),
        runId: d.run.id,
        entry: { id: d.run.journalEntry.id, number: label(d.run.journalEntry) },
      })),
    };
  }

  private async checkAccounts(
    db: Tx | PrismaService,
    organizationId: string,
    input: Pick<
      AssetIn,
      'costAccountId' | 'accumulatedAccountId' | 'expenseAccountId'
    >,
  ) {
    const ids = [
      input.costAccountId,
      input.accumulatedAccountId,
      input.expenseAccountId,
    ];
    const accounts = await db.account.findMany({
      where: { organizationId, id: { in: ids }, archivedAt: null },
      select: { id: true, type: true, subtype: true, currency: true },
    });
    const one = (id: string) => accounts.find((a) => a.id === id);
    const cost = one(input.costAccountId);
    const acc = one(input.accumulatedAccountId);
    const exp = one(input.expenseAccountId);
    if (
      !cost ||
      cost.type !== 'asset' ||
      !['fixed_asset', 'other_asset'].includes(cost.subtype) ||
      cost.currency
    )
      throw refuse(
        BadRequestException,
        'Choose a fixed asset account for the cost.',
        'cost_account',
        { field: 'costAccountId' },
      );
    if (
      !acc ||
      acc.type !== 'asset' ||
      acc.subtype !== 'fixed_asset' ||
      acc.id === cost.id ||
      acc.currency
    )
      throw refuse(
        BadRequestException,
        'Choose a separate fixed asset account for accumulated depreciation.',
        'accumulated_account',
        { field: 'accumulatedAccountId' },
      );
    if (!exp || exp.type !== 'expense')
      throw refuse(
        BadRequestException,
        'Choose an expense account for the depreciation.',
        'expense_account',
        { field: 'expenseAccountId' },
      );
  }

  /** Adds an asset to the register. Its cost is taken as already in the books (its bill or journal). */
  async create(input: AssetIn, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    const id = await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, organizationId);
      await this.checkAccounts(tx, organizationId, input);
      let tag = input.tag;
      if (!tag)
        tag = assetTag(
          (await tx.fixedAsset.count({ where: { organizationId } })) + 1,
        );
      if (
        await tx.fixedAsset.findFirst({
          where: { organizationId, tag },
          select: { id: true },
        })
      )
        throw refuse(
          ConflictException,
          'Another asset has this tag.',
          'tag_taken',
          { field: 'tag' },
        );
      const a = await tx.fixedAsset.create({
        data: {
          organizationId,
          name: input.name,
          tag,
          description: input.description,
          costAccountId: input.costAccountId,
          accumulatedAccountId: input.accumulatedAccountId,
          expenseAccountId: input.expenseAccountId,
          cost: BigInt(input.cost),
          residual: BigInt(input.residual),
          inServiceDate: asDate(input.inServiceDate),
          method: input.method,
          usefulLifeMonths:
            input.method === 'straight_line' ? input.usefulLifeMonths : null,
          wdvRatePpm: input.method === 'wdv' ? input.wdvRate : null,
          openingAccumulated: BigInt(input.openingAccumulated),
          accumulated: BigInt(input.openingAccumulated),
          depreciatedTo: input.openingTo ? asDate(input.openingTo) : null,
          createdById: ctx.actor.userId,
        },
        select: { id: true },
      });
      await this.audit.record(
        {
          action: 'org.asset.create',
          actorId: ctx.actor.userId,
          organizationId,
          entityType: 'fixed_asset',
          entityId: a.id,
          after: {
            tag,
            name: input.name,
            cost: input.cost,
            method: input.method,
          },
          req: ctx.req,
        },
        tx,
      );
      return a.id;
    });
    return this.get(organizationId, id);
  }

  /** Changes an asset. Once depreciation has been charged, only its name and description. */
  async update(id: string, input: AssetIn, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, organizationId);
      const a = await tx.fixedAsset.findFirst({
        where: { organizationId, id },
        select: {
          id: true,
          status: true,
          _count: { select: { depreciation: true } },
        },
      });
      if (!a) throw new NotFoundException('Asset not found.');
      if (a.status === 'disposed')
        throw refuse(
          ConflictException,
          'This asset has been disposed of.',
          'disposed',
        );
      if (a._count.depreciation) {
        await tx.fixedAsset.update({
          where: { id },
          data: { name: input.name, description: input.description },
        });
      } else {
        await this.checkAccounts(tx, organizationId, input);
        await tx.fixedAsset.update({
          where: { id },
          data: {
            name: input.name,
            description: input.description,
            costAccountId: input.costAccountId,
            accumulatedAccountId: input.accumulatedAccountId,
            expenseAccountId: input.expenseAccountId,
            cost: BigInt(input.cost),
            residual: BigInt(input.residual),
            inServiceDate: asDate(input.inServiceDate),
            method: input.method,
            usefulLifeMonths:
              input.method === 'straight_line' ? input.usefulLifeMonths : null,
            wdvRatePpm: input.method === 'wdv' ? input.wdvRate : null,
            openingAccumulated: BigInt(input.openingAccumulated),
            accumulated: BigInt(input.openingAccumulated),
            depreciatedTo: input.openingTo ? asDate(input.openingTo) : null,
          },
        });
      }
      await this.audit.record(
        {
          action: 'org.asset.update',
          actorId: ctx.actor.userId,
          organizationId,
          entityType: 'fixed_asset',
          entityId: id,
          after: { name: input.name },
          req: ctx.req,
        },
        tx,
      );
    });
    return this.get(organizationId, id);
  }

  async remove(id: string, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    await this.prisma.$transaction(async (tx) => {
      const a = await tx.fixedAsset.findFirst({
        where: { organizationId, id },
        select: {
          tag: true,
          status: true,
          _count: { select: { depreciation: true } },
        },
      });
      if (!a) throw new NotFoundException('Asset not found.');
      if (a._count.depreciation || a.status === 'disposed')
        throw refuse(
          ConflictException,
          'Depreciation has been charged on this asset, so it stays on the register.',
          'has_depreciation',
        );
      await tx.fixedAsset.delete({ where: { id } });
      await this.audit.record(
        {
          action: 'org.asset.delete',
          actorId: ctx.actor.userId,
          organizationId,
          entityType: 'fixed_asset',
          entityId: id,
          before: { tag: a.tag },
          req: ctx.req,
        },
        tx,
      );
    });
  }

  /** What a run up to a day would charge each asset */
  private async charges(
    db: Tx | PrismaService,
    organizationId: string,
    upTo: string,
  ) {
    const assets = await db.fixedAsset.findMany({
      where: {
        organizationId,
        status: 'active',
        inServiceDate: { lte: asDate(upTo) },
      },
      orderBy: { tag: 'asc' },
      select: {
        id: true,
        tag: true,
        name: true,
        method: true,
        cost: true,
        residual: true,
        accumulated: true,
        usefulLifeMonths: true,
        wdvRatePpm: true,
        inServiceDate: true,
        depreciatedTo: true,
        expenseAccountId: true,
        accumulatedAccountId: true,
      },
    });
    return assets
      .map((a) => {
        const from = a.depreciatedTo
          ? nextDay(iso(a.depreciatedTo))
          : iso(a.inServiceDate);
        const amount = depreciationFor(
          {
            method: a.method as DepreciationMethod,
            cost: Number(a.cost),
            residual: Number(a.residual),
            accumulated: Number(a.accumulated),
            usefulLifeMonths: a.usefulLifeMonths,
            wdvRatePpm: a.wdvRatePpm,
          },
          from,
          upTo,
        );
        return {
          assetId: a.id,
          tag: a.tag,
          name: a.name,
          from,
          to: upTo,
          amount,
          previousTo: a.depreciatedTo,
          expenseAccountId: a.expenseAccountId,
          accumulatedAccountId: a.accumulatedAccountId,
        };
      })
      .filter((c) => c.from <= upTo);
  }

  async preview(organizationId: string, upTo: string) {
    const lines = (
      await this.charges(this.prisma, organizationId, upTo)
    ).filter((c) => c.amount > 0);
    return {
      upTo,
      lines: lines.map(({ assetId, tag, name, from, to, amount }) => ({
        assetId,
        tag,
        name,
        from,
        to,
        amount,
      })),
      total: lines.reduce((s, l) => s + l.amount, 0),
    };
  }

  /** Charges depreciation up to a day in one entry: a line per asset to its expense, against its accumulated depreciation */
  async run(upTo: string, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    const id = await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, organizationId);
      const lines = (await this.charges(tx, organizationId, upTo)).filter(
        (c) => c.amount > 0,
      );
      if (!lines.length)
        throw refuse(
          ConflictException,
          'There is nothing to depreciate up to this day.',
          'nothing_to_depreciate',
        );
      const total = lines.reduce((s, l) => s + l.amount, 0);
      const entry = await this.journals.postEntryInTx(
        tx,
        organizationId,
        {
          date: upTo,
          memo: `Depreciation to ${upTo}`,
          reference: 'DEPRECIATION',
          lines: lines.flatMap((l) => [
            {
              accountId: l.expenseAccountId,
              description: `${l.tag} ${l.name}`,
              debit: l.amount,
              credit: 0,
            },
            {
              accountId: l.accumulatedAccountId,
              description: `${l.tag} ${l.name}`,
              debit: 0,
              credit: l.amount,
            },
          ]) as never,
        },
        ctx.actor.userId,
      );
      const run = await tx.depreciationRun.create({
        data: {
          organizationId,
          upTo: asDate(upTo),
          total: BigInt(total),
          journalEntryId: entry.id,
          createdById: ctx.actor.userId,
        },
        select: { id: true },
      });
      await tx.depreciationLine.createMany({
        data: lines.map((l) => ({
          organizationId,
          runId: run.id,
          assetId: l.assetId,
          fromDate: asDate(l.from),
          toDate: asDate(l.to),
          amount: BigInt(l.amount),
          previousTo: l.previousTo,
        })),
      });
      // Only what was charged moves on, so undoing the run puts back exactly what it changed
      for (const l of lines)
        await tx.fixedAsset.update({
          where: { id: l.assetId },
          data: {
            accumulated: { increment: BigInt(l.amount) },
            depreciatedTo: asDate(upTo),
          },
        });
      await this.audit.record(
        {
          action: 'org.asset.depreciate',
          actorId: ctx.actor.userId,
          organizationId,
          entityType: 'depreciation_run',
          entityId: run.id,
          after: { upTo, total, assets: lines.length, entry: entry.number },
          req: ctx.req,
        },
        tx,
      );
      return run.id;
    });
    return this.getRun(organizationId, id);
  }

  async getRun(organizationId: string, id: string) {
    const r = await this.prisma.depreciationRun.findFirst({
      where: { organizationId, id },
      select: {
        id: true,
        upTo: true,
        total: true,
        createdAt: true,
        journalEntry: entryRef,
        lines: {
          select: {
            amount: true,
            fromDate: true,
            toDate: true,
            asset: { select: { id: true, tag: true, name: true } },
          },
        },
      },
    });
    if (!r) throw new NotFoundException('Run not found.');
    return {
      id: r.id,
      upTo: iso(r.upTo),
      total: Number(r.total),
      createdAt: r.createdAt,
      journalEntry: { id: r.journalEntry.id, number: label(r.journalEntry) },
      lines: r.lines.map((l) => ({
        asset: l.asset,
        from: iso(l.fromDate),
        to: iso(l.toDate),
        amount: Number(l.amount),
      })),
    };
  }

  async runs(organizationId: string) {
    const rows = await this.prisma.depreciationRun.findMany({
      where: { organizationId },
      orderBy: { upTo: 'desc' },
      take: 50,
      select: { id: true },
    });
    return Promise.all(rows.map((r) => this.getRun(organizationId, r.id)));
  }

  /** Undoes the latest run: its entry is reversed and each asset goes back to where it stood */
  async undoRun(id: string, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, organizationId);
      const r = await tx.depreciationRun.findFirst({
        where: { organizationId, id },
        select: {
          id: true,
          upTo: true,
          journalEntryId: true,
          lines: { select: { assetId: true, amount: true, previousTo: true } },
        },
      });
      if (!r) throw new NotFoundException('Run not found.');
      if (
        await tx.depreciationRun.count({
          where: {
            organizationId,
            OR: [
              { upTo: { gt: r.upTo } },
              {
                upTo: r.upTo,
                createdAt: {
                  gt: (
                    await tx.depreciationRun.findUniqueOrThrow({
                      where: { id },
                      select: { createdAt: true },
                    })
                  ).createdAt,
                },
              },
            ],
          },
        })
      )
        throw refuse(
          ConflictException,
          'Only the latest run can be undone.',
          'not_latest',
        );
      const assets = await tx.fixedAsset.findMany({
        where: { organizationId, id: { in: r.lines.map((l) => l.assetId) } },
        select: { id: true, status: true },
      });
      if (assets.some((a) => a.status === 'disposed'))
        throw refuse(
          ConflictException,
          'An asset in this run has since been disposed of.',
          'disposed',
        );
      await this.journals.reverseInTx(
        tx,
        organizationId,
        r.journalEntryId,
        ctx.actor.userId,
        { date: iso(r.upTo), memo: `Depreciation to ${iso(r.upTo)} undone` },
        { system: true },
      );
      for (const l of r.lines)
        await tx.fixedAsset.update({
          where: { id: l.assetId },
          data: {
            accumulated: { decrement: l.amount },
            depreciatedTo: l.previousTo,
          },
        });
      await tx.depreciationRun.delete({ where: { id } });
      await this.audit.record(
        {
          action: 'org.asset.depreciate_undo',
          actorId: ctx.actor.userId,
          organizationId,
          entityType: 'depreciation_run',
          entityId: id,
          before: { upTo: iso(r.upTo) },
          req: ctx.req,
        },
        tx,
      );
    });
  }

  /**
   * Disposes of an asset: depreciation up to the day, then the cost and all its depreciation come off the
   * books, any money received goes to the bank, and what's left is the gain or loss on disposal.
   */
  async dispose(id: string, input: z.output<typeof disposeSchema>, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, organizationId);
      const a = await tx.fixedAsset.findFirst({
        where: { organizationId, id },
        select: {
          id: true,
          tag: true,
          name: true,
          status: true,
          method: true,
          cost: true,
          residual: true,
          accumulated: true,
          usefulLifeMonths: true,
          wdvRatePpm: true,
          inServiceDate: true,
          depreciatedTo: true,
          costAccountId: true,
          accumulatedAccountId: true,
          expenseAccountId: true,
        },
      });
      if (!a) throw new NotFoundException('Asset not found.');
      if (a.status === 'disposed')
        throw refuse(
          ConflictException,
          'This asset has already been disposed of.',
          'disposed',
        );
      if (input.date < iso(a.inServiceDate))
        throw refuse(
          BadRequestException,
          'An asset can’t be disposed of before it was in use.',
          'before_in_service',
          { field: 'date' },
        );
      if (a.depreciatedTo && input.date < iso(a.depreciatedTo))
        throw refuse(
          BadRequestException,
          `Depreciation is charged up to ${iso(a.depreciatedTo)}. Undo that run first, or dispose of it later.`,
          'before_depreciated',
          { field: 'date' },
        );
      const gl = await tx.account.findFirst({
        where: {
          organizationId,
          id: input.gainLossAccountId,
          archivedAt: null,
        },
        select: { type: true },
      });
      if (!gl || !['income', 'expense'].includes(gl.type))
        throw refuse(
          BadRequestException,
          'Choose an income or expense account for the gain or loss.',
          'gain_loss_account',
          { field: 'gainLossAccountId' },
        );
      if (input.proceeds) {
        const bank = await tx.account.findFirst({
          where: { organizationId, id: input.bankAccountId!, archivedAt: null },
          select: { type: true, subtype: true, currency: true },
        });
        if (
          !bank ||
          bank.type !== 'asset' ||
          !['bank', 'cash'].includes(bank.subtype) ||
          bank.currency
        )
          throw refuse(
            BadRequestException,
            'Choose a bank or cash account in the base currency.',
            'bank_invalid',
            { field: 'bankAccountId' },
          );
      }
      const from = a.depreciatedTo
        ? nextDay(iso(a.depreciatedTo))
        : iso(a.inServiceDate);
      const catchUp = depreciationFor(
        {
          method: a.method as DepreciationMethod,
          cost: Number(a.cost),
          residual: Number(a.residual),
          accumulated: Number(a.accumulated),
          usefulLifeMonths: a.usefulLifeMonths,
          wdvRatePpm: a.wdvRatePpm,
        },
        from,
        input.date,
      );
      const cost = Number(a.cost);
      const accumulated = Number(a.accumulated) + catchUp;
      const result = input.proceeds - (cost - accumulated);
      const memo = `Disposal of ${a.tag} ${a.name}`;
      const lines = [
        ...(catchUp
          ? [
              {
                accountId: a.expenseAccountId,
                description: `${a.tag} depreciation to ${input.date}`,
                debit: catchUp,
                credit: 0,
              },
            ]
          : []),
        ...(Number(a.accumulated)
          ? [
              {
                accountId: a.accumulatedAccountId,
                description: memo,
                debit: Number(a.accumulated),
                credit: 0,
              },
            ]
          : []),
        ...(input.proceeds
          ? [
              {
                accountId: input.bankAccountId!,
                description: memo,
                debit: input.proceeds,
                credit: 0,
              },
            ]
          : []),
        {
          accountId: a.costAccountId,
          description: memo,
          debit: 0,
          credit: cost,
        },
        ...(result
          ? [
              {
                accountId: input.gainLossAccountId,
                description:
                  result > 0 ? 'Gain on disposal' : 'Loss on disposal',
                debit: result < 0 ? -result : 0,
                credit: result > 0 ? result : 0,
              },
            ]
          : []),
      ];
      const entry = await this.journals.postEntryInTx(
        tx,
        organizationId,
        { date: input.date, memo, reference: a.tag, lines: lines as never },
        ctx.actor.userId,
      );
      await tx.fixedAsset.update({
        where: { id },
        data: {
          status: 'disposed',
          disposedOn: asDate(input.date),
          proceeds: BigInt(input.proceeds),
          accumulated: BigInt(accumulated),
          depreciatedTo: asDate(input.date),
          disposalEntryId: entry.id,
        },
      });
      await this.audit.record(
        {
          action: 'org.asset.dispose',
          actorId: ctx.actor.userId,
          organizationId,
          entityType: 'fixed_asset',
          entityId: id,
          after: {
            tag: a.tag,
            date: input.date,
            proceeds: input.proceeds,
            gainOrLoss: result,
            entry: entry.number,
          },
          req: ctx.req,
        },
        tx,
      );
    });
    return this.get(organizationId, id);
  }

  /** The schedule for a period: each asset's cost and depreciation at the start, what was added, charged and disposed of, and at the end */
  async schedule(organizationId: string, from: string, to: string) {
    const assets = await this.prisma.fixedAsset.findMany({
      where: {
        organizationId,
        inServiceDate: { lte: asDate(to) },
        OR: [{ disposedOn: null }, { disposedOn: { gte: asDate(from) } }],
      },
      orderBy: { tag: 'asc' },
      select: {
        id: true,
        tag: true,
        name: true,
        cost: true,
        inServiceDate: true,
        openingAccumulated: true,
        depreciatedTo: true,
        disposedOn: true,
        accumulated: true,
        depreciation: {
          select: { toDate: true, fromDate: true, amount: true },
        },
      },
    });
    const rows = assets.map((a) => {
      const inService = iso(a.inServiceDate);
      const disposed =
        a.disposedOn && iso(a.disposedOn) <= to ? iso(a.disposedOn) : null;
      const cost = Number(a.cost);
      const before = (day: string) =>
        Number(a.openingAccumulated) +
        a.depreciation
          .filter((d) => iso(d.toDate) < day)
          .reduce((s, d) => s + Number(d.amount), 0);
      const charged = a.depreciation
        .filter((d) => iso(d.toDate) >= from && iso(d.toDate) <= to)
        .reduce((s, d) => s + Number(d.amount), 0);
      // Depreciation charged as part of the disposal itself
      const atDisposal = disposed
        ? Number(a.accumulated) - before(nextDay(to))
        : 0;
      const openingCost = inService < from ? cost : 0;
      const openingDep = inService < from ? before(from) : 0;
      const depreciation = charged + atDisposal;
      const removedCost = disposed ? cost : 0;
      const removedDep = disposed ? openingDep + depreciation : 0;
      const closingCost =
        openingCost + (inService >= from ? cost : 0) - removedCost;
      const closingDep = openingDep + depreciation - removedDep;
      return {
        assetId: a.id,
        tag: a.tag,
        name: a.name,
        openingCost,
        additions: inService >= from ? cost : 0,
        disposals: removedCost,
        closingCost,
        openingDepreciation: openingDep,
        depreciation,
        depreciationOnDisposals: removedDep,
        closingDepreciation: closingDep,
        closingBookValue: closingCost - closingDep,
      };
    });
    const sum = (k: keyof (typeof rows)[number]) =>
      rows.reduce((s, r) => s + (r[k] as number), 0);
    return {
      from,
      to,
      rows,
      totals: {
        openingCost: sum('openingCost'),
        additions: sum('additions'),
        disposals: sum('disposals'),
        closingCost: sum('closingCost'),
        openingDepreciation: sum('openingDepreciation'),
        depreciation: sum('depreciation'),
        depreciationOnDisposals: sum('depreciationOnDisposals'),
        closingDepreciation: sum('closingDepreciation'),
        closingBookValue: sum('closingBookValue'),
      },
    };
  }
}
