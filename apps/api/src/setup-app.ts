import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { json, type NextFunction, type Request, type Response } from 'express';
import { tenantContextMiddleware } from './access/tenant-context.js';
import helmet from 'helmet';
import { requestId } from './common/request-id.middleware.js';
import type { Env } from './config/env.js';

/** Shared by main.ts and the end-to-end tests, so tests run the real HTTP setup. */
export function setupApp(app: INestApplication) {
  const config = app.get<ConfigService<Env, true>>(ConfigService);
  // Behind Render's proxy the client's address arrives in X-Forwarded-For; trust exactly that many hops
  const hops = config.get('TRUST_PROXY', { infer: true });
  if (hops > 0)
    (
      app.getHttpAdapter().getInstance() as { set(k: string, v: unknown): void }
    ).set('trust proxy', hops);
  app.use(requestId);
  // Logo uploads (base64, up to 256 KB) are the one body allowed past the default 100 KB limit.
  // Wrapped in its own function: Nest skips installing its JSON parser if it finds one named "jsonParser".
  const logoJson = json({ limit: '400kb' });
  app.use(
    '/api/v1/organization/logo',
    function logoBodyParser(req: Request, res: Response, next: NextFunction) {
      logoJson(req, res, next);
    },
  );
  // Journal attachments: up to 2 MB, about 2.8 MB as base64
  const attachmentJson = json({ limit: '3mb' });
  app.use(
    /^\/api\/v1\/journals\/[^/]+\/attachments$/,
    function attachmentBodyParser(
      req: Request,
      res: Response,
      next: NextFunction,
    ) {
      attachmentJson(req, res, next);
    },
  );
  // Receipts and PDFs kept with invoices, bills, payments and bank transactions: up to 2 MB as base64
  app.use(
    /^\/api\/v1\/attachments\/[^/]+\/[^/]+$/,
    function documentAttachmentBodyParser(
      req: Request,
      res: Response,
      next: NextFunction,
    ) {
      attachmentJson(req, res, next);
    },
  );
  // Bank statements: files up to 2 MB, sent as text
  const statementJson = json({ limit: '3mb' });
  app.use(
    /^\/api\/v1\/banking\/statements\/(preview|import)$/,
    function statementBodyParser(
      req: Request,
      res: Response,
      next: NextFunction,
    ) {
      statementJson(req, res, next);
    },
  );
  app.use(helmet());
  app.use(cookieParser());
  app.use(tenantContextMiddleware);
  // Exposed so the web app can read the export's file name and the "truncated" flag across origins
  app.enableCors({
    origin: config.get('CORS_ORIGINS', { infer: true }),
    credentials: true,
    exposedHeaders: ['Content-Disposition', 'X-Truncated'],
  });
  app.setGlobalPrefix('api/v1');
  app.enableShutdownHooks();

  const doc = new DocumentBuilder()
    .setTitle('LedgerNest API')
    .setDescription(
      'Accounting API: organisations, users, roles, books and reports.',
    )
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('docs', app, () =>
    SwaggerModule.createDocument(app, doc),
  );
  return app;
}
