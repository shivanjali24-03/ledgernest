import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { requestId } from './common/request-id.middleware.js';
import type { Env } from './config/env.js';

/** Shared by main.ts and the end-to-end tests, so tests run the real HTTP setup. */
export function setupApp(app: INestApplication) {
  const config = app.get<ConfigService<Env, true>>(ConfigService);
  app.use(requestId);
  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({ origin: config.get('CORS_ORIGINS', { infer: true }), credentials: true });
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
