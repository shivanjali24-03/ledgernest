import { z } from 'zod';

/** Password rules, shared by the sign-up / reset forms and the API. */
export const PASSWORD_MIN_LENGTH = 12;

export type PasswordProblem = 'too_short' | 'needs_lowercase' | 'needs_uppercase' | 'needs_number' | 'too_long';

/** Lists every rule the password breaks (empty = strong enough). */
export function passwordProblems(password: string): PasswordProblem[] {
  const problems: PasswordProblem[] = [];
  if (password.length < PASSWORD_MIN_LENGTH) problems.push('too_short');
  if (password.length > 128) problems.push('too_long');
  if (!/[a-z]/.test(password)) problems.push('needs_lowercase');
  if (!/[A-Z]/.test(password)) problems.push('needs_uppercase');
  if (!/\d/.test(password)) problems.push('needs_number');
  return problems;
}

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ message: 'Enter a valid email address.' }))
  .refine((v) => v.length <= 254, 'Email is too long.');

export const passwordSchema = z.string().superRefine((value, ctx) => {
  for (const problem of passwordProblems(value)) ctx.addIssue({ code: 'custom', message: problem });
});

/** Login only checks shape; strength is checked when a password is set, not when it's used. */
export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password.').max(128),
});
export type LoginInput = z.infer<typeof loginSchema>;

/** Asking for a password reset link: only the email (the answer is the same whether it exists or not) */
export const forgotPasswordSchema = z.object({ email: emailSchema });
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

/** Setting a new password from a reset link */
export const resetPasswordSchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{32,128}$/, 'This reset link isn’t valid.'),
  password: passwordSchema,
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

/** Changing your own password while signed in */
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password.').max(128),
    newPassword: passwordSchema,
  })
  .refine((v) => v.currentPassword !== v.newPassword, { message: 'same_password', path: ['newPassword'] });
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

/** How long a reset link works */
export const PASSWORD_RESET_MINUTES = 30;

/** Lockout policy shared so the UI can explain it. */
export const LOCKOUT = { maxFailedAttempts: 5, minutes: 15 } as const;

/** Token lifetimes. */
export const TOKENS = { accessMinutes: 15, refreshDays: 14 } as const;
