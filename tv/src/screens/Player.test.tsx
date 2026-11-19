import { act } from 'preact/test-utils';
import { render } from 'preact';
import { useEffect } from 'preact/hooks';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App, useNav } from '../app';
import { saveState, type Profile } from '../profiles';
import { settle } from '../testing';
import { Session } from '../session';
import type { FetchFn } from '../connection';
import type { TvPlayer } from '../player/types';
import { playerScreen } from './Player';

const profile: Profile = { userId: 1, username: 'ann', token: 'tok1', pin: null, failedPins: 0, lockedUntil: 0 };
const info = {
  kind: 'movie', id: 5, mediaId: 5, title: 'The Movie', subtitle: null, duration: 1200, audioPreference: null,
  audio: [{ order: 0, language: 'eng', title: null, codec: 'aac', channels: 2, isDefault: true }],
  subtitles: [], segments: {}, position: 0, next: null, prev: null,
};

interface Call { method: string; path: string; body: any }

/** Answers the player's requests and records them (method, path, parsed body). */
function playFetch(start: Record<string, unknown>): { fetchFn: FetchFn; calls: Call[] } {
  const calls: Call[] = [];
  const ok = (body: unknown) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body), text: () => Promise.resolve(JSON.stringify(body)) });
  const fetchFn: FetchFn = (url, init) => {
    const path = url.replace(/^https?:\/\/[^/]+/, '');
    const method = (init && init.method) || 'GET';
    calls.push({ method, path, body: init && init.body ? JSON.parse(init.body) : undefined });
    if (path === '/api/play/movie/5/info') return ok(info);
    if (path === '/api/play/movie/5/start') return ok(start);
    if (path === '/api/play/movie/5/progress' || path.indexOf('/api/play/hls/') === 0) return ok({ ok: true });
    return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({ error: 'Not found' }), text: () => Promise.resolve('') });
  };
  return { fetchFn, calls };
}

/** A player that fails (or opens) as each test says. */
class FakePlayer implements TvPlayer {
  opens: { url: string; startAt: number }[] = [];
  /** One entry per open(): 'ok', 'reject' (open fails) or 'event' (an onError event before playback). */
  script: Array<'ok' | 'reject' | 'event'> = [];
  playing = false;
  closed = 0;
  t = 0;
  private err: (m: string) => void = () => {};
  open(url: string, startAt: number) {
    this.opens.push({ url, startAt });
    const how = this.script[this.opens.length - 1] || 'ok';
    if (how === 'reject') return Promise.reject(new Error('cannot open'));
    if (how === 'event') {
      setTimeout(() => this.err('decoder failed'), 0);
      return new Promise<void>(() => {});
    }
    this.t = startAt;
    return Promise.resolve();
  }
  play() { this.playing = true; }
  pause() { this.playing = false; }
  seek(s: number) { this.t = s; return Promise.resolve(); }
  time() { return this.t; }
  duration() { return 1200; }
  audioTracks() { return [{ index: 1, language: 'eng' }]; }
  setAudio() {}
  onEnded() {}
  onError(cb: (m: string) => void) { this.err = cb; }
  onBuffering() {}
  close() { this.closed++; this.playing = false; }
}

function press(keyCode: number) {
  act(() => {
    document.body.dispatchEvent(Object.assign(new Event('keydown', { cancelable: true, bubbles: true }), { keyCode }));
  });
}

describe('Player', () => {
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

  /** A screen that opens the player straight away, so Back has somewhere to go. */
  const mount = async (fetchFn: FetchFn, player: FakePlayer) => {
    saveState({ servers: { publicUrl: 'https://pub.test', localUrls: [] }, profiles: [profile] });
    const session = new Session(profile, fetchFn);
    let pushed = false;
    function Launcher() {
      const nav = useNav();
      useEffect(() => {
        if (!pushed) nav.push(playerScreen(session, { kind: 'movie', id: 5, title: 'The Movie' }, () => player));
        pushed = true;
      }, []);
      return <p>Launcher</p>;
    }
    await act(async () => {
      render(<App initial={{ name: 'launch', render: () => <Launcher /> }} />, host);
    });
    await settle();
  };
  const starts = (calls: Call[]) => calls.filter((c) => c.path === '/api/play/movie/5/start');

  it('starts the stream with the stream token in the URL', async () => {
    const f = playFetch({ mode: 'direct', url: '/api/play/direct/movie/5', reason: 'ok', streamToken: 'st1' });
    const p = new FakePlayer();
    await mount(f.fetchFn, p);
    const s = starts(f.calls);
    expect(s.length).toBe(1);
    expect(s[0].method).toBe('POST');
    expect(s[0].body).toMatchObject({ audio: 0, subtitle: null, startAt: 0 });
    expect(s[0].body.caps).toMatchObject({ mp4: true, h264: true, switchesAudio: true, forceConvert: false });
    expect(p.opens).toEqual([{ url: 'https://pub.test/api/play/direct/movie/5?st=st1', startAt: 0 }]);
    expect(p.playing).toBe(true);
  });

  it('an error before playback starts asks again with forceConvert', async () => {
    const f = playFetch({ mode: 'direct', url: '/api/play/direct/movie/5', reason: 'ok', streamToken: 'st1' });
    const p = new FakePlayer();
    p.script = ['reject', 'ok'];
    await mount(f.fetchFn, p);
    const s = starts(f.calls);
    expect(s.length).toBe(2);
    expect(s[0].body.caps.forceConvert).toBe(false);
    expect(s[1].body.caps.forceConvert).toBe(true);
    expect(p.playing).toBe(true);
    expect(host.textContent).not.toContain('can’t play');
  });

  it('a second failure says the video can’t play here, with Back', async () => {
    const f = playFetch({ mode: 'direct', url: '/api/play/direct/movie/5', reason: 'ok', streamToken: 'st1' });
    const p = new FakePlayer();
    p.script = ['event', 'reject'];
    await mount(f.fetchFn, p);
    expect(starts(f.calls).length).toBe(2);
    expect(starts(f.calls)[1].body.caps.forceConvert).toBe(true);
    expect(host.textContent).toContain('This video can’t play on this TV.');
    const back = host.querySelector('button.focused') as HTMLButtonElement;
    expect(back && back.textContent).toBe('Back');
    await act(async () => back.click());
    await settle();
    expect(host.textContent).toContain('Launcher');
  });

  it('Back saves the progress and leaves', async () => {
    const f = playFetch({ mode: 'direct', url: '/api/play/direct/movie/5', reason: 'ok', streamToken: 'st1' });
    const p = new FakePlayer();
    await mount(f.fetchFn, p);
    p.t = 42;
    press(10009);
    await settle();
    const put = f.calls.filter((c) => c.method === 'PUT');
    expect(put.length).toBe(1);
    expect(put[0]).toMatchObject({ path: '/api/play/movie/5/progress', body: { position: 42, duration: 1200 } });
    expect(p.closed).toBeGreaterThan(0);
    expect(host.textContent).toContain('Launcher');
  });

  it('leaving a converted stream ends it on the server', async () => {
    const f = playFetch({ mode: 'hls', url: '/api/play/hls/abc/main.m3u8', sessionId: 'abc', reason: 'convert', streamToken: 'st1' });
    const p = new FakePlayer();
    await mount(f.fetchFn, p);
    expect(p.opens[0].url).toBe('https://pub.test/api/play/hls/abc/main.m3u8?st=st1');
    press(10009);
    await settle();
    expect(f.calls.filter((c) => c.method === 'DELETE').map((c) => c.path)).toEqual(['/api/play/hls/abc']);
  });
});
