import { act } from 'preact/test-utils';
import { render } from 'preact';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from '../app';
import { focusElement } from '../focus';
import { holdingMenuFocus } from '../restore';
import { loadState, saveState, type Profile } from '../profiles';
import { routeFetch, settle } from '../testing';
import type { FetchFn } from '../connection';
import type { HomeData, PlayableTitle } from '../types';
import { homeScreen } from './Home';

const profile: Profile = { userId: 1, username: 'ann', token: 'tok1', pin: null, failedPins: 0, lockedUntil: 0 };
const title = (id: number, name: string, extra: Partial<PlayableTitle> = {}): PlayableTitle => ({
  mediaId: id,
  type: 'movie',
  title: name,
  year: 2020,
  poster: 'https://image.tmdb.org/t/p/w500/p' + id + '.jpg',
  backdrop: 'https://image.tmdb.org/t/p/w1280/b' + id + '.jpg',
  overview: 'About ' + name,
  episodeFiles: 0,
  play: { kind: 'movie', id: id, label: null, episodeTitle: null, resume: false, position: 0, duration: 0, minutesLeft: null },
  ...extra,
});
const home = (extra: Partial<HomeData> = {}): HomeData => ({
  featured: [],
  continue: [
    {
      ...title(7, 'Resume Me'),
      kind: 'episode',
      id: 70,
      label: 'S01E05',
      episodeTitle: 'Five',
      resume: true,
      position: 300,
      duration: 1200,
      minutesLeft: 15,
      upNext: false,
      still: null,
    },
  ],
  recent: [title(2, 'Recent One'), title(3, 'Recent Two')],
  libraries: { movie: [title(2, 'Recent One')], show: [], anime: [] },
  ...extra,
});
const detail = {
  id: 2, type: 'movie', title: 'Recent One', year: 2020, poster: null, backdrop: null, overview: 'About', status: null, has_file: true,
  episodeCount: 0, episodeFileCount: 0, season_names: {}, episodes: [], play: { kind: 'movie', id: 2, label: null, episodeTitle: null, resume: false, minutesLeft: null },
};

