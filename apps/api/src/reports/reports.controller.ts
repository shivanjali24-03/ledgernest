import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Query,
  Res,
  StreamableFile,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOkResponse,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import {
  agingQuerySchema,
  salesReportQuerySchema,
  type SalesReportBy,
  type SalesReportSide,
  statementEmailSchema,
  statementExportSchema,
  statementQuerySchema,
  balanceSheetQuerySchema,
  pnlQuerySchema,
  type PnlCompare,
  isoDaySchema,
  todayIn,
  type AgingSide,
  gstr2bRequestSchema,
  type Gstr2bRequest,
  cashForecastQuerySchema,
} from '@ledgernest/shared';
import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  CurrentActor,
  CurrentTenant,
  RequirePermission,
} from '../access/decorators.js';
import type { Actor, Tenant } from '../access/types.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CashForecastService } from './cash-forecast.service.js';
import { DashboardService } from './dashboard.service.js';
import { ExportAuditInterceptor } from './export-audit.interceptor.js';
import { GstReturnsService } from './gst-returns.service.js';
import { ReportsService } from './reports.service.js';
import { SalesReportService } from './sales-report.service.js';
import { StatementsService } from './statements.service.js';

const tbQuery = new ZodValidationPipe(
  z.object({ asOf: isoDaySchema.optional() }),
);
const ledgerQuery = new ZodValidationPipe(
  z
    .object({ accountId: z.uuid(), from: isoDaySchema, to: isoDaySchema })
    .refine((q) => q.from <= q.to, {
      path: ['to'],
      message: 'The end date is before the start date.',
    }),
);

const agingQuery = new ZodValidationPipe(agingQuerySchema);

const rangeQuery = new ZodValidationPipe(
  z
    .object({ from: isoDaySchema, to: isoDaySchema })
    .refine((q) => q.from <= q.to, {
      path: ['to'],
      message: 'The end date is before the start date.',
    }),
);

