import { useEffect, useRef, useState } from 'preact/hooks';
import { ApiError, OfflineError, SignedOutError } from '../api';
import type { Session } from '../session';
import type { PlayInfo, StartResult } from '../types';
import { detectCaps } from './caps';
import { pickAudio } from './tracks';
import { savedQuality, setPref, type Quality } from '../prefs';
import { dlog } from '../debuglog';
import type { TvPlayer } from './types';

export const CANT_PLAY = 'This video can’t play on this TV.';
const SAVE_EVERY_MS = 10000;
/** While paused, ask for the playlist this often so the server keeps a converted stream (it ends unused ones after a minute). */
const KEEPALIVE_MS = 20000;
const KEEPALIVE_FOR_MS = 30 * 60000;
/** After a jump, how long to wait before checking the video really moved (some TVs ignore seekTo without an error). */
export const SEEK_CHECK_MS = 1500;
/** How far from the chosen time still counts as having got there (s). */
const SEEK_SLACK = 5;

export interface Playback {
  phase: 'starting' | 'playing' | 'ended' | 'failed';
  /** What went wrong, when phase is 'failed'. */
  error: string | null;
  /** Whether Try again makes sense (not for a file this TV can't play at all). */
  canRetry: boolean;
  playing: boolean;
  buffering: boolean;
  time: number;
  duration: number;
  audio: number | null;
  quality: Quality;
  /** When the player last refused a jump (Date.now()), 0 if never: the screen says so. */
  seekRefused: number;
  /** The current stream token, for subtitle URLs. */
  streamToken: string | null;
  play(): void;
  pause(): void;
  toggle(): void;
  seek(t: number): void;
  chooseAudio(order: number): void;
  /** Restarts the stream from here at that quality, and remembers it for this person. */
  chooseQuality(q: Quality): void;
  retry(): void;
}

/** Where a title starts: where you left off, unless that was the first or last half minute. */
export const startPoint = (info: PlayInfo) => (info.position > 30 && info.position < info.duration - 30 ? info.position : 0);

/**
 * Runs one title on a TvPlayer: asks the server for a stream (/start), opens it, keeps the clock, saves progress
 * (every 10 s, on pause, at the end and when the screen goes away) and ends converted streams it no longer needs.
 * If the player fails before playback has started, asks once more with forceConvert; a second failure is CANT_PLAY.
 */
