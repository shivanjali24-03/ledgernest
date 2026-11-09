import { Controller, Get, Header, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOkResponse, ApiProduces, ApiTags } from '@nestjs/swagger';
import { isoDaySchema, todayIn } from '@ledgernest/shared';
import type { Response } from 'express';
import { z } from 'zod';
import { CurrentTenant, RequirePermission } from '../access/decorators.js';
import type { Tenant } from '../access/types.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ReportsService } from './reports.service.js';

const tbQuery = new ZodValidationPipe(z.object({ asOf: isoDaySchema.optional() }));
const ledgerQuery = new ZodValidationPipe(
  z.object({ accountId: z.uuid(), from: isoDaySchema, to: isoDaySchema }).refine((q) => q.from <= q.to, { path: ['to'], message: 'The end date is before the start date.' }),
);

/** Reports over posted entries. Reading needs reports.view; downloading needs reports.export. */
@ApiTags('reports')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Organization-Id', required: true, description: 'The organisation to act in' })
@Controller('reports')
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly prisma: PrismaService,
  ) {}

  /** "Today" in the organisation's time zone, when no date is given. */
  private async today(organizationId: string) {
    const { timeZone } = await this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { timeZone: true } });
    return todayIn(timeZone);
  }

  @Get('trial-balance')
  @RequirePermission('reports.view')
  @ApiOkResponse({ description: 'Every account’s debits, credits and balance up to asOf (default: today)' })
  async trialBalance(@Query(tbQuery) q: { asOf?: string }, @CurrentTenant() tenant: Tenant) {
    return this.reports.trialBalance(tenant.organizationId, q.asOf ?? (await this.today(tenant.organizationId)));
  }

  @Get('trial-balance/export')
  @RequirePermission('reports.export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  @ApiProduces('text/csv')
  async trialBalanceCsv(@Query(tbQuery) q: { asOf?: string }, @CurrentTenant() tenant: Tenant, @Res({ passthrough: true }) res: Response) {
    const asOf = q.asOf ?? (await this.today(tenant.organizationId));
    const tb = await this.reports.trialBalance(tenant.organizationId, asOf);
    res.setHeader('Content-Disposition', `attachment; filename="trial-balance-${asOf}.csv"`);
    return this.reports.trialBalanceCsv(tb, await this.reports.decimals(tenant.organizationId));
  }

  @Get('ledger')
  @RequirePermission('reports.view')
  @ApiOkResponse({ description: 'An account’s posted lines with opening, running and closing balances' })
  ledger(@Query(ledgerQuery) q: { accountId: string; from: string; to: string }, @CurrentTenant() tenant: Tenant) {
    return this.reports.ledger(tenant.organizationId, q.accountId, q.from, q.to);
  }

  @Get('ledger/export')
  @RequirePermission('reports.export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  @ApiProduces('text/csv')
  async ledgerCsv(@Query(ledgerQuery) q: { accountId: string; from: string; to: string }, @CurrentTenant() tenant: Tenant, @Res({ passthrough: true }) res: Response) {
    const l = await this.reports.ledger(tenant.organizationId, q.accountId, q.from, q.to);
    res.setHeader('Content-Disposition', `attachment; filename="ledger-${l.account.code}-${q.from}-${q.to}.csv"`);
    return this.reports.ledgerCsv(l, await this.reports.decimals(tenant.organizationId));
  }
}
