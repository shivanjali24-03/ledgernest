import { servableImageType } from '../common/servable-image.js';
import { Controller, Get, Param, Res, StreamableFile } from '@nestjs/common';
import { ApiProduces, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Public } from '../access/decorators.js';
import { InvoiceShareService } from './invoice-share.service.js';

/**
 * Invoices opened from a shared link, without signing in. The random token in the address is the only key, so
 * these are rate-limited, never cached by shared caches, and kept out of search engines.
 */
@ApiTags('public')
@Public()
@Throttle({ default: { ttl: 60_000, limit: 60 } })
@Controller('public/invoices')
export class PublicInvoicesController {
  constructor(private readonly share: InvoiceShareService) {}

  @Get(':token')
  async view(
    @Param('token') token: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    return this.share.view(token);
  }

  @Get(':token/pdf')
  @ApiProduces('application/pdf')
  async pdf(
    @Param('token') token: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const f = await this.share.pdf(token);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    return new StreamableFile(f.data, {
      type: 'application/pdf',
      disposition: `attachment; filename="${f.fileName}"`,
      length: f.data.length,
    });
  }

  @Get(':token/logo')
  async logo(
    @Param('token') token: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const logo = await this.share.logo(token);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    // Shown by the web app, which lives on another origin
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    return new StreamableFile(Buffer.from(logo.data), {
      type: servableImageType(logo.data),
      length: logo.data.length,
    });
  }
}
