import { z } from 'zod';

/** A department, branch or other part of the business; or a project, which has a start and an end */
export const COST_CENTRE_KINDS = ['department', 'project'] as const;
export type CostCentreKind = (typeof COST_CENTRE_KINDS)[number];

export const costCentreSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .min(1, 'Give it a short code.')
    .max(20)
    .regex(/^[A-Z0-9][A-Z0-9._-]*$/, 'Use letters, digits, dots, dashes or underscores.'),
  name: z.string().trim().min(1, 'Name it.').max(120),
  kind: z.enum(COST_CENTRE_KINDS).default('department'),
  description: z
    .string()
    .trim()
    .max(500)
    .transform((v) => v || null)
    .nullable()
    .optional()
    .default(null),
});
export type CostCentreInput = z.input<typeof costCentreSchema>;
