/**
 * Creates the first Super Admin from environment variables.
 * Safe to run repeatedly: an existing user is promoted, never overwritten.
 *
 *   SEED_SUPERADMIN_EMAIL, SEED_SUPERADMIN_PASSWORD, SEED_SUPERADMIN_NAME
 */
import argon2 from 'argon2';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';

const email = process.env.SEED_SUPERADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.SEED_SUPERADMIN_PASSWORD ?? '';
const name = process.env.SEED_SUPERADMIN_NAME?.trim() || 'Platform Admin';

function fail(message: string): never {
  console.error(`✖ ${message}`);
  process.exit(1);
}

if (!process.env.DATABASE_URL) fail('DATABASE_URL is not set.');
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('SEED_SUPERADMIN_EMAIL must be a valid email address.');
if (password.length < 12 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) {
  fail('SEED_SUPERADMIN_PASSWORD must be at least 12 characters with upper-case, lower-case and a number.');
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

try {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    if (!existing.isSuperAdmin) {
      await prisma.user.update({ where: { id: existing.id }, data: { isSuperAdmin: true } });
      await prisma.auditLog.create({ data: { action: 'platform.superadmin.promote', entityType: 'user', entityId: existing.id } });
      console.log(`✔ Promoted ${email} to Super Admin.`);
    } else {
      console.log(`✔ Super Admin ${email} already exists. Nothing to do.`);
    }
  } else {
    const user = await prisma.user.create({
      data: { email, name, isSuperAdmin: true, passwordHash: await argon2.hash(password, { type: argon2.argon2id }) },
    });
    await prisma.auditLog.create({ data: { action: 'platform.superadmin.create', entityType: 'user', entityId: user.id, after: { email, name } } });
    console.log(`✔ Created Super Admin ${email}.`);
  }
} finally {
  await prisma.$disconnect();
}
