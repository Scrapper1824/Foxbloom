import { act } from 'preact/test-utils';
import { render } from 'preact';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from '../app';
import { Profiles } from './Profiles';
import { loadState, saveState, type Profile } from '../profiles';
import { setPin } from '../pin';
import type { FetchFn } from '../connection';

const p = (userId: number, extra: Partial<Profile> = {}): Profile => ({ userId, username: 'user' + userId, token: 'tok' + userId, pin: null, failedPins: 0, lockedUntil: 0, ...extra });
const resp = (body: unknown) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body), text: () => Promise.resolve(JSON.stringify(body)) });
const fetchFn: FetchFn = (url) => (url.endsWith('/api/tv/pair') ? resp({ code: 'CODE-1', pairId: 'x', expiresIn: 600, qr: 'data:,' }) : resp({ status: 'waiting' }));

describe('Profiles', () => {
  let host: HTMLElement;
  beforeEach(() => {
    localStorage.clear();
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
});
