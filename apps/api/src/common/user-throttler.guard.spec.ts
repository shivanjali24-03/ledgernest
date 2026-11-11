import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { UserThrottlerGuard } from './user-throttler.guard.js';

describe('UserThrottlerGuard', () => {
  const jwt = new JwtService({
    secret: 's'.repeat(32),
    signOptions: { algorithm: 'HS256', issuer: 'ledgernest' },
    verifyOptions: { algorithms: ['HS256'], issuer: 'ledgernest' },
  });
  const guard = new UserThrottlerGuard(
    [{ ttl: 60_000, limit: 300 }],
    {} as never,
    new Reflector(),
    jwt,
  );
  const tracker = (req: object) =>
    (
      guard as unknown as { getTracker: (r: object) => Promise<string> }
    ).getTracker(req);

  it('counts a signed-in request against the person, so people behind one office address each get their own allowance', async () => {
    const a = await jwt.signAsync({ sub: 'user-a' });
    const b = await jwt.signAsync({ sub: 'user-b' });
    expect(
      await tracker({
        ip: '203.0.113.7',
        headers: { authorization: `Bearer ${a}` },
      }),
    ).toBe('user:user-a');
    expect(
      await tracker({
        ip: '203.0.113.7',
        headers: { authorization: `Bearer ${b}` },
      }),
    ).toBe('user:user-b');
  });

  it('counts anything else by address: no token, a forged or expired one, an API key', async () => {
    const forged = await new JwtService({ secret: 'x'.repeat(32) }).signAsync(
      { sub: 'user-a' },
      { issuer: 'ledgernest' },
    );
    const expired = await jwt.signAsync({ sub: 'user-a' }, { expiresIn: -10 });
    expect(await tracker({ ip: '203.0.113.7', headers: {} })).toBe(
      'ip:203.0.113.7',
    );
    for (const t of [forged, expired, 'ln_live_abc'])
      expect(
        await tracker({
          ip: '203.0.113.7',
          headers: { authorization: `Bearer ${t}` },
        }),
      ).toBe('ip:203.0.113.7');
  });
});
