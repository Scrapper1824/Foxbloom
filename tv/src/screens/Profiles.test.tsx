import { act } from 'preact/test-utils';
import { render } from 'preact';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from '../app';
import { Profiles } from './Profiles';
import { loadState, saveState, type Profile } from '../profiles';
import { setPin } from '../pin';
import { settle } from '../testing';
import type { FetchFn } from '../connection';

const p = (userId: number, extra: Partial<Profile> = {}): Profile => ({ userId, username: 'user' + userId, token: 'tok' + userId, pin: null, failedPins: 0, lockedUntil: 0, ...extra });
const resp = (body: unknown) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body), text: () => Promise.resolve(JSON.stringify(body)) });
let seen: Array<{ url: string; auth?: string }> = [];
let failLogout = false;
const fetchFn: FetchFn = (url, init) => {
  seen.push({ url, auth: init && init.headers ? init.headers.Authorization : undefined });
  if (url.endsWith('/api/auth/logout')) return failLogout ? Promise.reject(new TypeError('offline')) : resp({ ok: true });
  return fetchBase(url);
};
const fetchBase: (url: string) => ReturnType<FetchFn> = (url) => url.endsWith('/api/auth/status') ? resp({ setupRequired: false }) : (url.endsWith('/api/tv/pair') ? resp({ code: 'CODE-1', pairId: 'x', expiresIn: 600, qr: 'data:,' }) : resp({ status: 'waiting' }));

describe('Profiles', () => {
  let host: HTMLElement;
  beforeEach(() => {
    localStorage.clear();
    seen = [];
    failLogout = false;
    host = document.createElement('div');
    document.body.appendChild(host);
  });
  afterEach(() => {
    act(() => {
      render(null, host);
    });
    host.remove();
  });
  const mount = async (profiles: Profile[]) => {
    saveState({ servers: { publicUrl: 'https://pub.test', localUrls: [] }, profiles });
    await act(async () => {
      render(<App initial={{ name: 'profiles', render: () => <Profiles fetchFn={fetchFn} /> }} />, host);
    });
  };
  const button = (text: string) => (Array.prototype.slice.call(host.querySelectorAll('button')) as HTMLButtonElement[]).filter((b) => b.textContent === text)[0];

  it('shows a lock only on a profile with a PIN, plus an Add person tile', async () => {
    await mount([p(1, { pin: { salt: 's', hash: 'h' } }), p(2)]);
    const tiles = host.querySelectorAll('.profile-tile:not(.add)');
    expect(tiles.length).toBe(2);
    expect(tiles[0].querySelector('.lock')).not.toBeNull();
    expect(tiles[1].querySelector('.lock')).toBeNull();
    expect(host.querySelector('.profile-tile.add')!.textContent).toContain('Add person');
  });

  it('removes a profile without asking for its PIN', async () => {
    await mount([p(1, { pin: { salt: 's', hash: 'h' } }), p(2)]);
    await act(async () => (host.querySelector('.profile-more') as HTMLButtonElement).click());
    await act(async () => button('Remove').click());
    expect(host.textContent).not.toContain('PIN for');
    expect(loadState().profiles.map((x) => x.userId)).toEqual([2]);
    expect(host.querySelectorAll('.profile-tile:not(.add)').length).toBe(1);
  });

  it('a signed-out profile opens Add person with a sign in again heading', async () => {
    await mount([p(1, { token: null })]);
    await act(async () => (host.querySelector('.profile-tile:not(.add)') as HTMLButtonElement).click());
    expect(host.textContent).toContain('Sign in again, user1');
  });

  it('a PIN profile asks for the PIN before opening', async () => {
    await mount([setPin(p(1), '4321')]);
    await act(async () => (host.querySelector('.profile-tile:not(.add)') as HTMLButtonElement).click());
    expect(host.textContent).toContain('PIN for user1');
  });

  it('Remove signs the profile out on the server with its own token', async () => {
    await mount([p(1), p(2)]);
    await act(async () => (host.querySelector('.profile-more') as HTMLButtonElement).click());
    await act(async () => button('Remove').click());
    const out = seen.filter((c) => c.url.endsWith('/api/auth/logout'));
    expect(out.length).toBe(1);
    expect(out[0].auth).toBe('Bearer tok1');
    expect(loadState().profiles.map((x) => x.userId)).toEqual([2]);
  });

  it('Remove still removes the profile when the sign-out request fails', async () => {
    failLogout = true;
    await mount([p(1)]);
    await act(async () => (host.querySelector('.profile-more') as HTMLButtonElement).click());
    await act(async () => button('Remove').click());
    expect(loadState().profiles).toEqual([]);
  });

  it('Change server keeps the saved home addresses when the server lists none', async () => {
    await mount([p(1)]);
    saveState({ servers: { publicUrl: 'https://pub.test', localUrls: ['http://192.168.1.5:7979'] }, profiles: [p(1)] });
    await act(async () => button('Change server').click());
    await act(async () => button('Connect').click());
    await settle();
    expect(host.textContent).toContain("Who's watching?");
    expect(loadState().servers).toEqual({ publicUrl: 'https://pub.test', localUrls: ['http://192.168.1.5:7979'] });
  });

  it('Connect gives a public HTTPS address as its example', async () => {
    await mount([p(1)]);
    await act(async () => button('Change server').click());
    expect(host.textContent).toContain('https://foxbloom.example.com');
    expect(host.textContent).not.toContain('192.168.');
  });

  it('Change server opens Connect with the current address, and a new address keeps the profiles', async () => {
    await mount([p(1), p(2)]);
    await act(async () => button('Change server').click());
    const input = host.querySelector('.field-input') as HTMLInputElement;
    expect(input.value).toBe('https://pub.test');
    const key = (t: string) => (Array.prototype.slice.call(host.querySelectorAll('.key')) as HTMLButtonElement[]).filter((b) => b.textContent === t)[0];
    for (let i = 0; i < 4; i++) act(() => key('Delete').click());
    act(() => key('t').click());
    act(() => key('v').click());
    expect(input.value).toBe('https://pub.tv');
    await act(async () => button('Connect').click());
    await settle();
    expect(host.textContent).toContain("Who's watching?");
    expect(loadState().servers!.publicUrl).toBe('https://pub.tv');
    expect(loadState().profiles.map((x) => x.userId)).toEqual([1, 2]);
  });
});
