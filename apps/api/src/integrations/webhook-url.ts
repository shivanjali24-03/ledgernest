import { BadRequestException } from '@nestjs/common';
import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP, type LookupFunction } from 'node:net';

/** Addresses a webhook must never reach: this machine, private and link-local networks, and the like */
const blocked = new BlockList();
for (const c of [
  '0.0.0.0/8',
  '10.0.0.0/8',
  '100.64.0.0/10',
  '127.0.0.0/8',
  '169.254.0.0/16',
  '172.16.0.0/12',
  '192.0.0.0/24',
  '192.168.0.0/16',
  '198.18.0.0/15',
  '224.0.0.0/4',
  '240.0.0.0/4',
]) {
  const [a, p] = c.split('/');
  blocked.addSubnet(a!, Number(p), 'ipv4');
}
for (const [a, p] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
  ['64:ff9b::', 96],
] as const)
  blocked.addSubnet(a, p, 'ipv6');

/** An IPv4 address written as IPv6 (::ffff:127.0.0.1, or ::ffff:7f00:1 as URL parsing gives it) */
const mappedV4 = (ip: string) => {
  const l = ip.toLowerCase();
  const dotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(l);
  if (dotted) return dotted[1]!;
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(l);
  if (!hex) return null;
  const a = parseInt(hex[1]!, 16);
  const b = parseInt(hex[2]!, 16);
  return `${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`;
};

/** Whether an IP address is local or private (any other text is not an address, so false) */
export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (!v) return false;
  const v4 = v === 6 ? mappedV4(ip) : ip;
  return v4 ? blocked.check(v4, 'ipv4') : blocked.check(ip, 'ipv6');
}

/** DNS lookup for webhook deliveries: refuses a name that resolves to a private address, at connect time */
export const publicOnlyLookup: LookupFunction = (
  hostname,
  options,
  callback,
) => {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, '', 4);
    const list = addresses as unknown as LookupAddress[];
    if (!list.length || list.some((a) => isPrivateAddress(a.address)))
      return callback(
        Object.assign(new Error('The address resolves to a private network.'), {
          code: 'EPRIVATE',
        }),
        '',
        4,
      );
    if ((options as { all?: boolean }).all)
      (callback as unknown as (e: null, a: LookupAddress[]) => void)(
        null,
        list,
      );
    else callback(null, list[0]!.address, list[0]!.family);
  });
};

/**
 * Posts a webhook and gives back the status code. No redirects are followed; in production the connection
 * may only go to a public address (checked on the address actually connected to, so DNS can't be swapped after the check).
 */
export function postWebhook(
  url: string,
  headers: Record<string, string>,
  body: string,
  production = process.env.NODE_ENV === 'production',
): Promise<number> {
  const u = new URL(url);
  const send = u.protocol === 'https:' ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const req = send(
      u,
      {
        method: 'POST',
        headers: { ...headers, 'Content-Length': Buffer.byteLength(body) },
        timeout: 10_000,
        ...(production ? { lookup: publicOnlyLookup } : {}),
      },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      },
    );
    req.on('timeout', () =>
      req.destroy(new Error('The endpoint didn’t answer in 10 seconds.')),
    );
    req.on('error', reject);
    req.end(body);
  });
}

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
    isPrivateAddress(host);
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
