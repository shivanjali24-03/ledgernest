import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  PIN_CODE,
  pinLookupFromIndiaPost,
  type PinLookup,
} from '@ledgernest/shared';
import type { Env } from '../config/env.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** A known PIN is kept for 30 days; one India Post doesn't know, for a day */
const KEEP_FOUND_MS = 30 * 86_400_000;
const KEEP_MISSING_MS = 86_400_000;

/**
 * Addresses from the PIN code, through India Post's free directory. The browser can't call it directly (it sends
 * no CORS header), so the API asks on its behalf: only for a well-formed PIN (nothing typed reaches the URL), with a
 * timeout, reading only the fields it needs, and keeping each answer so the directory is asked once a month per PIN.
 */
@Injectable()
export class GeoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async pincode(pin: string, now = new Date()): Promise<PinLookup> {
    if (!PIN_CODE.test(pin))
      throw new BadRequestException({
        message: 'A PIN code is 6 digits, not starting with 0.',
        details: { reason: 'invalid_pin' },
      });
    const unknown = () =>
      new NotFoundException({
        message:
          'India Post doesn’t know this PIN code. Check it, or type the address.',
        details: { reason: 'unknown_pin' },
      });
    const kept = await this.prisma.pincodeCache.findUnique({ where: { pin } });
    if (kept) {
      const age = now.getTime() - kept.fetchedAt.getTime();
      if (kept.data && age < KEEP_FOUND_MS)
        return kept.data as unknown as PinLookup;
      if (!kept.data && age < KEEP_MISSING_MS) throw unknown();
    }
    const url = this.config.get('INDIA_POST_URL', { infer: true });
    let found: PinLookup | null;
    try {
      const res = await fetch(`${url}/pincode/${pin}`, {
        signal: AbortSignal.timeout(8000),
        headers: { Accept: 'application/json' },
        redirect: 'error',
      });
      if (!res.ok) throw new Error(String(res.status));
      const text = await res.text();
      if (text.length > 500_000) throw new Error('too large');
      found = pinLookupFromIndiaPost(pin, JSON.parse(text));
    } catch {
      // An old answer beats none
      if (kept?.data) return kept.data as unknown as PinLookup;
      throw new BadGatewayException({
        message:
          'India Post’s PIN directory couldn’t be reached. Type the address instead.',
        details: { reason: 'source_unavailable' },
      });
    }
    const data = found
      ? (found as unknown as Prisma.InputJsonValue)
      : Prisma.DbNull;
    await this.prisma.pincodeCache.upsert({
      where: { pin },
      create: { pin, data, fetchedAt: now },
      update: { data, fetchedAt: now },
    });
    if (!found) throw unknown();
    return found;
  }
}
