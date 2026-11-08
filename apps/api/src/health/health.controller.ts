import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { ApiOkResponse, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service.js';

const startedAt = Date.now();

@ApiTags('health')
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /** Liveness and database readiness, for uptime checks and the hosting platform. */
  @Get()
  @ApiOkResponse({ description: 'API and database are up' })
  @ApiServiceUnavailableResponse({ description: 'Database is unreachable' })
  async check(@Res({ passthrough: true }) res: Response) {
    const database = (await this.prisma.isHealthy()) ? 'up' : 'down';
    if (database === 'down') res.status(HttpStatus.SERVICE_UNAVAILABLE);
    return {
      status: database === 'up' ? 'ok' : 'degraded',
      database,
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    };
  }
}
