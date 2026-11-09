import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { mergeMap, type Observable } from 'rxjs';
import type { AccessRequest } from '../access/types.js';
import { AuditService } from '../audit/audit.service.js';

/** Records every report downloaded (which report, with which dates and options), once the file is ready. */
@Injectable()
export class ExportAuditInterceptor implements NestInterceptor {
  constructor(private readonly audit: AuditService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx
      .switchToHttp()
      .getRequest<
        AccessRequest & { path: string; query: Record<string, unknown> }
      >();
    const match = req.path.match(/\/reports\/(.+)\/export$/);
    if (!match || !req.tenant) return next.handle();
    return next.handle().pipe(
      mergeMap(async (body) => {
        await this.audit.record({
          action: 'org.report.export',
          actorId: req.actor?.userId ?? null,
          organizationId: req.tenant!.organizationId,
          entityType: 'report',
          entityId: match[1]!.replace(/\//g, '.'),
          after: { report: match[1], ...req.query },
          req: req as never,
        });
        return body;
      }),
    );
  }
}
