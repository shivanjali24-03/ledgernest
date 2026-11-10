import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { TOTP } from '@ledgernest/shared';

/**
 * Time-based one-time passwords (RFC 6238, the codes authenticator apps show), and the secret kept encrypted at rest
 * with a key derived from the server's signing secret.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of s.replace(/=+$/, '').toUpperCase()) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error('Not base32');
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new secret: 20 random bytes, as base32 for the app */
export const newTotpSecret = () => base32Encode(randomBytes(20));

export const totpStep = (now = Date.now()) =>
  Math.floor(now / 1000 / TOTP.periodSeconds);

/** The code for a step */
export function totpCode(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const h = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const o = h[h.length - 1]! & 15;
  const n =
    ((h[o]! & 0x7f) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!;
  return String(n % 10 ** TOTP.digits).padStart(TOTP.digits, '0');
}

/** The step a code matches, allowing one step either side for clock drift; null when it matches none */
export function verifyTotp(
  secret: string,
  code: string,
  now = Date.now(),
): number | null {
  const step = totpStep(now);
  for (const s of [step, step - 1, step + 1]) {
    const want = Buffer.from(totpCode(secret, s));
    const got = Buffer.from(code.padEnd(TOTP.digits).slice(0, TOTP.digits));
    if (want.length === got.length && timingSafeEqual(want, got)) return s;
  }
  return null;
}

const key = (serverSecret: string) =>
  createHash('sha256').update(`ledgernest:totp:${serverSecret}`).digest();

/** iv.tag.ciphertext, base64url */
export function sealSecret(secret: string, serverSecret: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(serverSecret), iv);
  const data = Buffer.concat([c.update(secret, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), data]
    .map((b) => b.toString('base64url'))
    .join('.');
}

export function openSecret(sealed: string, serverSecret: string): string {
  const [iv, tag, data] = sealed
    .split('.')
    .map((p) => Buffer.from(p, 'base64url'));
  const d = createDecipheriv('aes-256-gcm', key(serverSecret), iv!);
  d.setAuthTag(tag!);
  return Buffer.concat([d.update(data!), d.final()]).toString('utf8');
}

/** Ten one-time recovery codes, xxxx-xxxx, and how they're stored */
export function newRecoveryCodes(n: number = TOTP.recoveryCodes) {
  const codes = Array.from({ length: n }, () => {
    const s = randomBytes(5).toString('hex').slice(0, 8);
    return `${s.slice(0, 4)}-${s.slice(4)}`;
  });
  return { codes, hashes: codes.map(hashRecoveryCode) };
}
export const hashRecoveryCode = (code: string) =>
  createHash('sha256')
    .update(code.replace(/-/g, '').toLowerCase())
    .digest('hex');
