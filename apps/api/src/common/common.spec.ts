import { BadRequestException, HttpStatus, Logger, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { AllExceptionsFilter } from './all-exceptions.filter.js';
import { ZodValidationPipe } from './zod-validation.pipe.js';

function run(exception: unknown) {
  let status = 0;
  let body: Record<string, unknown> = {};
  const res = { status: (s: number) => ((status = s), res), json: (b: Record<string, unknown>) => (body = b) };
  const host = {
    switchToHttp: () => ({ getRequest: () => ({ url: '/api/v1/x', method: 'GET', headers: { 'x-request-id': 'req-12345678' } }), getResponse: () => res }),
  };
  new AllExceptionsFilter().catch(exception, host as never);
  return { status, body };
}

describe('AllExceptionsFilter', () => {
  it('keeps the message of expected errors', () => {
    const { status, body } = run(new NotFoundException('Organisation not found'));
    expect(status).toBe(HttpStatus.NOT_FOUND);
    expect(body).toMatchObject({ statusCode: 404, error: 'NOT_FOUND', message: 'Organisation not found', path: '/api/v1/x', requestId: 'req-12345678' });
  });

  it('hides the details of unexpected errors (but logs them)', () => {
    const log = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    const { status, body } = run(new Error('connection string with password=secret'));
    expect(log).toHaveBeenCalledOnce();
    log.mockRestore();
    expect(status).toBe(500);
    expect(body.message).toBe('Something went wrong. Please try again.');
    expect(JSON.stringify(body)).not.toContain('secret');
  });

  it('passes validation details through', () => {
    const { body } = run(new BadRequestException({ message: 'Some fields are not valid.', details: [{ field: 'email', message: 'Invalid' }] }));
    expect(body.details).toEqual([{ field: 'email', message: 'Invalid' }]);
  });
});

describe('ZodValidationPipe', () => {
  const pipe = new ZodValidationPipe(z.object({ name: z.string().min(2), age: z.number().int() }));

  it('returns parsed data when valid', () => {
    expect(pipe.transform({ name: 'Asha', age: 30 })).toEqual({ name: 'Asha', age: 30 });
  });

  it('throws a 400 listing every invalid field', () => {
    try {
      pipe.transform({ name: 'A', age: 1.5 });
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(BadRequestException);
      const details = ((e as BadRequestException).getResponse() as { details: { field: string }[] }).details;
      expect(details.map((d) => d.field)).toEqual(['name', 'age']);
    }
  });
});
