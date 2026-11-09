import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { gstSlabCreateSchema, gstSlabUpdateSchema, type GstSlabCreateInput, type GstSlabUpdateInput } from '@ledgernest/shared';
import type { Request } from 'express';
import { CurrentActor, RequirePermission } from '../access/decorators.js';
import type { Actor } from '../access/types.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { GstSlabsService } from './gst-slabs.service.js';

const id = new ParseUUIDPipe({ version: '4' });

/** The Super Admin's list of India's GST slabs. Every change is audited. */
@ApiTags('platform')
@ApiBearerAuth()
@Controller('platform/gst-slabs')
export class GstSlabsController {
  constructor(private readonly slabs: GstSlabsService) {}

  @Get()
  @RequirePermission('platform.settings.manage')
  @ApiOkResponse({ description: 'Every GST slab with the dates it applies and how many organisations use it' })
  list() {
    return this.slabs.list();
  }

  @Post()
  @RequirePermission('platform.settings.manage')
  create(@Body(new ZodValidationPipe(gstSlabCreateSchema)) body: GstSlabCreateInput, @CurrentActor() actor: Actor, @Req() req: Request) {
    return this.slabs.create(body as Parameters<GstSlabsService['create']>[0], { actor, req });
  }

  @Patch(':id')
  @RequirePermission('platform.settings.manage')
  update(@Param('id', id) slabId: string, @Body(new ZodValidationPipe(gstSlabUpdateSchema)) body: GstSlabUpdateInput, @CurrentActor() actor: Actor, @Req() req: Request) {
    return this.slabs.update(slabId, body, { actor, req });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('platform.settings.manage')
  async remove(@Param('id', id) slabId: string, @CurrentActor() actor: Actor, @Req() req: Request) {
    await this.slabs.remove(slabId, { actor, req });
  }
}
