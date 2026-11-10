import {
  base32Decode,
  base32Encode,
  hashRecoveryCode,
  newRecoveryCodes,
  openSecret,
  sealSecret,
  totpCode,
  verifyTotp,
} from './totp.js';

// RFC 6238's SHA-1 test secret, "12345678901234567890"
const RFC = base32Encode(Buffer.from('12345678901234567890'));

describe('TOTP', () => {
  it('matches the RFC 6238 test vectors (last 6 digits)', () => {
    expect(RFC).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(base32Decode(RFC).toString()).toBe('12345678901234567890');
    expect(totpCode(RFC, Math.floor(59 / 30))).toBe('287082');
    expect(totpCode(RFC, Math.floor(1111111109 / 30))).toBe('081804');
    expect(totpCode(RFC, Math.floor(1234567890 / 30))).toBe('005924');
    expect(totpCode(RFC, Math.floor(2000000000 / 30))).toBe('279037');
  });

  it('accepts a code a step either side, and nothing else', () => {
    const now = 1_234_567_890_000;
    const step = Math.floor(now / 30_000);
    expect(verifyTotp(RFC, totpCode(RFC, step), now)).toBe(step);
    expect(verifyTotp(RFC, totpCode(RFC, step - 1), now)).toBe(step - 1);
    expect(verifyTotp(RFC, totpCode(RFC, step + 2), now)).toBeNull();
    expect(verifyTotp(RFC, '000000', now)).toBeNull();
  });

  it('keeps the secret sealed, and only the right key opens it', () => {
    const sealed = sealSecret(RFC, 'a'.repeat(40));
    expect(sealed).not.toContain(RFC);
    expect(openSecret(sealed, 'a'.repeat(40))).toBe(RFC);
    expect(() => openSecret(sealed, 'b'.repeat(40))).toThrow();
  });

  it('makes ten different recovery codes, stored only as hashes', () => {
    const { codes, hashes } = newRecoveryCodes();
    expect(new Set(codes).size).toBe(10);
    expect(codes[0]).toMatch(/^[0-9a-f]{4}-[0-9a-f]{4}$/);
    expect(hashRecoveryCode(codes[0]!.toUpperCase().replace('-', ''))).toBe(
      hashes[0],
    );
  });
});
