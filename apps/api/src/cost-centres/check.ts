import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';

type Tx = Prisma.TransactionClient;

/**
 * The cost centres some lines are tagged with must be the organisation's own and still in use. Archived ones
 * stay on what was already tagged, but new lines can't use them.
 */
export async function checkCostCentres(
  tx: Tx,
  organizationId: string,
  lines: readonly { costCentreId?: string | null }[],
) {
  const ids = [
    ...new Set(
      lines.map((l) => l.costCentreId).filter((c): c is string => !!c),
    ),
  ];
  if (!ids.length) return;
  const found = await tx.costCentre.findMany({
    where: { organizationId, id: { in: ids } },
    select: { id: true, archivedAt: true },
  });
  if (found.length !== ids.length)
    throw new BadRequestException({
      message: 'A line uses a cost centre that doesn’t exist.',
      details: { reason: 'cost_centre_not_found' },
    });
  if (found.some((c) => c.archivedAt))
    throw new BadRequestException({
      message: 'A line uses an archived cost centre.',
      details: { reason: 'cost_centre_archived' },
    });
}
