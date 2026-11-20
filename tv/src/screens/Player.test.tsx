import { act } from 'preact/test-utils';
import { render } from 'preact';
import { useEffect } from 'preact/hooks';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App, useNav } from '../app';
import { saveState, type Profile } from '../profiles';
import { setPref } from '../prefs';
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
function playFetch(start: Record<string, unknown>, opts: { info?: unknown; pendingAfter?: number } = {}): { fetchFn: FetchFn; calls: Call[] } {
  const calls: Call[] = [];
  const ok = (body: unknown) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body), text: () => Promise.resolve(JSON.stringify(body)) });
  const fetchFn: FetchFn = (url, init) => {
    const path = url.replace(/^https?:\/\/[^/]+/, '');
    const method = (init && init.method) || 'GET';
    calls.push({ method, path, body: init && init.body ? JSON.parse(init.body) : undefined });
    if (path === '/api/play/movie/5/info') return ok(opts.info || info);
    if (path === '/api/play/movie/5/start') {
      // After `pendingAfter` answers, /start never answers (a restart still in progress).
      if (opts.pendingAfter !== undefined && calls.filter((c) => c.path === path).length > opts.pendingAfter) return new Promise(() => {});
      return ok(start);
    }
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
  /** Like some TVs: seekTo "succeeds" but the video stays where it was. */
  ignoreSeeks = false;
  seeks: number[] = [];
  /** Like AVPlay on a file it thinks can't be jumped in: every seekTo reports PLAYER_ERROR_INVALID_STATE. */
  refuseSeeks = false;
  seek(s: number) {
    this.seeks.push(s);
    if (this.refuseSeeks) return Promise.resolve(false);
    if (!this.ignoreSeeks) this.t = s;
    return Promise.resolve(true);
  }
  time() { return this.t; }
  duration() { return 1200; }
  audioTracks() { return [{ index: 1, language: 'eng' }]; }
  setAudio() {}
  onEnded() {}
  onError(cb: (m: string) => void) { this.err = cb; }
  /** An error event from the player, as AVPlay sends one mid-playback. */
  fail() { this.err('decoder failed'); }
  onBuffering() {}
  private paused: () => void = () => {};
  onPaused(cb: () => void) { this.paused = cb; }
  /** The player paused on its own (the Android app went to the background). */
  pauseItself() { this.playing = false; this.paused(); }
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

  const wait = (ms: number) => act(() => new Promise<void>((r) => setTimeout(r, ms)));
  const clockText = () => host.querySelector('.player-clock')!.textContent;

  it('Right on the bar jumps 10 s once you stop pressing, and stays there', async () => {
    const f = playFetch({ mode: 'direct', url: '/api/play/direct/movie/5', reason: 'ok', streamToken: 'st1' });
    const p = new FakePlayer();
    await mount(f.fetchFn, p);
    p.t = 100;
    await wait(400); // the on-screen clock catches up (it reads the player every 250 ms)
    press(39);
    await wait(2400);
    expect(p.seeks).toEqual([110]);
    expect(clockText()).toBe('1:50');
    expect(starts(f.calls).length).toBe(1); // no restart needed
  });

  it('a jump the TV ignores restarts the stream at the chosen time instead of snapping back', async () => {
    const f = playFetch({ mode: 'hls', url: '/api/play/hls/s1/main.m3u8', sessionId: 's1', reason: 'convert', streamToken: 'st1' });
    const p = new FakePlayer();
    p.ignoreSeeks = true;
    await mount(f.fetchFn, p);
    p.t = 100;
    await wait(400); // the on-screen clock catches up (it reads the player every 250 ms)
    press(39);
    await wait(900);
    expect(clockText()).toBe('1:50'); // the bar stays on the chosen time while the jump is checked
    await wait(1600);
    await settle();
    const s = starts(f.calls);
    expect(s.length).toBe(2);
    expect(s[1].body.startAt).toBe(110);
    expect(p.opens[1].startAt).toBe(110);
    expect(clockText()).toBe('1:50');
  });

  it('holding Right shows the preview thumbnail of the chosen moment above the bar', async () => {
    const tp = { interval: 10, width: 320, height: 180, columns: 10, rows: 10, count: 120, sheets: 2 };
    const f = playFetch({ mode: 'direct', url: '/api/play/direct/movie/5', reason: 'ok', streamToken: 'st1' }, { info: Object.assign({}, info, { trickplay: tp }) });
    const p = new FakePlayer();
    await mount(f.fetchFn, p);
    expect(host.querySelector('.player-preview')).toBeNull();
    p.t = 100;
    await wait(400);
    press(39);
    const box = host.querySelector('.player-preview') as HTMLElement;
    expect(box).not.toBeNull();
    // 110 s = thumbnail 11: sheet 0, column 1, row 1.
    expect(box.style.backgroundImage).toContain('https://pub.test/api/play/movie/5/trickplay/0.jpg?st=st1');
    expect(box.style.backgroundPosition).toBe('-320px -180px');
    expect(box.textContent).toContain('1:50');
    await wait(2400);
    expect(host.querySelector('.player-preview')).toBeNull(); // gone once the jump is made
  });

  it('Quality in the menu restarts the stream at that quality, and is remembered for this person', async () => {
    const f = playFetch({ mode: 'hls', url: '/api/play/hls/abc/main.m3u8', sessionId: 'abc', reason: 'convert', streamToken: 'st1' });
    const p = new FakePlayer();
    await mount(f.fetchFn, p);
    expect(starts(f.calls)[0].body.quality).toBe('auto');
    p.t = 300;
    await wait(400);
    await act(async () => (host.querySelector('[data-key="tracks"]') as HTMLElement).click());
    await act(async () => (host.querySelector('[data-key="quality:720"]') as HTMLElement).click());
    await settle();
    expect(starts(f.calls).length).toBe(2);
    expect(starts(f.calls)[1].body).toMatchObject({ quality: '720', startAt: 299 }); // a second back, as for an audio change
    act(() => {
      render(null, host);
    });
    const g = playFetch({ mode: 'hls', url: '/api/play/hls/abc/main.m3u8', sessionId: 'abc', reason: 'convert', streamToken: 'st1' });
    await mount(g.fetchFn, new FakePlayer());
    expect(starts(g.calls)[0].body.quality).toBe('720');
  });

  const withIntro = Object.assign({}, info, { segments: { intro: { start: 0, end: 60 } } });

  it('auto-skip is off unless turned on: the intro shows a Skip button and plays on', async () => {
    const f = playFetch({ mode: 'direct', url: '/api/play/direct/movie/5', reason: 'ok', streamToken: 'st1' }, { info: withIntro });
    const p = new FakePlayer();
    await mount(f.fetchFn, p);
    p.t = 5;
    await wait(600);
    expect(p.seeks).toEqual([]);
    expect(host.textContent).toContain('Skip intro');
  });

  it('moving through the video into an intro or the credits keeps the focus on the bar', async () => {
    const withCredits = Object.assign({}, info, { segments: { credits: { start: 300, end: 400 } } });
    const f = playFetch({ mode: 'direct', url: '/api/play/direct/movie/5', reason: 'ok', streamToken: 'st1' }, { info: withCredits });
    const p = new FakePlayer();
    await mount(f.fetchFn, p);
    p.t = 285;
    await wait(400);
    expect(host.querySelector('.player-bar.focused')).not.toBeNull();
    press(39);
    await wait(300); // two separate presses, not a held key
    press(39);
    await wait(50);
    // Passing through: no Skip button, and the ring stays on the bar.
    expect(host.querySelector('.player-skip')).toBeNull();
    expect(host.querySelector('.player-bar.focused')).not.toBeNull();
    await wait(1200);
    await settle();
    expect(p.seeks).toEqual([305]);
    // Landed in the credits: the button shows, but you are still on the bar and can keep moving.
    expect(host.querySelector('.player-skip')).not.toBeNull();
    expect(host.querySelector('.player-bar.focused')).not.toBeNull();
    press(39);
    await wait(1200);
    await settle();
    expect(p.seeks).toEqual([305, 315]);
  });

  it('with auto-skip on, the intro is skipped once and a note says so', async () => {
    setPref(1, 'autoSkip', true);
    const f = playFetch({ mode: 'direct', url: '/api/play/direct/movie/5', reason: 'ok', streamToken: 'st1' }, { info: withIntro });
    const p = new FakePlayer();
    await mount(f.fetchFn, p);
    p.t = 5;
    await wait(600);
    expect(p.seeks).toEqual([60]);
    expect(host.textContent).toContain('Skipped the intro');
  });

  it('the auto-skip switch in the menu turns it on and remembers it', async () => {
    const f = playFetch({ mode: 'direct', url: '/api/play/direct/movie/5', reason: 'ok', streamToken: 'st1' });
    await mount(f.fetchFn, new FakePlayer());
    await act(async () => (host.querySelector('[data-key="tracks"]') as HTMLElement).click());
    const sw = host.querySelector('[data-key="autoskip"]') as HTMLElement;
    expect(sw.textContent).toContain('Off');
    await act(async () => sw.click());
    expect((host.querySelector('[data-key="autoskip"]') as HTMLElement).textContent).toContain('On');
    expect(localStorage.getItem('foxbloom.tv.prefs.1')).toContain('"autoSkip":true');
  });

  it('a jump the TV refuses (reports an error) stays where the video is, without restarting, and says so', async () => {
    const f = playFetch({ mode: 'direct', url: '/api/play/direct/movie/5/stream.mkv', reason: 'ok', streamToken: 'st1' });
    const p = new FakePlayer();
    p.refuseSeeks = true;
    await mount(f.fetchFn, p);
    p.t = 100;
    await wait(400);
    press(39);
    await wait(2400);
    await settle();
    expect(p.seeks).toEqual([110]);
    expect(starts(f.calls).length).toBe(1); // a restart would need the same jump, and would start from 0:00
    expect(clockText()).toMatch(/^1:4[0-9]$/); // back with the video, near 1:40
    expect(host.textContent).toContain('This TV couldn’t jump in this video');
  });

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

  it('a pause by the player itself shows Play, saves the progress, and OK plays again', async () => {
    const f = playFetch({ mode: 'direct', url: '/api/play/direct/movie/5', reason: 'ok', streamToken: 'st1' });
    const p = new FakePlayer();
    await mount(f.fetchFn, p);
    p.t = 42;
    expect(host.querySelector('[data-key="playpause"]')!.textContent).toBe('Pause');
    act(() => p.pauseItself());
    await settle();
    expect(host.querySelector('[data-key="playpause"]')!.textContent).toBe('Play');
    const put = f.calls.filter((c) => c.method === 'PUT');
    expect(put.length).toBe(1);
    expect(put[0]).toMatchObject({ path: '/api/play/movie/5/progress', body: { position: 42 } });
    act(() => (host.querySelector('[data-key="playpause"]') as HTMLElement).click());
    await settle();
    expect(p.playing).toBe(true);
    expect(host.querySelector('[data-key="playpause"]')!.textContent).toBe('Pause');
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

  it('leaving while a restart for another audio track is pending still saves the position', async () => {
    const two = Object.assign({}, info, { audio: [info.audio[0], { order: 1, language: 'jpn', title: null, codec: 'aac', channels: 2, isDefault: false }] });
    const f = playFetch({ mode: 'hls', url: '/api/play/hls/abc/main.m3u8', sessionId: 'abc', reason: 'convert', streamToken: 'st1' }, { info: two, pendingAfter: 1 });
    const p = new FakePlayer();
    await mount(f.fetchFn, p);
    p.t = 300;
    await act(async () => (host.querySelector('[data-key="tracks"]') as HTMLElement).click());
    await act(async () => (host.querySelector('[data-key="audio:1"]') as HTMLElement).click());
    await settle();
    expect(starts(f.calls).length).toBe(2);
    expect(starts(f.calls)[1].body).toMatchObject({ audio: 1 });
    press(10009);
    await settle();
    const put = f.calls.filter((c) => c.method === 'PUT');
    expect(put.length).toBe(1);
    expect(put[0].body.position).toBe(300);
    expect(host.textContent).toContain('Launcher');
  });

  /** Plays to 120 s, then the player breaks: its clock reads 0 and it sends an error. */
  const breakAt120 = async () => {
    const f = playFetch({ mode: 'direct', url: '/api/play/direct/movie/5', reason: 'ok', streamToken: 'st1' });
    const p = new FakePlayer();
    await mount(f.fetchFn, p);
    p.t = 120;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300)); // a tick of the player's clock
    });
    p.t = 0;
    await act(async () => p.fail());
    await settle();
    expect(host.textContent).toContain('The video stopped playing.');
    return { f, p };
  };

  it('Try again after an error restarts where playback was', async () => {
    const { f } = await breakAt120();
    const again = host.querySelector('button.focused') as HTMLButtonElement;
    expect(again.textContent).toBe('Try again');
    await act(async () => again.click());
    await settle();
    expect(starts(f.calls).length).toBe(2);
    expect(Math.abs(starts(f.calls)[1].body.startAt - 120)).toBeLessThanOrEqual(1);
  });

  it('Back after an error saves where playback was', async () => {
    const { f } = await breakAt120();
    press(10009);
    await settle();
    const put = f.calls.filter((c) => c.method === 'PUT');
    expect(put.length).toBe(1);
    expect(put[0].body.position).toBe(120);
  });
});