describe('Home', () => {
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
  const mount = async (fetchFn: FetchFn) => {
    saveState({ servers: { publicUrl: 'https://pub.test', localUrls: [] }, profiles: [profile] });
    await act(async () => {
      render(<App initial={homeScreen(profile, fetchFn)} />, host);
    });
    await settle();
  };
  const press = (keyCode: number) =>
    act(async () => {
      window.dispatchEvent(Object.assign(new Event('keydown', { cancelable: true }), { keyCode }));
    });
  const rowTitles = () => Array.prototype.slice.call(host.querySelectorAll('.row-title')).map((e: Element) => e.textContent);

  it('shows Continue watching first and a hero for its first item', async () => {
    const { fetchFn } = routeFetch({ '/api/home': home(), '/api/auth/status': {} });
    await mount(fetchFn);
    expect(rowTitles()[0]).toBe('Continue watching');
    const hero = host.querySelector('.hero')!;
    expect(hero.textContent).toContain('Resume Me');
    expect(hero.textContent).toContain('Resume');
    expect(hero.textContent).toContain('15 min left');
  });

  it('OK on a poster opens the title page', async () => {
    const { fetchFn, calls } = routeFetch({ '/api/home': home(), '/api/auth/status': {}, '/api/media/2': detail, '/api/play/progress/2': {} });
    await mount(fetchFn);
    const tile = host.querySelector('[data-key="recent:0"]') as HTMLElement;
    expect(tile.textContent).toContain('Recent One');
    const img = tile.querySelector('img')!;
    expect(img.getAttribute('src')).toContain('/w342/');
    expect(img.getAttribute('loading')).toBe('lazy');
    await act(async () => {
      focusElement(tile, host);
    });
    await press(13);
    await settle();
    expect(calls).toContain('/api/media/2');
    expect(host.querySelector('.title-page')).not.toBeNull();
  });

  it('renders only the visible tiles plus 4 either side of a long row', async () => {
    const many = Array.from({ length: 40 }, (_, i) => title(100 + i, 'T' + i));
    const { fetchFn } = routeFetch({ '/api/home': home({ recent: many }), '/api/auth/status': {} });
    await mount(fetchFn);
    expect(host.querySelectorAll('[data-row="recent"]').length).toBe(7 + 4);
  });

  it('shows the update notice only when the server version is newer', async () => {
    const notice = 'A TV app update is ready — run Foxbloom TV Setup on your PC';
    await mount(routeFetch({ '/api/home': home(), '/api/auth/status': { version: '99.0.0' } }).fetchFn);
    expect(host.textContent).toContain(notice);
    act(() => {
      render(null, host);
    });
    await mount(routeFetch({ '/api/home': home(), '/api/auth/status': { version: __APP_VERSION__ } }).fetchFn);
    expect(host.textContent).not.toContain(notice);
  });

  it('the top menu shows the person’s picture from the server and keeps it with the profile', async () => {
    await mount(routeFetch({ '/api/home': home(), '/api/auth/status': { user: { avatar: '/api/avatars/xyz' } } }).fetchFn);
    const img = host.querySelector('.nav-person img.avatar') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('https://pub.test/api/avatars/xyz');
    expect(loadState().profiles[0].avatar).toBe('/api/avatars/xyz');
  });

  it('signed out: marks the profile signed out and goes to Who is watching', async () => {
    const { fetchFn } = routeFetch({ '/api/home': 401, '/api/auth/status': {} });
    await mount(fetchFn);
    expect(host.textContent).toContain("Who's watching?");
    expect(loadState().profiles[0].token).toBeNull();
  });

  it('offline shows a plain message with Retry', async () => {
    const { fetchFn } = routeFetch({ '/api/home': new TypeError('down'), '/api/auth/status': {} });
    await mount(fetchFn);
    expect(host.textContent).toContain("Can't reach Foxbloom");
    expect(Array.prototype.some.call(host.querySelectorAll('button'), (b: HTMLElement) => b.textContent === 'Retry')).toBe(true);
  });

  it('choosing a menu button keeps the focus on it after the new page loads; Down then goes into the page', async () => {
    const { fetchFn } = routeFetch({ '/api/home': home(), '/api/auth/status': {}, '/api/library': [] });
    await mount(fetchFn);
    const navBtn = (t: string) => (Array.prototype.slice.call(host.querySelectorAll('.nav-btn')) as HTMLElement[]).filter((b) => b.textContent === t)[0];
    await act(async () => {
      focusElement(navBtn('Search'), host);
    });
    await press(13);
    await settle();
    expect(host.querySelector('.search-body')).not.toBeNull();
    expect(host.querySelector('.focused')).toBe(navBtn('Search'));
    await act(async () => {
      focusElement(navBtn('Home'), host);
    });
    await press(13);
    await settle();
    expect(host.querySelector('.hero')).not.toBeNull();
    expect(host.querySelector('.focused')).toBe(navBtn('Home'));
    // jsdom has no layout, so the move itself is checked on screen; here: the first arrow press lets go of the menu.
    await press(40);
    expect(holdingMenuFocus()).toBe(false);
  });

  it('Back from a title page returns focus to the tile that was focused', async () => {
    const { fetchFn } = routeFetch({ '/api/home': home(), '/api/auth/status': {}, '/api/media/3': { ...detail, id: 3 }, '/api/play/progress/3': {} });
    await mount(fetchFn);
    await act(async () => {
      focusElement(host.querySelector('[data-key="recent:1"]') as HTMLElement, host);
    });
    await press(13);
    await settle();
    expect(host.querySelector('.title-page')).not.toBeNull();
    await press(10009);
    await settle();
    expect(host.querySelector('.title-page')).toBeNull();
    expect(host.querySelector('.focused')!.getAttribute('data-key')).toBe('recent:1');
  });
});
