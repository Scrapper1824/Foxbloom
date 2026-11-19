import { act } from 'preact/test-utils';
import { render } from 'preact';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from '../app';
import { saveState, type Profile } from '../profiles';
import { routeFetch, settle } from '../testing';
import { Session } from '../session';
import { Search } from './Search';

const profile: Profile = { userId: 1, username: 'ann', token: 'tok1', pin: null, failedPins: 0, lockedUntil: 0 };
const media = (id: number, title: string, has_file: boolean) => ({ id, type: 'movie', title, year: 2020, poster: null, backdrop: null, overview: null, status: null, has_file, episodeCount: 0, episodeFileCount: 0, season_names: {} });

describe('Search', () => {
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

  it('typing on the keyboard finds downloaded titles by name', async () => {
    saveState({ servers: { publicUrl: 'https://pub.test', localUrls: [] }, profiles: [profile] });
    const { fetchFn } = routeFetch({ '/api/media': [media(1, 'Moonlight', true), media(2, 'Moon Wanted', false), media(3, 'Other', true)] });
    const session = new Session(profile, fetchFn);
    await act(async () => {
      render(<App initial={{ name: 'search', render: () => <Search session={session} /> }} />, host);
    });
    await settle();
    const key = (t: string) => (Array.prototype.slice.call(host.querySelectorAll('.key')) as HTMLButtonElement[]).filter((b) => b.textContent === t)[0];
    'moon'.split('').forEach((c) => act(() => key(c).click()));
    await settle();
    const names = Array.prototype.slice.call(host.querySelectorAll('.tile-title')).map((e: Element) => e.textContent);
    expect(names).toEqual(['Moonlight']);
  });
});
