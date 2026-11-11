import { Body, Controller, Delete, Get, HttpCode, HttpStatus, NotFoundException, Param, Patch, Put, Req, Res, StreamableFile } from '@nestjs/common';
import { z } from 'zod';
import { ApiBearerAuth, ApiHeader, ApiNoContentResponse, ApiOkResponse, ApiProduces, ApiTags } from '@nestjs/swagger';
import { SIGNATURE_IMAGES, signatureUploadSchema, type SignatureImage, type SignatureUpload, logoUploadSchema, organizationDeleteSchema, organizationSettingsSchema, type LogoUpload, type OrganizationDeleteInput, type OrganizationSettingsUpdate } from '@ledgernest/shared';
import type { Request, Response } from 'express';
import { CurrentActor, CurrentTenant, RequirePermission } from '../access/decorators.js';
import type { Actor, Tenant } from '../access/types.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { OrganizationService } from './organization.service.js';

const imageKind = z.enum(SIGNATURE_IMAGES);

@ApiTags('organization')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Organization-Id', required: true, description: 'The organisation to act in' })
@Controller('organization')
export class OrganizationController {
  constructor(private readonly organizations: OrganizationService) {}

  /** The current organisation's settings, and the caller's role and permissions in it. */
  @Get()
  @RequirePermission('org.settings.view')
  @ApiOkResponse({ description: 'Organisation settings, what can no longer change (locks), and your access' })
  async current(@CurrentTenant() tenant: Tenant) {
    return {
      organization: await this.organizations.get(tenant.organizationId),
      access: { role: tenant.role, permissions: [...tenant.permissions], supportAccess: tenant.supportAccess },
    };
  }

  /** Change company details, currency, locale, time zone or fiscal year start. Only changed values are audited. */
  @Patch()
  @RequirePermission('org.settings.manage')
  @ApiOkResponse({ description: 'The updated settings' })
  update(
    @Body(new ZodValidationPipe(organizationSettingsSchema)) body: OrganizationSettingsUpdate,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.organizations.update(body, { actor, tenant, req });
  }

  /** The logo image. Fetched with the access token, so it never needs a public URL. */
  @Get('logo')
  @RequirePermission('org.settings.view')
  @ApiProduces('image/png', 'image/jpeg', 'image/webp')
  async logo(@Res({ passthrough: true }) res: Response) {
    const logo = await this.organizations.logo();
    if (!logo) throw new NotFoundException('This organisation has no logo.');
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    res.setHeader('Last-Modified', logo.updatedAt.toUTCString());
    return new StreamableFile(Buffer.from(logo.data), { type: logo.contentType, length: logo.data.length });
  }

  /** Upload a PNG, JPEG or WebP logo (base64, up to 256 KB). SVG is refused. */
  @Put('logo')
  @RequirePermission('org.settings.manage')
  @ApiOkResponse({ description: 'The updated settings' })
  setLogo(@Body(new ZodValidationPipe(logoUploadSchema)) body: LogoUpload, @CurrentActor() actor: Actor, @CurrentTenant() tenant: Tenant, @Req() req: Request) {
    return this.organizations.setLogo(body, { actor, tenant, req });
  }

  @Delete('logo')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('org.settings.manage')
  @ApiNoContentResponse()
  async removeLogo(@CurrentActor() actor: Actor, @CurrentTenant() tenant: Tenant, @Req() req: Request) {
    await this.organizations.removeLogo({ actor, tenant, req });
  }

  /** The signatory's signature or the seal, as uploaded */
  @Get('images/:kind')
  @RequirePermission('org.settings.view')
  @ApiProduces('image/png', 'image/jpeg')
  async image(@Param('kind', new ZodValidationPipe(imageKind)) kind: SignatureImage, @Res({ passthrough: true }) res: Response) {
    const img = await this.organizations.image(kind);
    if (!img) throw new NotFoundException(`This organisation has no ${kind}.`);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    return new StreamableFile(Buffer.from(img.data), { type: img.contentType, length: img.data.length });
  }

  /** Upload the signature or seal: PNG (transparent background works best) or JPEG, base64, up to 256 KB */
  @Put('images/:kind')
  @RequirePermission('org.settings.manage')
  @ApiOkResponse({ description: 'The updated settings' })
  setImage(@Param('kind', new ZodValidationPipe(imageKind)) kind: SignatureImage, @Body(new ZodValidationPipe(signatureUploadSchema)) body: SignatureUpload, @CurrentActor() actor: Actor, @CurrentTenant() tenant: Tenant, @Req() req: Request) {
    return this.organizations.setImage(kind, body, { actor, tenant, req });
  }

  @Delete('images/:kind')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('org.settings.manage')
  @ApiNoContentResponse()
  async removeImage(@Param('kind', new ZodValidationPipe(imageKind)) kind: SignatureImage, @CurrentActor() actor: Actor, @CurrentTenant() tenant: Tenant, @Req() req: Request) {
    await this.organizations.removeImage(kind, { actor, tenant, req });
  }

  /** Deletes the organisation and all its books, for an Owner who typed its name. Download a backup first. */
  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('org.delete')
  @ApiNoContentResponse({ description: 'The organisation and everything in it are gone' })
  async remove(@Body(new ZodValidationPipe(organizationDeleteSchema)) body: OrganizationDeleteInput, @CurrentActor() actor: Actor, @CurrentTenant() tenant: Tenant, @Req() req: Request) {
    await this.organizations.remove(body.confirmName, { actor, tenant, req });
  }
}