/** Reports over posted entries. Reading needs reports.view; downloading needs reports.export. */
@ApiTags('reports')
@ApiBearerAuth()
@ApiHeader({
  name: 'X-Organization-Id',
  required: true,
  description: 'The organisation to act in',
})
@Controller('reports')
@UseInterceptors(ExportAuditInterceptor)
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly prisma: PrismaService,
    private readonly dashboards: DashboardService,
    private readonly gst: GstReturnsService,
    private readonly statements: StatementsService,
    private readonly sales: SalesReportService,
    private readonly forecast: CashForecastService,
  ) {}

  /** "Today" in the organisation's time zone, when no date is given. */
  private async today(organizationId: string) {
    const { timeZone } = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { timeZone: true },
    });
    return todayIn(timeZone);
  }

  @Get('trial-balance')
  @RequirePermission('reports.view')
  @ApiOkResponse({
    description:
      'Every account’s debits, credits and balance up to asOf (default: today)',
  })
  async trialBalance(
    @Query(tbQuery) q: { asOf?: string },
    @CurrentTenant() tenant: Tenant,
  ) {
    return this.reports.trialBalance(
      tenant.organizationId,
      q.asOf ?? (await this.today(tenant.organizationId)),
    );
  }

  @Get('trial-balance/export')
  @RequirePermission('reports.export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  @ApiProduces('text/csv')
  async trialBalanceCsv(
    @Query(tbQuery) q: { asOf?: string },
    @CurrentTenant() tenant: Tenant,
    @Res({ passthrough: true }) res: Response,
  ) {
    const asOf = q.asOf ?? (await this.today(tenant.organizationId));
    const tb = await this.reports.trialBalance(tenant.organizationId, asOf);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="trial-balance-${asOf}.csv"`,
    );
    return this.reports.trialBalanceCsv(
      tb,
      await this.reports.decimals(tenant.organizationId),
    );
  }

  @Get('ledger')
  @RequirePermission('reports.view')
  @ApiOkResponse({
    description:
      'An account’s posted lines with opening, running and closing balances',
  })
  ledger(
    @Query(ledgerQuery) q: { accountId: string; from: string; to: string },
    @CurrentTenant() tenant: Tenant,
  ) {
    return this.reports.ledger(
      tenant.organizationId,
      q.accountId,
      q.from,
      q.to,
    );
  }

  @Get('ledger/export')
  @RequirePermission('reports.export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  @ApiProduces('text/csv')
  async ledgerCsv(
    @Query(ledgerQuery) q: { accountId: string; from: string; to: string },
    @CurrentTenant() tenant: Tenant,
    @Res({ passthrough: true }) res: Response,
  ) {
    const l = await this.reports.ledger(
      tenant.organizationId,
      q.accountId,
      q.from,
      q.to,
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="ledger-${l.account.code}-${q.from}-${q.to}.csv"`,
    );
    return this.reports.ledgerCsv(
      l,
      await this.reports.decimals(tenant.organizationId),
    );
  }

  @Get('tax-summary')
  @RequirePermission('reports.view')
  @ApiOkResponse({
    description:
      'Taxable values and tax per group, and output, input and net tax per rate, for a date range',
  })
  taxSummary(
    @Query(rangeQuery) q: { from: string; to: string },
    @CurrentTenant() tenant: Tenant,
  ) {
    return this.reports.taxSummary(tenant.organizationId, q.from, q.to);
  }

  @Get('tax-summary/export')
  @RequirePermission('reports.export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  @ApiProduces('text/csv')
  async taxSummaryCsv(
    @Query(rangeQuery) q: { from: string; to: string },
    @CurrentTenant() tenant: Tenant,
    @Res({ passthrough: true }) res: Response,
  ) {
    const t = await this.reports.taxSummary(
      tenant.organizationId,
      q.from,
      q.to,
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="tax-summary-${q.from}-${q.to}.csv"`,
    );
    return this.reports.taxSummaryCsv(
      t,
      await this.reports.decimals(tenant.organizationId),
    );
  }

  @Get('aging')
  @RequirePermission('reports.view')
  @ApiOkResponse({
    description:
      'Receivables or payables on asOf (default: today) by days past due, per contact, with the documents',
  })
  async aging(
    @Query(agingQuery) q: { side: AgingSide; asOf?: string },
    @CurrentTenant() tenant: Tenant,
  ) {
    return this.reports.aging(
      tenant.organizationId,
      q.side,
      q.asOf ?? (await this.today(tenant.organizationId)),
    );
  }

  @Get('aging/export')
  @RequirePermission('reports.export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  @ApiProduces('text/csv')
  async agingCsv(
    @Query(agingQuery) q: { side: AgingSide; asOf?: string },
    @CurrentTenant() tenant: Tenant,
    @Res({ passthrough: true }) res: Response,
  ) {
    const asOf = q.asOf ?? (await this.today(tenant.organizationId));
    const a = await this.reports.aging(tenant.organizationId, q.side, asOf);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${q.side}-aging-${asOf}.csv"`,
    );
    return this.reports.agingCsv(a);
  }

  @Get('sales')
  @RequirePermission('reports.view')
  @ApiOkResponse({
    description:
      'Sales (invoices less credit notes) or purchases (bills) between from and to, by customer, vendor or item, in the base currency',
  })
  salesReport(
    @Query(new ZodValidationPipe(salesReportQuerySchema))
    q: { side: SalesReportSide; by: SalesReportBy; from: string; to: string },
    @CurrentTenant() tenant: Tenant,
  ) {
    return this.sales.report(tenant.organizationId, q.side, q.by, q.from, q.to);
  }

  @Get('sales/export')
  @RequirePermission('reports.export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  @ApiProduces('text/csv')
  async salesReportCsv(
    @Query(new ZodValidationPipe(salesReportQuerySchema))
    q: { side: SalesReportSide; by: SalesReportBy; from: string; to: string },
    @CurrentTenant() tenant: Tenant,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.sales.report(
      tenant.organizationId,
      q.side,
      q.by,
      q.from,
      q.to,
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${q.side}-by-${q.by === 'item' ? 'item' : q.side === 'sales' ? 'customer' : 'vendor'}-${q.from}-${q.to}.csv"`,
    );
    return this.sales.csv(r);
  }

  @Get('statement')
  @RequirePermission('reports.view')
  @ApiOkResponse({
    description:
      'A contact’s statement of account: balance brought forward, every invoice, credit note, bill, payment and void between from and to with a running balance, and the balance carried down, per currency',
  })
  statement(
    @Query(new ZodValidationPipe(statementQuerySchema))
    q: { contactId: string; side: AgingSide; from: string; to: string },
    @CurrentTenant() tenant: Tenant,
  ) {
    return this.statements.statement(
      tenant.organizationId,
      q.contactId,
      q.side,
      q.from,
      q.to,
    );
  }

  @Get('statement/export')
  @RequirePermission('reports.export')
  @ApiProduces('text/csv', 'application/pdf')
  async statementFile(
    @Query(new ZodValidationPipe(statementExportSchema))
    q: {
      contactId: string;
      side: AgingSide;
      from: string;
      to: string;
      format: 'csv' | 'pdf';
    },
    @CurrentTenant() tenant: Tenant,
    @Res({ passthrough: true }) res: Response,
  ) {
    const s = await this.statements.statement(
      tenant.organizationId,
      q.contactId,
      q.side,
      q.from,
      q.to,
    );
    const f = await this.statements.file(tenant.organizationId, s, q.format);
    res.setHeader('Cache-Control', 'no-store');
    return new StreamableFile(f.data, {
      type: f.contentType,
      disposition: `attachment; filename="${f.fileName}"`,
      length: f.data.length,
    });
  }

  @Post('statement/email')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('reports.export')
  @ApiOkResponse({
    description:
      'Emails the statement as a PDF to the contact, or to the address given; 409 when email isn’t set up',
  })
  emailStatement(
    @Body(new ZodValidationPipe(statementEmailSchema))
    body: z.output<typeof statementEmailSchema>,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.statements.email(body, { actor, tenant, req });
  }

  @Get('profit-and-loss')
  @RequirePermission('reports.view')
  @ApiOkResponse({
    description:
      'Revenue, costs and profit for a period by account, optionally beside the previous period, last year or each month',
  })
  profitAndLoss(
    @Query(new ZodValidationPipe(pnlQuerySchema))
    q: {
      from: string;
      to: string;
      compare: PnlCompare;
      costCentreId?: string;
    },
    @CurrentTenant() tenant: Tenant,
  ) {
    return this.reports.profitAndLoss(
      tenant.organizationId,
      q.from,
      q.to,
      q.compare,
      q.costCentreId,
    );
  }

  @Get('profit-and-loss/export')
  @RequirePermission('reports.export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  @ApiProduces('text/csv')
  async profitAndLossCsv(
    @Query(new ZodValidationPipe(pnlQuerySchema))
    q: {
      from: string;
      to: string;
      compare: PnlCompare;
      costCentreId?: string;
    },
    @CurrentTenant() tenant: Tenant,
    @Res({ passthrough: true }) res: Response,
  ) {
    const p = await this.reports.profitAndLoss(
      tenant.organizationId,
      q.from,
      q.to,
      q.compare,
      q.costCentreId,
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="profit-and-loss-${q.from}-${q.to}.csv"`,
    );
    return this.reports.pnlCsv(
      p,
      await this.reports.decimals(tenant.organizationId),
    );
  }

  @Get('balance-sheet')
  @RequirePermission('reports.view')
  @ApiOkResponse({
    description:
      'Assets, liabilities and equity on a day (default today), optionally beside another day',
  })
  async balanceSheet(
    @Query(new ZodValidationPipe(balanceSheetQuerySchema))
    q: { asOf?: string; compareAsOf?: string },
    @CurrentTenant() tenant: Tenant,
  ) {
    return this.reports.balanceSheet(
      tenant.organizationId,
      q.asOf ?? (await this.today(tenant.organizationId)),
      q.compareAsOf,
    );
  }

  @Get('balance-sheet/export')
  @RequirePermission('reports.export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  @ApiProduces('text/csv')
  async balanceSheetCsv(
    @Query(new ZodValidationPipe(balanceSheetQuerySchema))
    q: { asOf?: string; compareAsOf?: string },
    @CurrentTenant() tenant: Tenant,
    @Res({ passthrough: true }) res: Response,
  ) {
    const asOf = q.asOf ?? (await this.today(tenant.organizationId));
    const b = await this.reports.balanceSheet(
      tenant.organizationId,
      asOf,
      q.compareAsOf,
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="balance-sheet-${asOf}.csv"`,
    );
    return this.reports.bsCsv(
      b,
      await this.reports.decimals(tenant.organizationId),
    );
  }

  @Get('dashboard')
  @RequirePermission('reports.view')
  @ApiOkResponse({
    description:
      'Cash, receivables, payables and profit with twelve months of trend, alerts the reader may see, and set-up progress',
  })
  dashboard(@CurrentTenant() tenant: Tenant, @CurrentActor() actor: Actor) {
    return this.dashboards.dashboard(
      tenant.organizationId,
      tenant.permissions,
      actor.userId,
    );
  }

  @Get('cash-flow')
  @RequirePermission('reports.view')
  @ApiOkResponse({
    description:
      'Cash from operating, investing and financing activities for a period, by the indirect and the direct method',
  })
  cashFlow(
    @Query(rangeQuery) q: { from: string; to: string },
    @CurrentTenant() tenant: Tenant,
  ) {
    return this.reports.cashFlow(tenant.organizationId, q.from, q.to);
  }

  @Get('cash-flow/export')
  @RequirePermission('reports.export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  @ApiProduces('text/csv')
  async cashFlowCsv(
    @Query(rangeQuery) q: { from: string; to: string },
    @CurrentTenant() tenant: Tenant,
    @Res({ passthrough: true }) res: Response,
  ) {
    const c = await this.reports.cashFlow(tenant.organizationId, q.from, q.to);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="cash-flow-${q.from}-${q.to}.csv"`,
    );
    return this.reports.cashFlowCsv(
      c,
      await this.reports.decimals(tenant.organizationId),
    );
  }

  @Get('cash-forecast')
  @RequirePermission('reports.view')
  @ApiOkResponse({
    description:
      'Cash week by week for the coming weeks: unpaid invoices on the day each customer usually pays, unpaid bills on their due dates, and what repeat invoices and bills will raise; with the lowest week and the first shortfall',
  })
  cashForecast(
    @Query(new ZodValidationPipe(cashForecastQuerySchema)) q: { weeks: number },
    @CurrentTenant() tenant: Tenant,
  ) {
    return this.forecast.forecast(tenant.organizationId, q.weeks);
  }

  @Get('gst/gstr-3b')
  @RequirePermission('reports.view')
  @ApiOkResponse({
    description:
      'GSTR-3B for a month or quarter: outward supplies and tax, input tax credit, set-off and tax payable in cash',
  })
  gstr3b(
    @Query(rangeQuery) q: { from: string; to: string },
    @CurrentTenant() tenant: Tenant,
  ) {
    return this.gst.gstr3b(tenant.organizationId, q.from, q.to);
  }

  @Post('gst/gstr-2b')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('reports.view')
  @ApiOkResponse({
    description:
      'GSTR-2B (the JSON from the GST portal) matched to bills dated in the range: matched, amounts differing, probable matches, filed but not in the books, and in the books but not filed (credit at risk)',
  })
  gstr2b(
    @Body(new ZodValidationPipe(gstr2bRequestSchema)) body: Gstr2bRequest,
    @CurrentTenant() tenant: Tenant,
  ) {
    return this.gst.gstr2b(
      tenant.organizationId,
      body.content,
      body.from,
      body.to,
    );
  }

  @Get('gst/gstr-1')
  @RequirePermission('reports.view')
  @ApiOkResponse({
    description:
      'GSTR-1 for a month or quarter: B2B, B2C large and small, exports, credit notes, HSN summary and documents issued',
  })
  gstr1(
    @Query(rangeQuery) q: { from: string; to: string },
    @CurrentTenant() tenant: Tenant,
  ) {
    return this.gst.gstr1(tenant.organizationId, q.from, q.to);
  }

  @Get('gst/gstr-1/export')
  @RequirePermission('reports.export')
  @Header('Cache-Control', 'no-store')
  @ApiProduces('text/csv', 'application/json')
  async gstr1Export(
    @Query(
      new ZodValidationPipe(
        z.object({
          from: isoDaySchema,
          to: isoDaySchema,
          format: z.enum(['csv', 'json']).default('csv'),
        }),
      ),
    )
    q: { from: string; to: string; format: 'csv' | 'json' },
    @CurrentTenant() tenant: Tenant,
    @Res({ passthrough: true }) res: Response,
  ) {
    const g = await this.gst.gstr1(tenant.organizationId, q.from, q.to);
    res.setHeader(
      'Content-Type',
      q.format === 'json'
        ? 'application/json; charset=utf-8'
        : 'text/csv; charset=utf-8',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="gstr-1-${q.from}-${q.to}.${q.format}"`,
    );
    return this.gst.gstr1Export(
      g,
      q.format,
      await this.reports.decimals(tenant.organizationId),
    );
  }
}
