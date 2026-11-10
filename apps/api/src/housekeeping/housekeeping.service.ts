import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

const DAY = 86_400_000;
/** Webhook deliveries are kept this long, for their history */
export const WEBHOOK_DELIVERY_DAYS = 90;

/**
 * Keeps the database from filling up with what no one can use any more: refresh tokens past their expiry, password
 * reset links used or expired, and webhook deliveries older than 90 days. Never the audit trail or the books.
 * Runs every HOUSEKEEPING_MINUTES (6 hours by default; off in tests).
 */
@Injectable()
export class HousekeepingService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly log = new Logger(HousekeepingService.name);
  private timer?: NodeJS.Timeout;

  constructor(private readonly prisma: PrismaService) {}

  onApplicationBootstrap() {
    const minutes = Number(
      process.env.HOUSEKEEPING_MINUTES ??
        (process.env.NODE_ENV === 'test' ? 0 : 360),
    );
    if (!minutes) return;
    this.timer = setInterval(
      () =>
        void this.run().catch((e: unknown) =>
          this.log.error(e instanceof Error ? e.message : String(e)),
        ),
      minutes * 60_000,
    );
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Clears out what's no longer needed; says how many of each went */
  async run(now = new Date()) {
    // A day's grace, so nothing is removed mid-use
    const dayAgo = new Date(now.getTime() - DAY);
    const [refreshTokens, passwordResets, webhookDeliveries] =
      await Promise.all([
        this.prisma.refreshToken.deleteMany({
          where: { expiresAt: { lt: dayAgo } },
        }),
        this.prisma.passwordReset.deleteMany({
          where: {
            OR: [{ expiresAt: { lt: dayAgo } }, { usedAt: { lt: dayAgo } }],
          },
        }),
        this.prisma.webhookDelivery.deleteMany({
          where: {
            status: { in: ['succeeded', 'failed'] },
            createdAt: {
              lt: new Date(now.getTime() - WEBHOOK_DELIVERY_DAYS * DAY),
            },
          },
        }),
      ]);
    const removed = {
      refreshTokens: refreshTokens.count,
      passwordResets: passwordResets.count,
      webhookDeliveries: webhookDeliveries.count,
    };
    if (Object.values(removed).some(Boolean))
      this.log.log(`Removed ${JSON.stringify(removed)}`);
    return removed;
  }
}
