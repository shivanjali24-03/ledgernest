import type { Prisma } from '../generated/prisma/client.js';

/**
 * Whether entries may be dated on this day: it must fall in an open period of an existing financial year.
 * Kept apart from PeriodsService so journals can use it without the two services importing each other.
 */
export async function dayStatus(tx: Prisma.TransactionClient, organizationId: string, day: string): Promise<'open' | 'closed' | 'no_period'> {
  const at = new Date(`${day}T00:00:00Z`);
  const p = await tx.period.findFirst({ where: { organizationId, startDate: { lte: at }, endDate: { gte: at } }, select: { status: true } });
  return p ? (p.status as 'open' | 'closed') : 'no_period';
}
