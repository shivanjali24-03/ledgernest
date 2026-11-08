import type { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import type { Env } from '../config/env.js';
import type { IssuedTokens } from './auth.service.js';
import { REFRESH_COOKIE } from './tokens.js';

// The refresh cookie is httpOnly (JavaScript can't read it) and only sent to /api/v1/auth
const options = (config: ConfigService<Env, true>) =>
  ({
    httpOnly: true,
    secure: config.get('COOKIE_SECURE', { infer: true }),
    sameSite: config.get('COOKIE_SAMESITE', { infer: true }),
    path: '/api/v1/auth',
  }) as const;

export function setRefreshCookie(res: Response, config: ConfigService<Env, true>, tokens: IssuedTokens) {
  res.cookie(REFRESH_COOKIE, tokens.refreshToken, { ...options(config), expires: tokens.refreshExpiresAt });
}

export function clearRefreshCookie(res: Response, config: ConfigService<Env, true>) {
  res.clearCookie(REFRESH_COOKIE, options(config));
}

/** The body every sign-in returns; the refresh token itself only travels in the cookie. */
export const sessionBody = (t: IssuedTokens) => ({ accessToken: t.accessToken, expiresIn: t.expiresIn });
