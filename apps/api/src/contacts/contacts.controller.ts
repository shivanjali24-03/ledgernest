import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOkResponse,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import {
  contactCreateSchema,
  contactListQuerySchema,
  contactUpdateSchema,
  type ContactCreateInput,
  type ContactUpdateInput,
} from '@ledgernest/shared';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import {
  CurrentActor,
  CurrentTenant,
  RequirePermission,
} from '../access/decorators.js';
import type { Actor, Tenant } from '../access/types.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ContactsService } from './contacts.service.js';

const id = new ParseUUIDPipe({ version: '4' });

/** Customers and vendors. Reading needs contacts.view; changes need contacts.manage. */
@ApiTags('contacts')
@ApiBearerAuth()
@ApiHeader({
  name: 'X-Organization-Id',
  required: true,
  description: 'The organisation to act in',
})
@Controller('contacts')
export class ContactsController {
  constructor(private readonly contacts: ContactsService) {}

  @Get()
  @RequirePermission('contacts.view')
  @ApiOkResponse({
    description:
      'Contacts by name; filter by customer or vendor, search name, legal name, email or tax ID',
  })
  list(
    @Query(new ZodValidationPipe(contactListQuerySchema))
    q: z.output<typeof contactListQuerySchema>,
    @CurrentTenant() tenant: Tenant,
  ) {
    return this.contacts.list(tenant.organizationId, q);
  }

  @Get('export')
  @RequirePermission('reports.export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  @ApiProduces('text/csv')
  async exportCsv(
    @Query(new ZodValidationPipe(contactListQuerySchema))
    q: z.output<typeof contactListQuerySchema>,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { page: _p, pageSize: _s, ...filters } = q;
    res.setHeader('Content-Disposition', `attachment; filename="contacts.csv"`);
    return this.contacts.exportCsv(tenant.organizationId, filters, {
      actor,
      tenant,
      req,
    });
  }

  @Get(':id')
  @RequirePermission('contacts.view')
  get(@Param('id', id) contactId: string, @CurrentTenant() tenant: Tenant) {
    return this.contacts.get(tenant.organizationId, contactId);
  }

  @Post()
  @RequirePermission('contacts.manage')
  create(
    @Body(new ZodValidationPipe(contactCreateSchema)) body: ContactCreateInput,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.contacts.create(
      body as Parameters<ContactsService['create']>[0],
      { actor, tenant, req },
    );
  }

  @Patch(':id')
  @RequirePermission('contacts.manage')
  update(
    @Param('id', id) contactId: string,
    @Body(new ZodValidationPipe(contactUpdateSchema)) body: ContactUpdateInput,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.contacts.update(contactId, body, { actor, tenant, req });
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('contacts.manage')
  archive(
    @Param('id', id) contactId: string,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.contacts.archive(contactId, true, { actor, tenant, req });
  }

  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('contacts.manage')
  restore(
    @Param('id', id) contactId: string,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.contacts.archive(contactId, false, { actor, tenant, req });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('contacts.manage')
  async remove(
    @Param('id', id) contactId: string,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    await this.contacts.remove(contactId, { actor, tenant, req });
  }
}
