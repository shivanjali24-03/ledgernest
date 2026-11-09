import { BadGatewayException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { currencyDigits, normaliseRate, todayIn, toBase } from '@ledgernest/shared';
import { ensureFxAccount } from '../accounts/system-accounts.js';
import { JournalsService } from '../journals/journals.service.js';
import type { Request } from 'express';
import type { Actor, Tenant } from '../access/types.js';
import { AuditService } from '../audit/audit.service.js';
import type { Env } from '../config/env.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { rateOn, rateText } from './rate-on.js';

type Ctx = { actor: Actor; tenant: Tenant; req: Request };
type Tx = Prisma.TransactionClient;

const refuse = (message: string, reason: string, extra: object = {}) => new ConflictException({ message, details: { reason, ...extra } });
const iso = (d: Date) => d.toISOString().slice(0, 10);
const asDate = (day: string) => new Date(`${day}T00:00:00Z`);

/**
 * The foreign currencies an organisation trades in and their exchange rates against the base currency.
 * Rates are entered by hand or fetched from the European Central Bank's free reference rates;
 * a rate typed by hand is never overwritten by a fetch.
 */
@Injectable()
export class CurrenciesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService<Env, true>,
    private readonly journals: JournalsService,
  ) {}

  private lock(tx: Tx, organizationId: string) {
    return tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'currencies:' + organizationId}))`;
  }

  /** The rate on a day: the latest one on or before it. Journal lines in a foreign currency use this. */
  static rateOn = rateOn;

  private async base(tx: Tx | PrismaService, organizationId: string) {
    return (await tx.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { baseCurrency: true, timeZone: true } })) as { baseCurrency: string; timeZone: string };
  }

  private async findCurrency(tx: Tx | PrismaService, organizationId: string, code: string) {
    const c = await tx.organizationCurrency.findUnique({ where: { organizationId_code: { organizationId, code } }, select: { code: true } });
    if (!c) throw new NotFoundException('That currency isn’t enabled.');
    return c;
  }

  async list(organizationId: string) {
    const org = await this.base(this.prisma, organizationId);
    const today = todayIn(org.timeZone);
    const rows = await this.prisma.organizationCurrency.findMany({ where: { organizationId }, orderBy: { code: 'asc' }, select: { code: true, _count: { select: { rates: true } } } });
    const currencies = await Promise.all(
      rows.map(async (c) => ({ code: c.code, digits: currencyDigits(c.code), rateCount: c._count.rates, latest: await CurrenciesService.rateOn(this.prisma, organizationId, c.code, today) })),
    );
    return { base: org.baseCurrency, today, currencies };
  }

  async add(code: string, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, organizationId);
      const { baseCurrency } = await this.base(tx, organizationId);
      if (code === baseCurrency) throw refuse(`${code} is the base currency: the books are already kept in it.`, 'is_base');
      if (await tx.organizationCurrency.findUnique({ where: { organizationId_code: { organizationId, code } } })) throw refuse(`${code} is already enabled.`, 'already_enabled');
      await tx.organizationCurrency.create({ data: { organizationId, code } });
      await this.audit.record({ action: 'org.currency.add', actorId: ctx.actor.userId, organizationId, entityType: 'currency', after: { code }, req: ctx.req }, tx);
    });
    return this.list(organizationId);
  }

  /** Removes a currency and its rates. (Once journal lines use a currency, it will stay.) */
  async remove(code: string, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, organizationId);
      await this.findCurrency(tx, organizationId, code);
      const accounts = await tx.account.count({ where: { organizationId, currency: code } });
      if (accounts) throw refuse(`Accounts are kept in ${code}, so it stays enabled.`, 'in_use', { accounts });
      const rates = await tx.exchangeRate.count({ where: { organizationId, currency: code } });
      await tx.organizationCurrency.delete({ where: { organizationId_code: { organizationId, code } } });
      await this.audit.record({ action: 'org.currency.remove', actorId: ctx.actor.userId, organizationId, entityType: 'currency', before: { code, rates }, req: ctx.req }, tx);
    });
  }

  /** A currency's rates, newest first. */
  async rates(organizationId: string, code: string, q: { from?: string; to?: string }) {
    await this.findCurrency(this.prisma, organizationId, code);
    const rows = await this.prisma.exchangeRate.findMany({
      where: { organizationId, currency: code, ...((q.from || q.to) && { date: { ...(q.from && { gte: asDate(q.from) }), ...(q.to && { lte: asDate(q.to) }) } }) },
      orderBy: { date: 'desc' },
      take: 400,
      select: { date: true, rate: true, source: true, updatedAt: true },
    });
    return rows.map((r) => ({ date: iso(r.date), rate: rateText(r.rate), source: r.source as 'manual' | 'ecb', updatedAt: r.updatedAt }));
  }

  async setRate(code: string, date: string, rate: string, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, organizationId);
      await this.findCurrency(tx, organizationId, code);
      const key = { organizationId_currency_date: { organizationId, currency: code, date: asDate(date) } };
      const before = await tx.exchangeRate.findUnique({ where: key, select: { rate: true, source: true } });
      await tx.exchangeRate.upsert({ where: key, create: { organizationId, currency: code, date: asDate(date), rate, source: 'manual', createdById: ctx.actor.userId }, update: { rate, source: 'manual' } });
      await this.audit.record(
        { action: 'org.exchange_rate.set', actorId: ctx.actor.userId, organizationId, entityType: 'currency', before: before && { currency: code, date, rate: rateText(before.rate), source: before.source }, after: { currency: code, date, rate }, req: ctx.req },
        tx,
      );
      return { date, rate, source: 'manual' as const };
    });
  }

  async removeRate(code: string, date: string, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, organizationId);
      const r = await tx.exchangeRate.findUnique({ where: { organizationId_currency_date: { organizationId, currency: code, date: asDate(date) } }, select: { id: true, rate: true } });
      if (!r) throw new NotFoundException('There is no rate on that day.');
      await tx.exchangeRate.delete({ where: { id: r.id } });
      await this.audit.record({ action: 'org.exchange_rate.remove', actorId: ctx.actor.userId, organizationId, entityType: 'currency', before: { currency: code, date, rate: rateText(r.rate) }, req: ctx.req }, tx);
    });
  }

  /**
   * Fetches the European Central Bank's reference rate for every enabled currency, for a day (default: the latest).
   * The ECB publishes on working days, so a weekend or holiday gets the last published rate, saved under the day
   * it was published. Currencies the ECB doesn't cover (e.g. AED) are listed so they can be entered by hand.
   */
  async fetchRates(date: string | undefined, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    const { baseCurrency } = await this.base(this.prisma, organizationId);
    const codes = (await this.prisma.organizationCurrency.findMany({ where: { organizationId }, select: { code: true } })).map((c) => c.code);
    if (!codes.length) throw refuse('Enable a currency first.', 'no_currencies');
    const url = this.config.get('FX_RATES_URL', { infer: true });

    const found: { code: string; date: string; rate: string }[] = [];
    const unsupported: string[] = [];
    let failures = 0;
    // Network first, outside any transaction
    await Promise.all(
      codes.map(async (code) => {
        try {
          const res = await fetch(`${url}/${date ?? 'latest'}?from=${code}&to=${baseCurrency}`, { signal: AbortSignal.timeout(8000), headers: { Accept: 'application/json' } });
          if (res.status === 404 || res.status === 422) return void unsupported.push(code);
          if (!res.ok) return void failures++;
          const body = (await res.json()) as { date?: string; rates?: Record<string, number | string> };
          const value = body.rates?.[baseCurrency];
          const rate = value === undefined ? null : normaliseRate(typeof value === 'number' ? value.toFixed(10) : String(value));
          if (!rate || !body.date || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) return void unsupported.push(code);
          found.push({ code, date: body.date, rate });
        } catch {
          failures++;
        }
      }),
    );
    if (failures && !found.length && !unsupported.length) throw new BadGatewayException({ message: 'The exchange-rate service couldn’t be reached. Try again later, or enter the rates by hand.', details: { reason: 'source_unavailable' } });

    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, organizationId);
      const saved: typeof found = [];
      const keptManual: string[] = [];
      for (const f of found.sort((a, b) => a.code.localeCompare(b.code))) {
        const key = { organizationId_currency_date: { organizationId, currency: f.code, date: asDate(f.date) } };
        const existing = await tx.exchangeRate.findUnique({ where: key, select: { source: true } });
        if (existing?.source === 'manual') {
          keptManual.push(f.code);
          continue;
        }
        await tx.exchangeRate.upsert({ where: key, create: { organizationId, currency: f.code, date: asDate(f.date), rate: f.rate, source: 'ecb', createdById: ctx.actor.userId }, update: { rate: f.rate, source: 'ecb' } });
        saved.push(f);
      }
      const result = { saved, keptManual, unsupported: unsupported.sort(), failed: failures };
      await this.audit.record({ action: 'org.exchange_rate.fetch', actorId: ctx.actor.userId, organizationId, entityType: 'currency', after: { requested: date ?? 'latest', saved: saved.map((s) => `${s.code} ${s.date} ${s.rate}`), keptManual, unsupported: result.unsupported }, req: ctx.req }, tx);
      return result;
    });
  }

  /**
   * Revalues every foreign-currency account at a day's rate (usually a month's last day, before closing it):
   * the base amount it carries moves to its foreign balance at that rate, and the difference is booked to
   * Unrealised exchange gain or loss in one entry on that day. Later settlements then realise only what
   * moves after it. Accounts whose currency has no rate yet are listed and left alone.
   */
  async revalue(date: string, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, organizationId);
      const { baseCurrency } = await this.base(tx, organizationId);
      const balances = await tx.$queryRaw<{ id: string; code: string; name: string; currency: string; f: bigint; b: bigint }[]>`
        SELECT a.id, a.code, a.name, a.currency, coalesce(sum(l.foreign_debit - l.foreign_credit), 0)::bigint AS f, coalesce(sum(l.debit - l.credit), 0)::bigint AS b
        FROM accounts a
        JOIN journal_lines l ON l.account_id = a.id
        JOIN journal_entries e ON e.id = l.entry_id AND e.status = 'posted' AND e.date <= ${asDate(date)}::date
        WHERE a.organization_id = ${organizationId}::uuid AND a.currency IS NOT NULL
        GROUP BY a.id, a.code, a.name, a.currency
        ORDER BY a.code`;
      const adjustments: { accountId: string; code: string; name: string; currency: string; foreignBalance: number; rate: string; before: number; after: number; difference: number }[] = [];
      const missingRates = new Set<string>();
      for (const a of balances) {
        const r = await rateOn(tx, organizationId, a.currency, date);
        if (!r) {
          if (a.f !== 0n) missingRates.add(a.currency);
          continue;
        }
        const after = toBase(Number(a.f), r.rate, currencyDigits(a.currency), currencyDigits(baseCurrency));
        const difference = after - Number(a.b);
        if (difference) adjustments.push({ accountId: a.id, code: a.code, name: a.name, currency: a.currency, foreignBalance: Number(a.f), rate: r.rate, before: Number(a.b), after, difference });
      }
      let entry: { id: string; number: string } | null = null;
      if (adjustments.length) {
        const fx = await ensureFxAccount(tx, organizationId, 'fx_unrealised');
        const lines = adjustments.flatMap((x) => {
          const amount = Math.abs(x.difference);
          const up = x.difference > 0;
          return [
            { accountId: x.accountId, currency: x.currency, description: `${x.currency} at ${x.rate}`, debit: up ? amount : 0, credit: up ? 0 : amount },
            { accountId: fx, description: `${x.code} ${x.currency} at ${x.rate}`, debit: up ? 0 : amount, credit: up ? amount : 0 },
          ];
        });
        entry = await this.journals.postSystemEntry(tx, organizationId, { date, memo: `Revaluation of foreign-currency balances at ${date}`, lines }, ctx.actor.userId);
      }
      const result = { date, entry, adjustments, missingRates: [...missingRates].sort() };
      await this.audit.record(
        { action: 'org.currency.revalue', actorId: ctx.actor.userId, organizationId, entityType: 'currency', after: { date, entry: entry?.number ?? null, adjustments: adjustments.map((x) => `${x.code} ${x.difference}`), missingRates: result.missingRates }, req: ctx.req },
        tx,
      );
      return result;
    });
  }
}
