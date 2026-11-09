import { createHash, randomBytes } from 'node:crypto';

/** A new opaque refresh token: 48 random bytes, URL-safe. Only its hash is stored. */
export const newRefreshToken = () => randomBytes(48).toString('base64url');

/** SHA-256 is enough here: tokens are long and random, so they can't be guessed or brute-forced. */
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export const REFRESH_COOKIE = 'ln_refresh';
