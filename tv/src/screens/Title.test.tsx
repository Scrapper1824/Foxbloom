import { act } from 'preact/test-utils';
import { render } from 'preact';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from '../app';
import { saveState, type Profile } from '../profiles';
import { routeFetch, settle } from '../testing';
import { Session } from '../session';
import type { FetchFn } from '../connection';
import { Title } from './Title';

const profile: Profile = { userId: 1, username: 'ann', token: 'tok1', pin: null, failedPins: 0, lockedUntil: 0 };
const ep = (id: number, season: number, episode: number, has = true) => ({ id, season, episode, title: 'Ep ' + episode, air_date: null, overview: null, has_file: has, aired: true });
const show = {
  id: 5, type: 'show', title: 'The Show', year: 2019, poster: null, backdrop: null, overview: 'A show.', status: null, has_file: true,
  episodeCount: 4, episodeFileCount: 3, season_names: {},
  episodes: [ep(51, 1, 1), ep(52, 1, 2), ep(53, 2, 1), ep(54, 2, 2, false)],
  play: { kind: 'episode', id: 52, label: 'S01E02', episodeTitle: 'Ep 2', resume: false, minutesLeft: null },
};
const progress = { '51': { position: 0, duration: 0, watched: true }, '52': { position: 10, duration: 100, watched: false } };

describe('Title', () => {
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
    const session = new Session(profile, fetchFn);
    await act(async () => {
      render(<App initial={{ name: 'title', render: () => <Title session={session} mediaId={5} /> }} />, host);
    });
    await settle();
  };
  const button = (text: string) => (Array.prototype.slice.call(host.querySelectorAll('button')) as HTMLButtonElement[]).filter((b) => b.textContent!.indexOf(text) >= 0)[0];

  it('lists the seasons of a show and marks watched episodes', async () => {
    await mount(routeFetch({ '/api/media/5': show, '/api/play/progress/5': progress }).fetchFn);
    const seasons = Array.prototype.slice.call(host.querySelectorAll('.season-chip')).map((e: Element) => e.textContent);
    expect(seasons).toEqual(['Season 1', 'Season 2']);
    const rows = host.querySelectorAll('.episode');
    expect(rows.length).toBe(2); // season 1 is open: it holds the episode Play starts
    expect(rows[0].classList.contains('watched')).toBe(true);
    expect(rows[0].textContent).toContain('Watched');
    expect(rows[1].classList.contains('watched')).toBe(false);
    await act(async () => button('Season 2').click());
    await settle();
    expect(host.querySelectorAll('.episode').length).toBe(2);
    expect(host.querySelectorAll('.episode.missing').length).toBe(1);
  });

  it('Play hands the item to the player', async () => {
    const rf = routeFetch({ '/api/media/5': show, '/api/play/progress/5': progress }); await mount(rf.fetchFn); if (!host.querySelector('.season-chip')) throw new Error(JSON.stringify(rf.calls) + host.innerHTML);
    expect(button('Play').textContent).toContain('S1 E2');
    await act(async () => button('Play').click());
    await settle();
    expect(host.querySelector('.player')).not.toBeNull();
    expect(rf.calls).toContain('/api/play/episode/52/info');
  });
});
