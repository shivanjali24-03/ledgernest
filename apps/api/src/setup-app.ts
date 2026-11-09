import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { tenantContextMiddleware } from './access/tenant-context.js';
import helmet from 'helmet';
import { requestId } from './common/request-id.middleware.js';
import type { Env } from './config/env.js';

/** Shared by main.ts and the end-to-end tests, so tests run the real HTTP setup. */
export function setupApp(app: INestApplication) {
  const config = app.get<ConfigService<Env, true>>(ConfigService);
  // Behind Render's proxy the client's address arrives in X-Forwarded-For; trust exactly that many hops
  const hops = config.get('TRUST_PROXY', { infer: true });
  if (hops > 0) (app.getHttpAdapter().getInstance() as { set(k: string, v: unknown): void }).set('trust proxy', hops);
  app.use(requestId);
  app.use(helmet());
  app.use(cookieParser());
  app.use(tenantContextMiddleware);
  // Exposed so the web app can read the export's file name and the "truncated" flag across origins
  app.enableCors({ origin: config.get('CORS_ORIGINS', { infer: true }), credentials: true, exposedHeaders: ['Content-Disposition', 'X-Truncated'] });
  app.setGlobalPrefix('api/v1');
  app.enableShutdownHooks();

  const doc = new DocumentBuilder()
    .setTitle('LedgerNest API')
    .setDescription('Accounting API: organisations, users, roles, books and reports.')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('docs', app, () => SwaggerModule.createDocument(app, doc));
  return app;
}
