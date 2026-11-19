import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Api, OfflineError, SignedOutError } from './api';
import type { FetchFn } from './connection';
import { loadState, markSignedOut, saveState, upsertProfile, type Profile } from './profiles';

const res = (status: number, body: unknown = {}) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
const fn = (f: (...a: any[]) => unknown) => f as unknown as FetchFn;

describe('Api', () => {
  it('sends auth headers and parses json', async () => {
    const f = vi.fn(async (..._a: any[]) => res(200, { a: 1 }));
    const api = new Api('https://x.example/', 'tok', fn(f));
    expect(await api.get('/api/thing')).toEqual({ a: 1 });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('https://x.example/api/thing');
    expect(init.headers.Authorization).toBe('Bearer tok');
    expect(init.headers['x-requested-with']).toBe('mediarr');
  });

  it('sends a json body', async () => {
    const f = vi.fn(async (..._a: any[]) => res(200, {}));
    await new Api('https://x', 't', fn(f)).send('POST', '/api/y', { n: 1 });
    const init = f.mock.calls[0][1];
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"n":1}');
    expect(init.headers['Content-Type']).toBe('application/json');
  });

  it('throws SignedOutError on 401', async () => {
    const api = new Api('https://x', 't', fn(async () => res(401)));
    await expect(api.get('/api/me')).rejects.toBeInstanceOf(SignedOutError);
  });

  it('throws OfflineError on network failure and on timeout', async () => {
    await expect(new Api('https://x', 't', fn(async () => { throw new TypeError('fail'); })).get('/a')).rejects.toBeInstanceOf(OfflineError);
    vi.useFakeTimers();
    const p = new Api('https://x', 't', fn(() => new Promise(() => {})), 100).get('/a');
    const assertion = expect(p).rejects.toBeInstanceOf(OfflineError);
    await vi.advanceTimersByTimeAsync(150);
    await assertion;
    vi.useRealTimers();
  });

  it('a 200 that is not JSON (a captive portal or another site) is an OfflineError, not a SyntaxError', async () => {
    const html = { ok: true, status: 200, json: async () => { throw new SyntaxError('x'); }, text: async () => '<html>Sign in to Wi-Fi</html>' };
    await expect(new Api('https://x', 't', fn(async () => html)).get('/api/home')).rejects.toBeInstanceOf(OfflineError);
  });

  it('streamUrl resolves relative urls and appends the stream token', () => {
    const api = new Api('https://x.example/', 't');
    expect(api.streamUrl('/api/play/direct/movie/1', 'a b')).toBe('https://x.example/api/play/direct/movie/1?st=a%20b');
    expect(api.streamUrl('/api/p?x=1', 'k')).toBe('https://x.example/api/p?x=1&st=k');
    expect(api.streamUrl('https://other/api/p', 'k')).toBe('https://other/api/p?st=k');
  });
});

describe('401 handling keeps other profiles', () => {
  beforeEach(() => localStorage.clear());
  const p = (userId: number): Profile => ({ userId, username: 'u' + userId, token: 't' + userId, pin: null, failedPins: 0, lockedUntil: 0 });
  it('markSignedOut nulls only that token', () => {
    saveState({ servers: null, profiles: [] });
    upsertProfile(p(1));
    upsertProfile(p(2));
    markSignedOut(1);
    expect(loadState().profiles.map((x) => x.token)).toEqual([null, 't2']);
  });
});
