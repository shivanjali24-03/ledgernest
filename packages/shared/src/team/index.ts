import { z } from 'zod';
import { ORGANIZATION_PERMISSIONS, type OrganizationPermission } from '../access/permissions.js';
import { CUSTOM_ROLE_RANK, type RoleDefinition } from '../access/roles.js';
import { emailSchema } from '../auth/index.js';

/** Built-in roles that can be given inside an organisation (Super Admin is platform-only). */
export const ORGANIZATION_ROLE_IDS = ['owner', 'admin', 'accountant', 'bookkeeper', 'auditor', 'viewer'] as const;
export type OrganizationRoleId = (typeof ORGANIZATION_ROLE_IDS)[number];

/** A role to give someone: a built-in one or one of the organisation's custom roles. */
export const roleChoiceSchema = z.union([z.object({ builtInRole: z.enum(ORGANIZATION_ROLE_IDS) }).strict(), z.object({ customRoleId: z.uuid() }).strict()]);
export type RoleChoice = z.infer<typeof roleChoiceSchema>;

export const inviteMemberSchema = z.object({ email: emailSchema, role: roleChoiceSchema });
export type InviteMemberInput = z.input<typeof inviteMemberSchema>;

export const changeMemberRoleSchema = z.object({ role: roleChoiceSchema });

export const customRoleSchema = z.object({
  name: z.string().trim().min(2, 'Use 2–40 characters.').max(40, 'Use 2–40 characters.'),
  description: z.string().trim().max(200).nullable().optional(),
  permissions: z
    .array(z.enum(ORGANIZATION_PERMISSIONS as unknown as [OrganizationPermission, ...OrganizationPermission[]]))
    .min(1, 'Choose at least one permission.')
    .transform((ps) => [...new Set(ps)]),
});
export type CustomRoleInput = z.input<typeof customRoleSchema>;

export const customRoleUpdateSchema = customRoleSchema.partial().refine((v) => Object.keys(v).length > 0, 'Nothing to update.');

/** A custom role as the access rules see it: always ranked below Admin. */
export const customRoleDefinition = (id: string, permissions: readonly string[]): RoleDefinition => ({
  id: `custom:${id}`,
  scope: 'organization',
  rank: CUSTOM_ROLE_RANK,
  builtIn: false,
  permissions: permissions as RoleDefinition['permissions'],
});
