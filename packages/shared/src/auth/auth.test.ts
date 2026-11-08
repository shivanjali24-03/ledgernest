import { describe, expect, it } from 'vitest';
import { loginSchema, passwordProblems, passwordSchema } from './index.js';

describe('password policy', () => {
  it('accepts a strong password', () => {
    expect(passwordProblems('Correct-Horse-9-battery')).toEqual([]);
    expect(passwordSchema.safeParse('Correct-Horse-9-battery').success).toBe(true);
  });

  it('lists every broken rule', () => {
    expect(passwordProblems('short')).toEqual(['too_short', 'needs_uppercase', 'needs_number']);
    expect(passwordProblems('ALLUPPERCASE123')).toEqual(['needs_lowercase']);
    expect(passwordProblems('a'.repeat(129) + 'A1')).toContain('too_long');
  });
});

describe('loginSchema', () => {
  it('normalises the email', () => {
    expect(loginSchema.parse({ email: '  Asha@Example.COM ', password: 'x' }).email).toBe('asha@example.com');
  });

  it('rejects a bad email or empty password', () => {
    expect(loginSchema.safeParse({ email: 'not-an-email', password: 'x' }).success).toBe(false);
    expect(loginSchema.safeParse({ email: 'a@b.co', password: '' }).success).toBe(false);
  });
});
