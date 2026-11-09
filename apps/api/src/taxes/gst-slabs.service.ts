import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { formatRate, type GstSlabUpdateInput } from '@ledgernest/shared';
import type { Request } from 'express';
import type { Actor } from '../access/types.js';
import { AuditService } from '../audit/audit.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

type Ctx = { actor: Actor; req: Request };
type Tx = Prisma.TransactionClient;
type SlabIn = { rate: number; label: string; description: string | null; effectiveFrom: string; effectiveTo: string | null };

const refuse = (message: string, reason: string, extra: object = {}) => new ConflictException({ message, details: { reason, ...extra } });
const iso = (d: Date) => d.toISOString().slice(0, 10);
const asDate = (day: string) => new Date(`${day}T00:00:00Z`);

const select = { id: true, ratePpm: true, label: true, description: true, effectiveFrom: true, effectiveTo: true, createdAt: true, updatedAt: true, _count: { select: { groups: true } } } as const;
type Row = Prisma.GstSlabGetPayload<{ select: typeof select }>;

/**
 * India's GST slabs, kept by the Super Admin for every organisation. A slab's rate never changes,
 * because entries were taxed at it: when the GST Council changes a rate, the old slab gets an end date
 * and a new one starts the next day.
 */
@Injectable()
export class GstSlabsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  static view(s: Omit<Row, '_count'> & { _count?: { groups: number } }) {
    return {
      id: s.id,
      ratePpm: s.ratePpm,
      rate: formatRate(s.ratePpm),
      label: s.label,
      description: s.description,
      effectiveFrom: iso(s.effectiveFrom),
      effectiveTo: s.effectiveTo && iso(s.effectiveTo),
      /** How many organisations' tax groups use it */
      usage: s._count?.groups ?? 0,
    };
  }

  /** Every slab, lowest rate first, newest first within a rate. */
  async list() {
    const rows = await this.prisma.gstSlab.findMany({ orderBy: [{ ratePpm: 'asc' }, { effectiveFrom: 'desc' }], select });
    return rows.map((s) => GstSlabsService.view(s));
  }

  private lock(tx: Tx) {
    return tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('gst_slabs'))`;
  }

  /** The same rate can't be in force twice on one day (the database refuses it too). */
  private async assertNoOverlap(tx: Tx, ratePpm: number, from: string, to: string | null, exceptId?: string) {
    const clash = await tx.gstSlab.findFirst({
      where: {
        ratePpm,
        ...(exceptId && { NOT: { id: exceptId } }),
        ...(to && { effectiveFrom: { lte: asDate(to) } }),
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: asDate(from) } }],
      },
      select,
    });
    if (clash) {
      const c = GstSlabsService.view(clash);
      throw refuse(`A ${c.rate} slab already applies from ${c.effectiveFrom}${c.effectiveTo ? ` to ${c.effectiveTo}` : ''}. Give that one an end date first.`, 'overlap', { slabId: c.id });
    }
  }

  private async find(tx: Tx, id: string) {
    const s = await tx.gstSlab.findUnique({ where: { id }, select });
    if (!s) throw new NotFoundException('GST slab not found.');
    return s;
  }

  async create(input: SlabIn, ctx: Ctx) {
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx);
      await this.assertNoOverlap(tx, input.rate, input.effectiveFrom, input.effectiveTo);
      const s = await tx.gstSlab.create({
        data: { ratePpm: input.rate, label: input.label, description: input.description, effectiveFrom: asDate(input.effectiveFrom), effectiveTo: input.effectiveTo ? asDate(input.effectiveTo) : null },
        select,
      });
      const view = GstSlabsService.view(s);
      await this.audit.record({ action: 'platform.gst_slab.create', actorId: ctx.actor.userId, entityType: 'gst_slab', entityId: s.id, after: { rate: view.rate, label: view.label, effectiveFrom: view.effectiveFrom, effectiveTo: view.effectiveTo }, req: ctx.req }, tx);
      return view;
    });
  }

  async update(id: string, input: GstSlabUpdateInput & { description?: string | null }, ctx: Ctx) {
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx);
      const current = GstSlabsService.view(await this.find(tx, id));
      const next = { ...current, ...input };
      if (next.effectiveTo && next.effectiveTo < next.effectiveFrom) throw new ConflictException({ message: 'The end date can’t be before the start date.', details: { reason: 'dates' } });
      if (input.effectiveFrom !== undefined || input.effectiveTo !== undefined) await this.assertNoOverlap(tx, current.ratePpm, next.effectiveFrom, next.effectiveTo, id);
      const changed = (['label', 'description', 'effectiveFrom', 'effectiveTo'] as const).filter((k) => input[k] !== undefined && input[k] !== current[k]);
      if (!changed.length) return current;
      const s = await tx.gstSlab.update({
        where: { id },
        data: {
          ...(changed.includes('label') && { label: next.label }),
          ...(changed.includes('description') && { description: next.description }),
          ...(changed.includes('effectiveFrom') && { effectiveFrom: asDate(next.effectiveFrom) }),
          ...(changed.includes('effectiveTo') && { effectiveTo: next.effectiveTo ? asDate(next.effectiveTo) : null }),
        },
        select,
      });
      await this.audit.record(
        {
          action: 'platform.gst_slab.update',
          actorId: ctx.actor.userId,
          entityType: 'gst_slab',
          entityId: id,
          before: { rate: current.rate, ...Object.fromEntries(changed.map((k) => [k, current[k]])) },
          after: { rate: current.rate, ...Object.fromEntries(changed.map((k) => [k, next[k]])) },
          req: ctx.req,
        },
        tx,
      );
      return GstSlabsService.view(s);
    });
  }

  /** Only a slab no organisation uses can be deleted; otherwise give it an end date. */
  async remove(id: string, ctx: Ctx) {
    await this.prisma.$transaction(async (tx) => {
      await this.lock(tx);
      const s = GstSlabsService.view(await this.find(tx, id));
      if (s.usage) throw refuse('Organisations use this slab. Give it an end date instead.', 'in_use', { usage: s.usage });
      await tx.gstSlab.delete({ where: { id } });
      await this.audit.record({ action: 'platform.gst_slab.delete', actorId: ctx.actor.userId, entityType: 'gst_slab', entityId: id, before: { rate: s.rate, label: s.label, effectiveFrom: s.effectiveFrom, effectiveTo: s.effectiveTo }, req: ctx.req }, tx);
    });
  }
}
