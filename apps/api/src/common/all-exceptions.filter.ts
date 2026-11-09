import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';

export interface ErrorBody {
  statusCode: number;
  error: string;
  message: string;
  details?: unknown;
  path: string;
  requestId?: string;
  timestamp: string;
}

/**
 * One error format for the whole API. Expected errors (HttpException) keep their message;
 * anything unexpected becomes a generic 500, logged with the request id but never leaked to the client.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Errors');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();
    const requestId = (req.headers['x-request-id'] as string | undefined) ?? undefined;
    // originalUrl keeps the /api/v1 prefix that Express strips from req.url
    const path = req.originalUrl ?? req.url;

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Something went wrong. Please try again.';
    let details: unknown;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') message = body;
      else if (body && typeof body === 'object') {
        const b = body as { message?: unknown; details?: unknown };
        message = Array.isArray(b.message) ? b.message.join('; ') : typeof b.message === 'string' ? b.message : exception.message;
        details = b.details;
      }
    } else {
      this.logger.error(`[${requestId ?? '-'}] ${req.method} ${path}`, exception instanceof Error ? exception.stack : String(exception));
    }

    const out: ErrorBody = {
      statusCode: status,
      error: HttpStatus[status] ?? 'ERROR',
      message,
      ...(details !== undefined ? { details } : {}),
      path,
      ...(requestId ? { requestId } : {}),
      timestamp: new Date().toISOString(),
    };
    res.status(status).json(out);
  }
}
