import { BadRequestException } from '@nestjs/common';

const PRIVATE_V4 = [
  /^10\./,
  /^127\./,
  /^0\./,
  /^169\.254\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
];

/**
 * Where a webhook may point. In production: https only, and not this machine or a private network address
 * (so a webhook can't be used to reach inside). Elsewhere http://localhost is allowed, for trying it out.
 */
export function checkWebhookUrl(
  url: string,
  production = process.env.NODE_ENV === 'production',
) {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new BadRequestException({
      message: 'Enter the full address, starting https://.',
      details: { reason: 'url_invalid', field: 'url' },
    });
  }
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const local =
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '::1' ||
    PRIVATE_V4.some((r) => r.test(host)) ||
    /^f[cd][0-9a-f]{2}:/.test(host) ||
    host.startsWith('fe80:');
  if (u.username || u.password)
    throw new BadRequestException({
      message: 'Leave the user name and password out of the address.',
      details: { reason: 'url_credentials', field: 'url' },
    });
  if (production) {
    if (u.protocol !== 'https:')
      throw new BadRequestException({
        message: 'Use an https:// address.',
        details: { reason: 'url_not_https', field: 'url' },
      });
    if (local)
      throw new BadRequestException({
        message: 'Webhooks can’t point at this server or a private network.',
        details: { reason: 'url_private', field: 'url' },
      });
  } else if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) {
    throw new BadRequestException({
      message: 'Use an https:// address.',
      details: { reason: 'url_not_https', field: 'url' },
    });
  }
  return u.toString();
}
