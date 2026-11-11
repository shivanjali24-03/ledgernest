import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { createHash } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import { API_KEY_PREFIX } from '@ledgernest/shared';
import { json, type NextFunction, type Request, type Response } from 'express';
import { PrismaService } from './prisma/prisma.service.js';
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
  // The larger bodies below are only read for a signed-in request (a valid access token or a live API key).
  // Anyone else gets the default 100 KB parser, so an anonymous client can't make the server parse
  // megabytes just to be told to sign in.
  const jwt = app.get(JwtService);
  const prisma = app.get(PrismaService);
  const signedIn = async (req: Request) => {
    const [scheme, token] = (req.headers.authorization ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) return false;
    if (token.startsWith(API_KEY_PREFIX))
      return !!(await prisma.apiKey.findFirst({
        where: {
          hash: createHash('sha256').update(token).digest('hex'),
          revokedAt: null,
        },
        select: { id: true },
      }));
    return jwt.verifyAsync(token).then(
      () => true,
      () => false,
    );
  };
  const bigBody = async (
    parser: (req: Request, res: Response, next: NextFunction) => void,
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    if (await signedIn(req)) parser(req, res, next);
    else next();
  };
  // Logo uploads (base64, up to 256 KB) are the one body allowed past the default 100 KB limit.
  // Wrapped in its own function: Nest skips installing its JSON parser if it finds one named "jsonParser".
  const logoJson = json({ limit: '400kb' });
  app.use(
    '/api/v1/organization/logo',
    function logoBodyParser(req: Request, res: Response, next: NextFunction) {
      void bigBody(logoJson, req, res, next);
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
      void bigBody(attachmentJson, req, res, next);
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
      void bigBody(attachmentJson, req, res, next);
    },
  );
  // Restoring a backup: the whole organisation in one file
  const backupJson = json({ limit: '50mb' });
  app.use(
    '/api/v1/backups/restore',
    function backupBodyParser(req: Request, res: Response, next: NextFunction) {
      void bigBody(backupJson, req, res, next);
    },
  );
  // Spreadsheet imports: up to 2,000 rows
  const importJson = json({ limit: '5mb' });
  app.use(
    /^\/api\/v1\/imports\/[^/]+(\/preview)?$/,
    function importBodyParser(req: Request, res: Response, next: NextFunction) {
      void bigBody(importJson, req, res, next);
    },
  );
  // GSTR-2B from the GST portal: JSON files up to 4 MB, sent as text inside JSON (escaping adds a little)
  app.use(
    '/api/v1/reports/gst/gstr-2b',
    function gstr2bBodyParser(req: Request, res: Response, next: NextFunction) {
      void bigBody(importJson, req, res, next);
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
      void bigBody(statementJson, req, res, next);
    },
  );
  // The refresh cookie goes with cross-site requests (SameSite=None in production), so the two endpoints that
  // act on it refuse a browser request from any site but the web app's: no forced sign-out or rotation
  const webOrigins = new Set<string>(
    config.get('CORS_ORIGINS', { infer: true }),
  );
  app.use(
    ['/api/v1/auth/refresh', '/api/v1/auth/logout'],
    function cookieOriginCheck(
      req: Request,
      res: Response,
      next: NextFunction,
    ) {
      const origin = req.headers.origin;
      if (origin && !webOrigins.has(origin)) {
        res
          .status(403)
          .json({ statusCode: 403, message: 'Not allowed from this site.' });
        return;
      }
      next();
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
  // A map of every endpoint is useful while building, and to an attacker in production: opt in there
  const docs = config.get('API_DOCS', { infer: true });
  if (
    docs
      ? docs === 'true'
      : config.get('NODE_ENV', { infer: true }) !== 'production'
  )
    SwaggerModule.setup('docs', app, () =>
      SwaggerModule.createDocument(app, doc),
    );
  return app;
}
