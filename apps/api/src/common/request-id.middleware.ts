import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

/** Gives every request an id (or keeps the caller's), returned in the X-Request-Id header for tracing. */
export function requestId(req: Request, res: Response, next: NextFunction) {
  const incoming = req.headers['x-request-id'];
  const id = typeof incoming === 'string' && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
  req.headers['x-request-id'] = id;
  res.setHeader('X-Request-Id', id);
  next();
}
