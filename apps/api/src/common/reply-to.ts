import type { PrismaService } from '../prisma/prisma.service.js';

/** Where replies to documents sent on an organisation's behalf should go: its own email address, if it has one */
export async function organizationReplyTo(
  prisma: PrismaService,
  organizationId: string,
): Promise<string | null> {
  return (
    (
      await prisma.organization.findUnique({
        where: { id: organizationId },
        select: { email: true },
      })
    )?.email ?? null
  );
}
