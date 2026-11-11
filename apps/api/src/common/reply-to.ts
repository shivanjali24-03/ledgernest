import type { PrismaService } from '../prisma/prisma.service.js';

/** The organisation's name and address for documents it sends: From shows its name, replies go to it */
export async function organizationSender(
  prisma: PrismaService,
  organizationId: string,
): Promise<{ replyTo: string | null; fromName: string | null }> {
  const o = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { email: true, name: true },
  });
  return { replyTo: o?.email ?? null, fromName: o?.name ?? null };
}
