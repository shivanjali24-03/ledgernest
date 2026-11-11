import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import {
  Injectable,
  Logger,
  NotFoundException,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import {
  WEBHOOK_RETRY_MINUTES,
  type WebhookEvent,
  type webhookSchema,
} from '@ledgernest/shared';
import type { Request } from 'express';
import type { z } from 'zod';
import type { Actor, Tenant } from '../access/types.js';
import { AuditService } from '../audit/audit.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { checkWebhookUrl, postWebhook } from './webhook-url.js';

type Ctx = { actor: Actor; tenant: Tenant; req: Request };
type Input = z.output<typeof webhookSchema>;
const endpointSelect = {
  id: true,
  url: true,
  description: true,
  events: true,
  active: true,
  createdAt: true,
  updatedAt: true,
} as const;
const deliverySelect = {
  id: true,
  event: true,
  status: true,
  attempts: true,
  lastStatus: true,
  lastError: true,
  createdAt: true,
  deliveredAt: true,
  nextAttemptAt: true,
} as const;
const errorText = (e: unknown) =>
  (e instanceof Error ? e.message : String(e)).slice(0, 300);

/** The signature header: a timestamp and the HMAC-SHA256 of "timestamp.body" with the endpoint's secret */
export const webhookSignature = (
  secret: string,
  timestamp: number,
  body: string,
) =>
  `t=${timestamp},v1=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;

/**
 * Webhooks: telling other systems when invoices, payments and bills change. Each event becomes a delivery per
 * endpoint that wants it, sent at once and retried with backoff (WEBHOOK_RETRY_MINUTES) until it succeeds or
 * is given up; every attempt is kept in the delivery log. Due retries are picked up every minute
 * (WEBHOOK_DISPATCH_SECONDS; 0 turns it off).
 */
@Injectable()
export class WebhooksService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly log = new Logger('Webhooks');
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  onApplicationBootstrap() {
    const seconds = Number(
      process.env.WEBHOOK_DISPATCH_SECONDS ??
        (process.env.NODE_ENV === 'test' ? 0 : 60),
    );
    if (!seconds) return;
    this.timer = setInterval(
      () =>
        void this.dispatch()
          .then(() => this.prune())
          .catch((e: unknown) => this.log.error(errorText(e))),
      seconds * 1000,
    );
    this.timer.unref();
  }
  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  // ---------- events ----------

  /**
   * Called once something has happened (after its transaction): queues a delivery to every active endpoint that
   * wants the event and starts sending. Never throws: a webhook problem mustn't undo the invoice.
   */
  async emit(
    organizationId: string,
    event: WebhookEvent | 'ping',
    data: unknown,
    actorId?: string,
    onlyEndpointId?: string,
  ) {
    try {
      const endpoints = await this.prisma.webhookEndpoint.findMany({
        where: {
          organizationId,
          ...(onlyEndpointId
            ? { id: onlyEndpointId }
            : { active: true, events: { has: event } }),
        },
        select: { id: true },
      });
      if (!endpoints.length) return [];
      const createdAt = new Date();
      const rows = endpoints.map((e) => {
        const id = randomUUID();
        return {
          id,
          organizationId,
          endpointId: e.id,
          event,
          triggeredById: actorId ?? null,
          createdAt,
          payload: {
            id,
            event,
            createdAt: createdAt.toISOString(),
            organizationId,
            data,
          } as Prisma.InputJsonValue,
        };
      });
      await this.prisma.webhookDelivery.createMany({ data: rows });
      const ids = rows.map((r) => r.id);
      if (!onlyEndpointId)
        setImmediate(
          () =>
            void this.dispatch(ids).catch((e: unknown) =>
              this.log.error(errorText(e)),
            ),
        );
      return ids;
    } catch (e) {
      this.log.error(`Couldn’t queue ${event}: ${errorText(e)}`);
      return [];
    }
  }

  /** Sends what's due (or just the deliveries given), each claimed first so two workers never send the same one */
  /** Finished deliveries are kept for WEBHOOK_LOG_DAYS (30), so the log doesn't grow for ever */
  async prune(now = new Date()) {
    const days = Number(process.env.WEBHOOK_LOG_DAYS ?? 30);
    const { count } = await this.prisma.webhookDelivery.deleteMany({
      where: {
        status: { in: ['succeeded', 'failed'] },
        createdAt: { lt: new Date(now.getTime() - days * 86_400_000) },
      },
    });
    return count;
  }

  async dispatch(onlyIds?: string[]) {
    const now = new Date();
    const due = await this.prisma.webhookDelivery.findMany({
      where: {
        status: 'pending',
        nextAttemptAt: { lte: now },
        ...(onlyIds && { id: { in: onlyIds } }),
      },
      orderBy: { createdAt: 'asc' },
      take: 50,
      select: { id: true },
    });
    for (const { id } of due) {
      const claimed = await this.prisma.webhookDelivery.updateMany({
        where: { id, status: 'pending', nextAttemptAt: { lte: now } },
        data: { nextAttemptAt: new Date(Date.now() + 5 * 60_000) },
      });
      if (claimed.count) await this.send(id);
    }
  }

  private async send(id: string) {
    const d = await this.prisma.webhookDelivery.findUniqueOrThrow({
      where: { id },
      select: {
        id: true,
        event: true,
        payload: true,
        attempts: true,
        endpoint: { select: { url: true, secret: true, active: true } },
      },
    });
    const attempts = d.attempts + 1;
    let status: number | null = null;
    let error: string | null = null;
    if (!d.endpoint.active) error = 'The endpoint is switched off.';
    else {
      const body = JSON.stringify(d.payload);
      try {
        status = await postWebhook(
          checkWebhookUrl(d.endpoint.url),
          {
            'Content-Type': 'application/json',
            'User-Agent': 'LedgerNest-Webhooks/1',
            'X-LedgerNest-Event': d.event,
            'X-LedgerNest-Delivery': d.id,
            'X-LedgerNest-Signature': webhookSignature(
              d.endpoint.secret,
              Math.floor(Date.now() / 1000),
              body,
            ),
          },
          body,
        );
        if (status < 200 || status >= 300)
          error = `The endpoint answered ${status}.`;
      } catch (e) {
        error = errorText(e);
      }
    }
    const ok = !error;
    const wait = WEBHOOK_RETRY_MINUTES[attempts - 1];
    await this.prisma.webhookDelivery.update({
      where: { id },
      data: {
        attempts,
        lastStatus: status,
        lastError: error,
        status: ok
          ? 'succeeded'
          : wait !== undefined && d.endpoint.active
            ? 'pending'
            : 'failed',
        deliveredAt: ok ? new Date() : null,
        nextAttemptAt:
          ok || wait === undefined || !d.endpoint.active
            ? null
            : new Date(Date.now() + wait * 60_000),
      },
    });
  }

  // ---------- endpoints ----------

  async list(organizationId: string) {
    const rows = await this.prisma.webhookEndpoint.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'asc' },
      select: {
        ...endpointSelect,
        deliveries: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { status: true, createdAt: true },
        },
      },
    });
    return rows.map(({ deliveries, ...e }) => ({
      ...e,
      lastDelivery: deliveries[0] ?? null,
    }));
  }

  private async find(organizationId: string, id: string) {
    const e = await this.prisma.webhookEndpoint.findFirst({
      where: { organizationId, id },
      select: endpointSelect,
    });
    if (!e) throw new NotFoundException('Webhook not found.');
    return e;
  }

  /** The secret is in the response, to set up the other side; rotate it to see a new one */
  async create(input: Input, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    const url = checkWebhookUrl(input.url);
    const secret = `whsec_${randomBytes(24).toString('base64url')}`;
    const e = await this.prisma.$transaction(async (tx) => {
      const created = await tx.webhookEndpoint.create({
        data: {
          organizationId,
          url,
          description: input.description,
          events: input.events,
          active: input.active,
          secret,
          createdById: ctx.actor.userId,
          updatedById: ctx.actor.userId,
        },
        select: endpointSelect,
      });
      await this.audit.record(
        {
          action: 'org.webhook.create',
          actorId: ctx.actor.userId,
          organizationId,
          entityType: 'webhook',
          entityId: created.id,
          after: { url, events: input.events, active: input.active },
          req: ctx.req,
        },
        tx,
      );
      return created;
    });
    return { ...e, secret };
  }

  async update(id: string, input: Partial<Input>, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    const before = await this.find(organizationId, id);
    const data = {
      ...(input.url !== undefined && { url: checkWebhookUrl(input.url) }),
      ...(input.description !== undefined && {
        description: input.description,
      }),
      ...(input.events && { events: input.events }),
      ...(input.active !== undefined && { active: input.active }),
    };
    return this.prisma.$transaction(async (tx) => {
      const e = await tx.webhookEndpoint.update({
        where: { id },
        data: { ...data, updatedById: ctx.actor.userId },
        select: endpointSelect,
      });
      await this.audit.record(
        {
          action: 'org.webhook.update',
          actorId: ctx.actor.userId,
          organizationId,
          entityType: 'webhook',
          entityId: id,
          before: {
            url: before.url,
            events: before.events,
            active: before.active,
          },
          after: { url: e.url, events: e.events, active: e.active },
          req: ctx.req,
        },
        tx,
      );
      return e;
    });
  }

  async rotate(id: string, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    await this.find(organizationId, id);
    const secret = `whsec_${randomBytes(24).toString('base64url')}`;
    await this.prisma.$transaction(async (tx) => {
      await tx.webhookEndpoint.update({
        where: { id },
        data: { secret, updatedById: ctx.actor.userId },
      });
      await this.audit.record(
        {
          action: 'org.webhook.update',
          actorId: ctx.actor.userId,
          organizationId,
          entityType: 'webhook',
          entityId: id,
          after: { secret: 'rotated' },
          req: ctx.req,
        },
        tx,
      );
    });
    return { secret };
  }

  async remove(id: string, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    const e = await this.find(organizationId, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.webhookEndpoint.delete({ where: { id } });
      await this.audit.record(
        {
          action: 'org.webhook.delete',
          actorId: ctx.actor.userId,
          organizationId,
          entityType: 'webhook',
          entityId: id,
          before: { url: e.url, events: e.events },
          req: ctx.req,
        },
        tx,
      );
    });
  }

  async deliveries(organizationId: string, endpointId: string) {
    await this.find(organizationId, endpointId);
    return this.prisma.webhookDelivery.findMany({
      where: { organizationId, endpointId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: deliverySelect,
    });
  }

  /** A test event to this endpoint, sent now: the answer comes back */
  async ping(endpointId: string, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    await this.find(organizationId, endpointId);
    const [id] = await this.emit(
      organizationId,
      'ping',
      { message: 'Hello from LedgerNest' },
      ctx.actor.userId,
      endpointId,
    );
    await this.dispatch([id!]);
    return this.prisma.webhookDelivery.findUniqueOrThrow({
      where: { id },
      select: deliverySelect,
    });
  }

  /** Try a delivery again now */
  async retry(deliveryId: string, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    const d = await this.prisma.webhookDelivery.findFirst({
      where: { organizationId, id: deliveryId },
      select: { id: true },
    });
    if (!d) throw new NotFoundException('Delivery not found.');
    await this.prisma.webhookDelivery.update({
      where: { id: d.id },
      data: { status: 'pending', nextAttemptAt: new Date() },
    });
    await this.dispatch([d.id]);
    return this.prisma.webhookDelivery.findUniqueOrThrow({
      where: { id: d.id },
      select: deliverySelect,
    });
  }
}
