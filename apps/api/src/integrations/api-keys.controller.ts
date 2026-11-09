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
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { apiKeyCreateSchema } from '@ledgernest/shared';
import type { Request } from 'express';
import type { z } from 'zod';
import {
  CurrentActor,
  CurrentTenant,
  RequirePermission,
} from '../access/decorators.js';
import type { Actor, Tenant } from '../access/types.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ApiKeysService } from './api-keys.service.js';

const id = new ParseUUIDPipe({ version: '4' });

/** API keys, for Owners and Admins (integrations.manage). Send one as "Authorization: Bearer lnk_…". */
@ApiTags('integrations')
@ApiBearerAuth()
@ApiHeader({
  name: 'X-Organization-Id',
  required: true,
  description: 'The organisation to act in',
})
@Controller('api-keys')
export class ApiKeysController {
  constructor(private readonly keys: ApiKeysService) {}

  @Get()
  @RequirePermission('integrations.manage')
  list(@CurrentTenant() tenant: Tenant) {
    return this.keys.list(tenant.organizationId);
  }

  @Post()
  @RequirePermission('integrations.manage')
  @ApiOkResponse({
    description:
      'The new key, including the key itself, which is not shown again',
  })
  create(
    @Body(new ZodValidationPipe(apiKeyCreateSchema))
    body: z.output<typeof apiKeyCreateSchema>,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.keys.create(body, { actor, tenant, req });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('integrations.manage')
  async revoke(
    @Param('id', id) keyId: string,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    await this.keys.revoke(keyId, { actor, tenant, req });
  }
}
