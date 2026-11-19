import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pickBase, type FetchFn } from './connection';

const servers = { publicUrl: 'https://pub.example', localUrls: ['http://192.168.1.5:3000'] };
const ok = (async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '' })) as unknown as FetchFn;
const never = (() => new Promise(() => {})) as unknown as FetchFn;

describe('pickBase', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('returns home when a local url answers', async () => {
    const f = vi.fn(ok);
    expect(await pickBase(servers, f as unknown as FetchFn)).toEqual({ base: 'http://192.168.1.5:3000', where: 'home' });
    expect(f.mock.calls[0][0]).toBe('http://192.168.1.5:3000/api/auth/status');
  });

  it('falls back to away within 1.6s when the local url hangs', async () => {
    const p = pickBase(servers, never);
    await vi.advanceTimersByTimeAsync(1600);
    expect(await p).toEqual({ base: 'https://pub.example', where: 'away' });
  });

  it('is away when there are no local urls', async () => {
    expect(await pickBase({ publicUrl: 'https://pub.example', localUrls: [] }, ok)).toEqual({ base: 'https://pub.example', where: 'away' });
  });

  it('is away when the local url answers with an error status', async () => {
    const bad = (async () => ({ ok: false, status: 500, json: async () => ({}), text: async () => '' })) as unknown as FetchFn;
    expect((await pickBase(servers, bad)).where).toBe('away');
  });

  it('tries all local urls in parallel: first hangs, second answers -> home with the second', async () => {
    const s = { publicUrl: 'https://pub.example', localUrls: ['http://172.17.0.1:3000', 'http://192.168.1.5:3000'] };
    const f = ((url: string) => (url.indexOf('172.17') >= 0 ? never(url) : ok(url))) as unknown as FetchFn;
    const p = pickBase(s, f);
    await vi.advanceTimersByTimeAsync(10);
    expect(await p).toEqual({ base: 'http://192.168.1.5:3000', where: 'home' });
  });

  it('strips a trailing slash from urls', async () => {
    const r = await pickBase({ publicUrl: 'https://pub.example/', localUrls: ['http://h:1/'] }, ok);
    expect(r.base).toBe('http://h:1');
  });
});
