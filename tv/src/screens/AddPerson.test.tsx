import { act } from 'preact/test-utils';
import { render } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AddPerson } from './AddPerson';
import { loadState, saveState } from '../profiles';
import type { FetchFn } from '../connection';

const json = (body: unknown, status = 200) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body), text: () => Promise.resolve(JSON.stringify(body)) });

interface Call { url: string; method: string; body: any; auth?: string }

function makeFetch(pollAnswers: any[]) {
  const calls: Call[] = [];
  let pairs = 0;
  const fetchFn: FetchFn = (url, init) => {
    const call: Call = { url, method: (init && init.method) || 'GET', body: init && init.body ? JSON.parse(init.body) : undefined, auth: init && init.headers ? init.headers.Authorization : undefined };
    calls.push(call);
    if (url.endsWith('/api/tv/pair')) {
      pairs++;
      return json({ code: pairs === 1 ? 'AAAA-1111' : 'BBBB-2222', pairId: 'p' + pairs, expiresIn: 600, qr: 'data:image/svg+xml;base64,AAA' });
    }
    if (url.endsWith('/api/tv/pair/poll')) return json(pollAnswers.shift() || { status: 'waiting' });
    if (url.endsWith('/api/auth/status')) return json({ authenticated: true, user: { id: 7, username: 'ann' }, localUrls: ['http://192.168.1.5:7979'] });
    return json({}, 404);
  };
  return { fetchFn, calls };
}

describe('AddPerson', () => {
  let host: HTMLElement;
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    host = document.createElement('div');
    document.body.appendChild(host);
  });
  afterEach(() => {
    act(() => {
      render(null, host);
    });
    host.remove();
    vi.useRealTimers();
  });

  const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
  const mount = async (fetchFn: FetchFn, extra: Record<string, unknown> = {}) => {
    await act(async () => {
      render(<AddPerson base="http://tv.test" publicUrl="https://pub.test" fetchFn={fetchFn} pollMs={2000} {...extra} />, host);
    });
    await tick(0);
  };

  it('shows the code and QR, and sends the device name and public address', async () => {
    const { fetchFn, calls } = makeFetch([]);
    await mount(fetchFn);
    expect(host.textContent).toContain('AAAA-1111');
    expect(host.querySelector('img')!.getAttribute('src')).toBe('data:image/svg+xml;base64,AAA');
    expect(calls[0].body).toEqual({ deviceName: 'Samsung TV', baseUrl: 'https://pub.test' });
  });

  it('makes a new code automatically when the poll says expired', async () => {
    const { fetchFn, calls } = makeFetch([{ status: 'expired' }]);
    await mount(fetchFn);
    expect(host.textContent).toContain('AAAA-1111');
    await tick(2000);
    expect(calls.filter((c) => c.url.endsWith('/api/tv/pair')).length).toBe(2);
    expect(host.textContent).toContain('BBBB-2222');
    expect(host.textContent).not.toContain('AAAA-1111');
  });

  it('after done stores the profile, saves the home address and offers a PIN with Skip focused', async () => {
    const { fetchFn, calls } = makeFetch([{ status: 'done', token: 'tok-abcdefghijklmnopqrstuvwxyz', user: { id: 7, username: 'ann' } }]);
    await mount(fetchFn);
    await tick(2000);
    expect(host.textContent).toContain('Add a PIN to your profile?');
    expect(host.querySelector('.focused')!.textContent).toBe('Skip');
    const s = loadState();
    expect(s.profiles.map((p) => [p.userId, p.username, p.token])).toEqual([[7, 'ann', 'tok-abcdefghijklmnopqrstuvwxyz']]);
    expect(s.servers).toEqual({ publicUrl: 'https://pub.test', localUrls: ['http://192.168.1.5:7979'] });
    const status = calls.filter((c) => c.url.endsWith('/api/auth/status'))[0];
    expect(status.auth).toBe('Bearer tok-abcdefghijklmnopqrstuvwxyz');
  });

  it('adding a PIN asks twice, stores it and finishes', async () => {
    const { fetchFn } = makeFetch([{ status: 'done', token: 'tok-abcdefghijklmnopqrstuvwxyz', user: { id: 7, username: 'ann' } }]);
    const finished = vi.fn();
    await mount(fetchFn, { onFinished: finished });
    await tick(2000);
    const buttons = Array.prototype.slice.call(host.querySelectorAll('button')) as HTMLButtonElement[];
    act(() => buttons.filter((b) => b.textContent === 'Add a PIN')[0].click());
    expect(host.textContent).toContain('Choose a 4-digit PIN');
    const press = (d: string) => act(() => (Array.prototype.slice.call(host.querySelectorAll('.pin-key')) as HTMLButtonElement[]).filter((b) => b.textContent === d)[0].click());
    ['1', '2', '3', '4'].forEach(press);
    expect(host.textContent).toContain('Enter the PIN again');
    ['1', '2', '3', '4'].forEach(press);
    expect(finished).toHaveBeenCalledTimes(1);
    expect(loadState().profiles[0].pin).not.toBeNull();
  });

  it('Skip finishes without a PIN', async () => {
    const { fetchFn } = makeFetch([{ status: 'done', token: 'tok-abcdefghijklmnopqrstuvwxyz', user: { id: 7, username: 'ann' } }]);
    const finished = vi.fn();
    await mount(fetchFn, { onFinished: finished });
    await tick(2000);
    act(() => (host.querySelector('.focused') as HTMLButtonElement).click());
    expect(finished).toHaveBeenCalledTimes(1);
    expect(loadState().profiles[0].pin).toBeNull();
  });

  it('does not copy the signed-out person PIN to a different account', async () => {
    const { fetchFn } = makeFetch([{ status: 'done', token: 'tok-abcdefghijklmnopqrstuvwxyz', user: { id: 8, username: 'bob' } }]);
    const ann = { userId: 7, username: 'ann', token: null, pin: { salt: 's', hash: 'h' }, failedPins: 0, lockedUntil: 0 };
    saveState({ servers: null, profiles: [ann] });
    await mount(fetchFn, { existing: ann, heading: 'Sign in again, ann' });
    await tick(2000);
    expect(host.textContent).toContain('Add a PIN to your profile?');
    const s = loadState();
    expect(s.profiles.filter((x) => x.userId === 8)[0].pin).toBeNull();
    expect(s.profiles.filter((x) => x.userId === 7)[0]).toEqual(ann);
  });
});