export function usePlayback(session: Session, info: PlayInfo, makePlayer: () => TvPlayer, onSignedOut: () => void): Playback {
  const base = '/api/play/' + info.kind + '/' + info.id;
  const duration = info.duration;
  const player = useRef<TvPlayer | null>(null);
  if (!player.current) player.current = makePlayer();
  const p = player.current;
  const caps = useRef(detectCaps()).current;
  const [audio, setAudioState] = useState<number | null>(() => pickAudio(info));
  const [quality, setQualityState] = useState<Quality>(() => savedQuality(session.profile.userId));
  const qualityRef = useRef(quality);
  qualityRef.current = quality;
  const [st, setSt] = useState<{ phase: Playback['phase']; error: string | null; canRetry: boolean; playing: boolean; buffering: boolean }>({
    phase: 'starting',
    error: null,
    canRetry: true,
    playing: false,
    buffering: true,
  });
  const [time, setTime] = useState(() => startPoint(info));
  const [token, setToken] = useState<string | null>(null);
  const [seekRefused, setSeekRefused] = useState(0);
  const r = useRef({
    live: true,
    gen: 0,
    started: false,
    ended: false,
    forced: false,
    failedGen: -1,
    /** The player stopped with an error: its clock can't be trusted (AVPlay may read 0 or throw). */
    broken: false,
    /** The last position known to have played (s); 0 until a stream has played. Survives restarts and errors. */
    lastTime: 0,
    playing: false,
    mode: null as StartResult['mode'] | null,
    hls: null as string | null,
    url: '',
    last: { at: 0, audio: null as number | null, play: true },
    pausedSince: 0,
    /** A jump in progress: the bar shows this time until the video gets there (or the stream restarts there). */
    seekTarget: null as number | null,
    seekGen: 0,
  }).current;

  const endHls = (id: string) => {
    session.send('DELETE', '/api/play/hls/' + id).then(undefined, () => {});
  };
  /** Where playback is: the player's clock while it works, otherwise the last position it reported. */
  const now = () => {
    if (r.seekTarget !== null) return r.seekTarget;
    if (r.started && !r.broken) {
      const t = p.time();
      if (t > 0) r.lastTime = t;
    }
    return r.lastTime;
  };
  const save = (position?: number) => {
    const t = position !== undefined ? position : now();
    if (t > 0) session.send('PUT', base + '/progress', { position: t, duration: duration }).then(undefined, () => {});
  };
  const fail = (error: string, canRetry: boolean) => {
    r.playing = false;
    setSt({ phase: 'failed', error: error, canRetry: canRetry, playing: false, buffering: false });
  };

  /** The player gave up on stream `gen`: before playback, once more converted; otherwise say so. */
  const playFailed = (gen: number) => {
    if (gen !== r.gen || r.failedGen === gen || !r.live) return;
    r.failedGen = gen;
    if (r.started) {
      now();
      r.broken = true;
      fail('The video stopped playing.', true);
    }
    else if (!r.forced) {
      r.forced = true;
      start(r.last.at, r.last.audio, r.last.play);
    } else fail(CANT_PLAY, false);
  };

  /** Picks the chosen track in a direct-played file (the server leaves that to the TV when switchesAudio is set). */
  const selectAudio = (order: number | null): boolean => {
    if (order === null) return true;
    const tracks = p.audioTracks();
    if (!tracks[order]) return false;
    p.setAudio(tracks[order].index);
    return true;
  };

  function start(at: number, a: number | null, play: boolean) {
    const gen = ++r.gen;
    r.started = false;
    r.ended = false;
    r.seekTarget = null;
    r.seekGen++;
    r.last = { at: at, audio: a, play: play };
    setSt({ phase: 'starting', error: null, canRetry: true, playing: false, buffering: true });
    const body = { audio: a, subtitle: null, quality: qualityRef.current, caps: Object.assign({}, caps, { forceConvert: r.forced }), startAt: at };
    session.send<StartResult>('POST', base + '/start', body).then(
      (res) => {
        if (gen !== r.gen || !r.live) {
          if (res.sessionId) endHls(res.sessionId);
          return;
        }
        p.close();
        if (r.hls) endHls(r.hls);
        r.hls = res.sessionId || null;
        r.mode = res.mode;
        dlog('stream ' + res.mode + ' (' + res.reason + ') from ' + at + 's');
        r.url = session.streamUrl(res.url, res.streamToken);
        setToken(res.streamToken || null);
        p.open(r.url, at).then(
          () => {
            if (gen !== r.gen || !r.live || r.failedGen === gen) return;
            const defaultAudio = info.audio.filter((x) => x.isDefault)[0] || info.audio[0];
            if (res.mode === 'direct' && defaultAudio && a !== defaultAudio.order) selectAudio(a);
            r.started = true;
            r.broken = false;
            r.lastTime = at;
            r.playing = play;
            if (play) p.play();
            setTime(at);
            setSt({ phase: 'playing', error: null, canRetry: true, playing: play, buffering: false });
          },
          () => playFailed(gen),
        );
      },
      (e) => {
        if (gen !== r.gen || !r.live) return;
        if (e instanceof SignedOutError) onSignedOut();
        else if (e instanceof OfflineError) fail("Can't reach Foxbloom", true);
        else fail(e instanceof ApiError ? e.message : 'Something went wrong', true);
      },
    );
  }

  useEffect(() => {
    p.onError(() => playFailed(r.gen));
    p.onBuffering((on) => r.live && setSt((s) => (s.buffering === on ? s : Object.assign({}, s, { buffering: on }))));
    p.onEnded(() => {
      if (!r.live) return;
      r.playing = false;
      r.ended = true;
      save(duration);
      setTime(duration);
      setSt((s) => Object.assign({}, s, { phase: 'ended', playing: false, buffering: false }));
    });
    start(startPoint(info), audio, true);

    const clock = window.setInterval(() => {
      if (r.started && r.playing) setTime(now());
    }, 250);
    const saver = window.setInterval(() => {
      if (r.started && r.playing) save();
    }, SAVE_EVERY_MS);
    const keepalive = window.setInterval(() => {
      if (!r.hls || r.playing) {
        r.pausedSince = 0;
        return;
      }
      if (!r.pausedSince) r.pausedSince = Date.now();
      if (Date.now() - r.pausedSince > KEEPALIVE_FOR_MS) return;
      session.fetchFn(r.url).then(undefined, () => {});
    }, KEEPALIVE_MS);
    return () => {
      r.live = false;
      window.clearInterval(clock);
      window.clearInterval(saver);
      window.clearInterval(keepalive);
      // Also while a restart is pending or after an error: save() falls back to the last known position.
      if (!r.ended) save();
      p.close();
      if (r.hls) endHls(r.hls);
      r.hls = null;
    };
  }, []);

  const play = () => {
    if (!r.started) return;
    p.play();
    r.playing = true;
    setSt((s) => Object.assign({}, s, { playing: true }));
  };
  const pause = () => {
    if (!r.started) return;
    p.pause();
    r.playing = false;
    save();
    setSt((s) => Object.assign({}, s, { playing: false }));
  };

  return {
    phase: st.phase,
    error: st.error,
    canRetry: st.canRetry,
    playing: st.playing,
    buffering: st.buffering,
    time: time,
    duration: duration,
    audio: audio,
    quality: quality,
    seekRefused: seekRefused,
    streamToken: token,
    play: play,
    pause: pause,
    toggle: () => (r.playing ? pause() : play()),
    seek(t: number) {
      if (!r.started) return;
      const to = Math.min(Math.max(0, t), Math.max(0, duration - 0.5));
      setTime(to);
      r.lastTime = to;
      r.seekTarget = to;
      const gen = ++r.seekGen;
      const a = audio;
      // Then check the video really went there. Some TVs (AVPlay on certain files and streams) report success but stay
      // put; the bar would snap back. Starting the stream again at that point always lands where it was asked.
      let checked = false;
      const check = () => {
        if (checked || gen !== r.seekGen || !r.live) return;
        checked = true;
        r.seekTarget = null;
        const at = r.started && !r.broken ? p.time() : 0;
        dlog('check: video at ' + at.toFixed(1) + 's, wanted ' + to + 's' + (Math.abs(at - to) <= SEEK_SLACK ? ' (ok)' : ' -> restarting there'));
        if (Math.abs(at - to) <= SEEK_SLACK) {
          r.lastTime = at;
          return;
        }
        r.lastTime = to;
        start(to, a, r.playing);
      };
      p.seek(to).then((ok) => {
        if (ok) return void window.setTimeout(check, SEEK_CHECK_MS);
        // Refused outright: starting the stream again needs the same jump, so it would play from 0:00. Stay put.
        if (checked || gen !== r.seekGen || !r.live) return;
        checked = true;
        r.seekTarget = null;
        r.lastTime = r.started && !r.broken ? p.time() || r.lastTime : r.lastTime;
        setTime(r.lastTime);
        setSeekRefused(Date.now());
      });
      window.setTimeout(check, SEEK_CHECK_MS * 3); // in case the TV never answers the seek at all
    },
    chooseAudio(order: number) {
      if (order === audio) return;
      setAudioState(order);
      // The original file: the TV switches itself. A conversion: start again with that track from here.
      if (r.started && r.mode === 'direct' && selectAudio(order)) return;
      start(Math.max(0, (now() || r.last.at) - 1), order, r.started ? r.playing : r.last.play);
    },
    chooseQuality(q: Quality) {
      setPref(session.profile.userId, 'quality', q);
      if (q === quality) return;
      setQualityState(q);
      qualityRef.current = q;
      start(Math.max(0, (now() || r.last.at) - 1), audio, r.started ? r.playing : r.last.play);
    },
    retry: () => start(Math.max(0, now() || r.last.at), audio, true),
  };
}
