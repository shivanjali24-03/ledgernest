import { BASE, ME, fakeApi } from '../test/fakeApi';
import { ApiError, createAuthClient } from './client';

const setup = (opts?: Parameters<typeof fakeApi>[0]) => {
  const api = fakeApi(opts);
  return { api, client: createAuthClient(BASE, api.fetch) };
};

const errorOf = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e as ApiError);

describe('auth client', () => {
  it('signs in and sends the access token on later requests', async () => {
    const { api, client } = setup();
    await client.login(ME.user.email, 'Right-Password-1');
    expect(await client.me()).toEqual(ME);
    const [, init] = api.fetch.mock.calls.at(-1)!;
    expect(new Headers(init!.headers).get('Authorization')).toBe('Bearer a1');
  });

  it('always sends cookies, so the refresh token reaches the API', async () => {
    const { api, client } = setup();
    await client.login(ME.user.email, 'Right-Password-1');
    await client.refresh();
    for (const [, init] of api.fetch.mock.calls) expect(init!.credentials).toBe('include');
  });

  it.each([
    [401, 'invalid_credentials', undefined],
    [423, 'locked', 12],
    [403, 'suspended', undefined],
    [429, 'rate_limited', undefined],
    [400, 'validation', undefined],
    [500, 'server', undefined],
  ] as const)('maps a %i on sign-in to "%s"', async (status, kind, minutes) => {
    const { api, client } = setup();
    if (status !== 401) api.state.loginStatus = { status, body: { message: 'x', details: minutes ? { retryAfterMinutes: minutes } : undefined } };
    const e = await errorOf(client.login(ME.user.email, 'Wrong-1'));
    expect(e).toBeInstanceOf(ApiError);
    expect(e!.kind).toBe(kind);
    expect(e!.retryAfterMinutes).toBe(minutes);
  });

  it('reports a network failure as "network"', async () => {
    const { api, client } = setup();
    api.state.networkDown = true;
    expect((await errorOf(client.login(ME.user.email, 'x')))!.kind).toBe('network');
  });

  it('refreshes once and retries when the access token has expired', async () => {
    const { api, client } = setup();
    await client.login(ME.user.email, 'Right-Password-1');
    api.expireAccessTokens();
    expect(await client.me()).toEqual(ME);
    expect(api.calls('/auth/refresh')).toBe(1);
  });

  it('shares one refresh between requests that fail at the same time', async () => {
    const { api, client } = setup();
    await client.login(ME.user.email, 'Right-Password-1');
    api.expireAccessTokens();
    await Promise.all([client.me(), client.me(), client.me()]);
    expect(api.calls('/auth/refresh')).toBe(1);
  });

  it('tells listeners when the session is gone for good', async () => {
    const { api, client } = setup();
    const lost = vi.fn();
    client.onSessionLost(lost);
    await client.login(ME.user.email, 'Right-Password-1');
    api.revokeSession();
    expect((await errorOf(client.me()))!.kind).toBe('session_expired');
    expect(lost).toHaveBeenCalledTimes(1);
  });

  it('refresh resolves false when there is no session cookie', async () => {
    const { client } = setup();
    expect(await client.refresh()).toBe(false);
  });

  it('waits and tries again when refresh is rate limited, instead of losing the session', async () => {
    const calls: number[] = [];
    const responses = [new Response('{}', { status: 429, headers: { 'Retry-After': '0' } }), new Response(JSON.stringify({ accessToken: 'tok', expiresIn: 900 }), { status: 200 })];
    const client = createAuthClient(BASE, async () => (calls.push(1), responses.shift()!));
    expect(await client.refresh()).toBe(true);
    expect(calls).toHaveLength(2);
  });

  it('logout forgets the access token even if the network fails', async () => {
    const { api, client } = setup();
    await client.login(ME.user.email, 'Right-Password-1');
    api.state.networkDown = true;
    await expect(client.logout()).rejects.toBeInstanceOf(ApiError);
    api.state.networkDown = false;
    await client.me().catch(() => {});
    const [, init] = api.fetch.mock.calls.find(([url, i]) => String(url).endsWith('/auth/me') && i)!;
    expect(new Headers(init!.headers).get('Authorization')).toBeNull();
  });
});
