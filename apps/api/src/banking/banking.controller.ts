import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  bankActivityQuerySchema,
  bankMoneySchema,
  bankTransactionListQuerySchema,
  bankTransferSchema,
  bankVoidSchema,
  statementImportSchema,
  statementLinesQuerySchema,
} from '@ledgernest/shared';
import type { Request } from 'express';
import { z } from 'zod';
import {
  CurrentActor,
  CurrentTenant,
  RequirePermission,
} from '../access/decorators.js';
import type { Actor, Tenant } from '../access/types.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { BankingService } from './banking.service.js';
import { StatementsService } from './statements.service.js';

const id = new ParseUUIDPipe({ version: '4' });

/** Banking. Reading needs banking.view; spending, receiving and voiding need banking.manage. */
@ApiTags('banking')
@ApiBearerAuth()
@ApiHeader({
  name: 'X-Organization-Id',
  required: true,
  description: 'The organisation to act in',
})
@Controller('banking')
export class BankingController {
  constructor(
    private readonly banking: BankingService,
    private readonly statements: StatementsService,
  ) {}

  @Get('accounts')
  @RequirePermission('banking.view')
  @ApiOkResponse({
    description:
      'Every bank and cash account with its balance and when money last moved',
  })
  accounts(@CurrentTenant() tenant: Tenant) {
    return this.banking.accounts(tenant.organizationId);
  }

  @Get('accounts/:id/activity')
  @RequirePermission('banking.view')
  @ApiOkResponse({
    description:
      'What moved through the account between two days, with opening, running and closing balances',
  })
  activity(
    @Param('id', id) accountId: string,
    @Query(new ZodValidationPipe(bankActivityQuerySchema))
    q: { from: string; to: string },
    @CurrentTenant() tenant: Tenant,
  ) {
    return this.banking.activity(
      tenant.organizationId,
      accountId,
      q.from,
      q.to,
    );
  }

  @Get('transactions')
  @RequirePermission('banking.view')
  list(
    @Query(new ZodValidationPipe(bankTransactionListQuerySchema))
    q: z.output<typeof bankTransactionListQuerySchema>,
    @CurrentTenant() tenant: Tenant,
  ) {
    return this.banking.list(tenant.organizationId, q);
  }

  @Get('transactions/:id')
  @RequirePermission('banking.view')
  get(@Param('id', id) txId: string, @CurrentTenant() tenant: Tenant) {
    return this.banking.get(tenant.organizationId, txId);
  }

  @Post('money')
  @RequirePermission('banking.manage')
  @ApiOkResponse({
    description:
      'Money spent from or received into a bank or cash account, posted with its tax',
  })
  money(
    @Body(new ZodValidationPipe(bankMoneySchema))
    body: z.output<typeof bankMoneySchema>,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.banking.money(body, { actor, tenant, req });
  }

  @Post('transfers')
  @RequirePermission('banking.manage')
  @ApiOkResponse({
    description:
      'Money moved between two bank or cash accounts, across currencies too',
  })
  transfer(
    @Body(new ZodValidationPipe(bankTransferSchema))
    body: z.output<typeof bankTransferSchema>,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.banking.transfer(body, { actor, tenant, req });
  }

  @Post('transactions/:id/void')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('banking.manage')
  void(
    @Param('id', id) txId: string,
    @Body(new ZodValidationPipe(bankVoidSchema))
    body: z.output<typeof bankVoidSchema>,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.banking.void(txId, body, { actor, tenant, req });
  }

  @Post('statements/preview')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('banking.manage')
  @ApiOkResponse({
    description:
      'What importing the file would bring in: the layout used, its lines, duplicates and rows that can’t be read',
  })
  previewStatement(
    @Body(new ZodValidationPipe(statementImportSchema))
    body: z.output<typeof statementImportSchema>,
    @CurrentTenant() tenant: Tenant,
  ) {
    return this.statements.preview(tenant.organizationId, body);
  }

  @Post('statements/import')
  @RequirePermission('banking.manage')
  @ApiOkResponse({
    description:
      'Brings in the statement’s new lines; a CSV’s layout is remembered for the account',
  })
  importStatement(
    @Body(new ZodValidationPipe(statementImportSchema))
    body: z.output<typeof statementImportSchema>,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.statements.import(body, { actor, tenant, req });
  }

  @Get('statements/imports')
  @RequirePermission('banking.view')
  statementImports(
    @Query(new ZodValidationPipe(z.object({ bankAccountId: z.uuid() })))
    q: { bankAccountId: string },
    @CurrentTenant() tenant: Tenant,
  ) {
    return this.statements.imports(tenant.organizationId, q.bankAccountId);
  }

  @Get('statements/lines')
  @RequirePermission('banking.view')
  statementLines(
    @Query(new ZodValidationPipe(statementLinesQuerySchema))
    q: z.output<typeof statementLinesQuerySchema>,
    @CurrentTenant() tenant: Tenant,
  ) {
    return this.statements.lines(tenant.organizationId, q);
  }

  @Delete('statements/imports/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('banking.manage')
  async undoImport(
    @Param('id', id) importId: string,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    await this.statements.undo(importId, { actor, tenant, req });
  }
}
