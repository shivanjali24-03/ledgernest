import { FX_ACCOUNT_NAMES, FX_ACCOUNTS, templateLanguage, type FxAccountKey } from '@ledgernest/shared';
import type { Prisma } from '../generated/prisma/client.js';

/**
 * The exchange gain/loss account, created the first time an organisation needs it, named in its language.
 * If the usual code or name is taken, the next free code and a distinguishing name are used.
 */
export async function ensureFxAccount(tx: Prisma.TransactionClient, organizationId: string, key: FxAccountKey): Promise<string> {
  const found = await tx.account.findFirst({ where: { organizationId, systemKey: key }, select: { id: true } });
  if (found) return found.id;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'accounts:' + organizationId}))`;
  const again = await tx.account.findFirst({ where: { organizationId, systemKey: key }, select: { id: true } });
  if (again) return again.id;
  const def = FX_ACCOUNTS[key];
  const { locale } = await tx.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { locale: true } });
  let code: string = def.code;
  for (let n = Number(def.code) + 1; await tx.account.findFirst({ where: { organizationId, code }, select: { id: true } }); n++) code = String(n);
  const names = FX_ACCOUNT_NAMES[key];
  let name = names[templateLanguage(locale)] ?? names.en;
  if (await tx.account.findFirst({ where: { organizationId, name: { equals: name, mode: 'insensitive' } }, select: { id: true } })) name = `${name} (${code})`;
  const a = await tx.account.create({ data: { organizationId, systemKey: key, code, name, type: def.type, subtype: def.subtype }, select: { id: true } });
  return a.id;
}
