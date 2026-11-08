import { BadRequestException, type PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';

/**
 * Validates a request body/query with a zod schema (often shared with the web app's forms).
 * Errors come back as 400 with a per-field `details` list.
 */
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;
    throw new BadRequestException({
      message: 'Some fields are not valid.',
      details: result.error.issues.map((i) => ({ field: i.path.join('.') || '(root)', message: i.message })),
    });
  }
}
