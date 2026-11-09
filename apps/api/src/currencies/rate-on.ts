import { normaliseRate } from '@ledgernest/shared';
import type { Prisma } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';

/** Prisma returns NUMERIC as a Decimal; the API speaks in plain decimal strings like "83.25". */
export const rateText = (r: { toFixed(dp: number): string }) => normaliseRate(r.toFixed(10))!;

/**
 * The exchange rate on a day: the latest one on or before it. Kept apart from CurrenciesService so journals
 * can use it without the two importing each other.
 */
export async function rateOn(tx: Prisma.TransactionClient | PrismaService, organizationId: string, currency: string, day: string) {
  const r = await tx.exchangeRate.findFirst({ where: { organizationId, currency, date: { lte: new Date(`${day}T00:00:00Z`) } }, orderBy: { date: 'desc' }, select: { date: true, rate: true, source: true } });
  return r && { date: r.date.toISOString().slice(0, 10), rate: rateText(r.rate), source: r.source as 'manual' | 'ecb' };
}
