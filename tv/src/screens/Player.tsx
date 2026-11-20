import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { useNav, type Screen } from '../app';
import { focusElement } from '../focus';
import { markSignedOut } from '../profiles';
import { keyFromEvent, type Key } from '../remote';
import type { Session } from '../session';
import type { PlayExtras, PlayInfo, PlayItem, Segment, Trickplay } from '../types';
import { getPref, QUALITIES, setPref, type Quality } from '../prefs';
import { avPlayer, hasAvPlay } from '../player/avplay';
import { html5Player } from '../player/html5';
import { cueAt, parseSrt, type Cue } from '../player/srt';
import { pickSubtitle, textSubtitles, trackName } from '../player/tracks';
import type { TvPlayer } from '../player/types';
import { usePlayback, type Playback } from '../player/usePlayback';
import { profilesScreen } from './Profiles';
import { LoadError, useLoad } from './useLoad';

const defaultPlayer = (): TvPlayer => (hasAvPlay() ? avPlayer() : html5Player());

export function playerScreen(session: Session, item: PlayItem, makePlayer: () => TvPlayer = defaultPlayer): Screen {
  return { name: 'player', render: () => <Player key={item.kind + item.id} session={session} item={item} makePlayer={makePlayer} /> };
}

const HIDE_MS = 5000;
const STEP = 10;
const HELD_STEP = 30;
/** Keydowns of the same key closer together than this are the key being held (Tizen doesn't always set `repeat`). */
const HELD_MS = 250;
/** Seeks wait until the arrows rest, so holding them doesn't restart a conversion for every step. */
const SEEK_SETTLE_MS = 600;
const COUNTDOWN = 10;
/** How often to ask for intro/credits and thumbnails the server is still making, and for how long (like the website). */
const EXTRAS_EVERY_MS = 5000;
const EXTRAS_TRIES = 120;
/** A jump you made yourself this recently means you want to watch that part: auto-skip leaves it alone. */
const OWN_SEEK_MS = 2500;
const NOTE_MS = 5000;
const QUALITY_LABEL: Record<Quality, string> = { auto: 'Auto', original: 'Original', '1080': '1080p', '720': '720p', '480': '480p' };

const two = (n: number) => (n < 10 ? '0' : '') + n;
export function clock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? h + ':' + two(m) + ':' + two(s % 60) : m + ':' + two(s % 60);
}

/** Plays one title. Loads what to play, then hands over to Playing. */
export function Player({ session, item, makePlayer }: { session: Session; item: PlayItem; makePlayer: () => TvPlayer }) {
  const info = useLoad<PlayInfo>(session, '/api/play/' + item.kind + '/' + item.id + '/info');
  if (info.error) {
    return (
      <div class="player player-msg">
        <LoadError message={info.error} onRetry={info.retry} />
      </div>
    );
  }
  if (!info.data) {
    return (
      <div class="player player-msg">
        <p class="loading">Loading…</p>
      </div>
    );
  }
  return <Playing session={session} item={item} info={info.data} makePlayer={makePlayer} />;
}

/** The text subtitle track `order` as cues (fetched as SRT with the stream token); [] while loading or off. */
function useSubtitles(session: Session, info: PlayInfo, order: number | null, streamToken: string | null): Cue[] {
  const [cues, setCues] = useState<Cue[]>([]);
  const ready = streamToken !== null;
  useEffect(() => {
    setCues([]);
    if (order === null || !ready) return;
    let live = true;
    const path = '/api/play/' + info.kind + '/' + info.id + '/subtitle/' + order + '?format=srt';
    session
      .fetchFn(session.streamUrl(path, streamToken || undefined))
      .then((res) => (res.ok ? res.text() : ''))
      .then(
        (text) => live && setCues(parseSrt(text)),
        () => {},
      );
    return () => {
      live = false;
    };
  }, [order, ready]);
  return cues;
}

const pct = (t: number, d: number) => (d > 0 ? Math.min(100, Math.max(0, (t / d) * 100)) : 0) + '%';

function SegmentMark({ seg, duration, kind }: { seg: Segment | undefined; duration: number; kind: string }) {
  if (!seg || duration <= 0) return null;
  return <div class={'player-seg ' + kind} style={{ left: pct(seg.start, duration), width: pct(seg.end - seg.start, duration) }} />;
}

/** The thumbnail of moment `t`, above the bar while you move through the video (cut from its sheet image). */
function Preview({ tp, t, duration, sheetUrl }: { tp: Trickplay; t: number; duration: number; sheetUrl: (sheet: number) => string }) {
  const perSheet = tp.columns * tp.rows;
  const i = Math.min(Math.max(0, Math.floor(t / tp.interval)), Math.max(0, tp.count - 1));
  const inSheet = i % perSheet;
  const style = {
    left: pct(t, duration),
    width: tp.width + 'px',
    height: tp.height + 'px',
    marginLeft: -tp.width / 2 + 'px',
    backgroundImage: 'url("' + sheetUrl(Math.floor(i / perSheet)) + '")',
    backgroundPosition: -(inSheet % tp.columns) * tp.width + 'px ' + -Math.floor(inSheet / tp.columns) * tp.height + 'px',
  };
  return (
    <div class="player-preview" style={style}>
      <span>{clock(t)}</span>
    </div>
  );
}

function TracksMenu({ info, pb, subtitle, onAudio, onSubtitle, onQuality, autoSkip, onAutoSkip }: { info: PlayInfo; pb: Playback; subtitle: number | null; onAudio: (o: number) => void; onSubtitle: (o: number | null) => void; onQuality: (q: Quality) => void; autoSkip: boolean; onAutoSkip: () => void }) {
  const subs = textSubtitles(info);
  return (
    <div class="player-menu">
      <div class="player-menu-col">
        <h2>Audio</h2>
        {info.audio.length ? (
          info.audio.map((a, i) => (
            <button key={a.order} data-focusable data-key={'audio:' + a.order} class={'menu-option' + (a.order === pb.audio ? ' on' : '')} onClick={() => onAudio(a.order)}>
              {trackName(a, i)}
            </button>
          ))
        ) : (
          <p>No audio tracks</p>
        )}
      </div>
      <div class="player-menu-col">
        <h2>Subtitles</h2>
        <button data-focusable data-key="sub:off" class={'menu-option' + (subtitle === null ? ' on' : '')} onClick={() => onSubtitle(null)}>
          Off
        </button>
        {subs.map((s, i) => (
          <button key={s.order} data-focusable data-key={'sub:' + s.order} class={'menu-option' + (s.order === subtitle ? ' on' : '')} onClick={() => onSubtitle(s.order)}>
            {trackName(s, i) + (s.forced ? ' · Forced' : '')}
          </button>
        ))}
      </div>
      <div class="player-menu-col">
        <h2>Quality</h2>
        {QUALITIES.map((q) => (
          <button key={q} data-focusable data-key={'quality:' + q} class={'menu-option' + (q === pb.quality ? ' on' : '')} onClick={() => onQuality(q)}>
            {QUALITY_LABEL[q]}
          </button>
        ))}
        <h2 class="menu-gap">Skipping</h2>
        <button data-focusable data-key="autoskip" class={'menu-option' + (autoSkip ? ' on' : '')} onClick={onAutoSkip}>
          {'Auto-skip intros & credits: ' + (autoSkip ? 'On' : 'Off')}
        </button>
      </div>
    </div>
  );
}

function Playing({ session, item, info, makePlayer }: { session: Session; item: PlayItem; info: PlayInfo; makePlayer: () => TvPlayer }) {
  const nav = useNav();
  const pb = usePlayback(session, info, makePlayer, () => {
    markSignedOut(session.profile.userId);
    nav.reset([profilesScreen(session.fetchFn)]);
  });
  const [subtitle, setSubtitle] = useState<number | null>(() => pickSubtitle(info, pb.audio));
  const cues = useSubtitles(session, info, subtitle, pb.streamToken);
  const [controls, setControls] = useState(true);
  const [menu, setMenu] = useState(false);
  const [scrub, setScrub] = useState<number | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const timers = useRef({ hide: 0, scrub: 0 });
  const lastKey = useRef<{ key: Key | null; at: number }>({ key: null, at: 0 });

  const uid = session.profile.userId;
  const base = '/api/play/' + info.kind + '/' + info.id;
  const [autoSkip, setAutoSkip] = useState(() => !!getPref(uid, 'autoSkip'));
  const [note, setNote] = useState<string | null>(null);
  const lastOwnSeek = useRef(0);
  const skipped = useRef<Record<string, boolean>>({});

  // Intro/credits and thumbnails the server is still making arrive later: ask again every few seconds for a while.
  const [extras, setExtras] = useState<PlayExtras>({ segments: info.segments, trickplay: info.trickplay || null });
  useEffect(() => {
    if (extras.trickplay && extras.segments.intro) return;
    let tries = 0;
    const id = window.setInterval(() => {
      if (++tries > EXTRAS_TRIES) return window.clearInterval(id);
      session.get<PlayExtras>(base + '/extras').then(
        (x) => {
          if (!x) return;
          setExtras({ segments: x.segments || {}, trickplay: x.trickplay || null });
          if (x.trickplay && x.segments && x.segments.intro) window.clearInterval(id);
        },
        () => {},
      );
    }, EXTRAS_EVERY_MS);
    return () => window.clearInterval(id);
  }, []);

  const duration = pb.duration;
  const t = scrub !== null ? scrub : pb.time;
  const intro = extras.segments.intro;
  const credits = extras.segments.credits;
  const inIntro = !!intro && t >= intro.start && t < intro.end - 1;
  const inCredits = !!credits && t >= credits.start && t < credits.end - 1;
  const skip = pb.phase === 'playing' && countdown === null && !menu && (inIntro || inCredits) ? (inIntro ? 'Skip intro' : info.next ? 'Next episode' : 'Skip credits') : null;
  const askingNext = countdown !== null && !!info.next;

  const goNext = () => {
    if (info.next) nav.replace(playerScreen(session, { kind: 'episode', id: info.next.id, title: item.title, label: info.next.label }, makePlayer));
  };
  const doSkip = () => {
    lastOwnSeek.current = Date.now();
    if (inIntro) pb.seek(intro!.end);
    else if (info.next) goNext();
    else if (credits) pb.seek(credits.end);
  };

  // The page has to be see-through where the video is: AVPlay draws it under the web page.
  useEffect(() => {
    const html = document.documentElement;
    html.classList.add('video-on');
    return () => {
      html.classList.remove('video-on');
      window.clearTimeout(timers.current.hide);
      window.clearTimeout(timers.current.scrub);
    };
  }, []);

  // Auto-skip (when turned on): reaching an intro or the credits skips it, once each. A part you jumped into yourself
  // is left to play, and the credits of an episode with a next one go straight to it.
  useEffect(() => {
    if (!autoSkip || !pb.playing || pb.phase !== 'playing' || countdown !== null || scrub !== null) return;
    const seg = inIntro ? intro! : inCredits ? credits! : null;
    if (!seg) return;
    const k = (inIntro ? 'intro:' : 'credits:') + seg.start;
    if (skipped.current[k]) return;
    skipped.current[k] = true;
    if (Date.now() - lastOwnSeek.current < OWN_SEEK_MS) return;
    if (!inIntro && info.next) return goNext();
    pb.seek(seg.end);
    setNote(inIntro ? 'Skipped the intro' : 'Skipped the credits');
  });
  useEffect(() => {
    if (!note) return;
    const id = window.setTimeout(() => setNote(null), NOTE_MS);
    return () => window.clearTimeout(id);
  }, [note]);

  // "Up next" when an episode ends, counting down to playing it.
  useEffect(() => {
    if (pb.phase === 'ended' && info.next) setCountdown(COUNTDOWN);
  }, [pb.phase]);
  useEffect(() => {
    if (countdown === null) return;
    if (countdown <= 0) {
      goNext();
      return;
    }
    const id = window.setTimeout(() => setCountdown((c) => (c === null ? null : c - 1)), 1000);
    return () => window.clearTimeout(id);
  }, [countdown]);

  // The controls hide a few seconds after the last key while playing.
  const state = useRef({ playing: pb.playing, menu: menu });
  state.current = { playing: pb.playing, menu: menu };
  const poke = () => {
    setControls(true);
    window.clearTimeout(timers.current.hide);
    timers.current.hide = window.setTimeout(() => {
      if (state.current.playing && !state.current.menu) setControls(false);
    }, HIDE_MS);
  };
  useEffect(() => {
    if (pb.playing) poke();
    else setControls(true);
  }, [pb.playing]);

  // Where the focus ring goes: the dialog's first button, the menu's current choice, the Skip button while it shows, else the bar.
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const sr = (el.closest('.screen-root') as HTMLElement | null) || el;
    const target =
      el.querySelector<HTMLElement>('.player-dialog [data-focusable]') ||
      el.querySelector<HTMLElement>('.player-menu .menu-option.on') ||
      el.querySelector<HTMLElement>('.player-menu [data-focusable]') ||
      el.querySelector<HTMLElement>('.player-skip') ||
      el.querySelector<HTMLElement>('.player-bar');
    if (target && !target.classList.contains('focused')) focusElement(target, sr);
  }, [pb.phase, menu, askingNext, skip !== null]);

  const seekBy = (d: number) => {
    lastOwnSeek.current = Date.now();
    const from = scrub !== null ? scrub : pb.time;
    const to = Math.min(Math.max(0, from + d), Math.max(0, duration - 0.5));
    setScrub(to);
    window.clearTimeout(timers.current.scrub);
    timers.current.scrub = window.setTimeout(() => {
      pb.seek(to);
      setScrub(null);
    }, SEEK_SETTLE_MS);
  };

  /** The player's own keys; returns false for the ones App should handle (moving the focus ring, OK, Back to leave). */
  const onKey = (key: Key, e: KeyboardEvent): boolean => {
    const now = Date.now();
    const held = !!e.repeat || (lastKey.current.key === key && now - lastKey.current.at < HELD_MS);
    lastKey.current = { key: key, at: now };
    if (pb.phase === 'failed' || pb.phase === 'starting') return false;
    const hidden = !controls;
    poke();
    if (key === 'back') {
      if (!menu) return false; // App leaves the screen; leaving saves the progress
      setMenu(false);
      return true;
    }
    if (key === 'play' || key === 'pause' || key === 'playpause') {
      if (key === 'play') pb.play();
      else if (key === 'pause') pb.pause();
      else pb.toggle();
      return true;
    }
    if (menu || askingNext) return false;
    if (key === 'ff' || key === 'rw') {
      seekBy(key === 'ff' ? HELD_STEP : -HELD_STEP);
      return true;
    }
    const el = root.current;
    const onBar = hidden || !!(el && el.querySelector('.player-bar.focused'));
    if ((key === 'left' || key === 'right') && onBar) {
      const step = held ? HELD_STEP : STEP;
      seekBy(key === 'right' ? step : -step);
      return true;
    }
    if (key === 'ok' && hidden) {
      if (skip) doSkip();
      return true;
    }
    return !!hidden && (key === 'up' || key === 'down');
  };
  const handler = useRef(onKey);
  handler.current = onKey;
  useEffect(() => {
    // Capture phase, so these keys are handled here before App's own listener sees them.
    const listen = (e: KeyboardEvent) => {
      const k = keyFromEvent(e);
      if (k && handler.current(k.key, e)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('keydown', listen, true);
    return () => window.removeEventListener('keydown', listen, true);
  }, []);

  const chooseAudio = (o: number) => {
    pb.chooseAudio(o);
    setMenu(false);
  };
  const chooseSubtitle = (o: number | null) => {
    setSubtitle(o);
    setMenu(false);
  };
  const chooseQuality = (q: Quality) => {
    pb.chooseQuality(q);
    setMenu(false);
  };
  const toggleAutoSkip = () => {
    setPref(uid, 'autoSkip', !autoSkip);
    setAutoSkip(!autoSkip);
  };
  const sheetUrl = (sheet: number) => {
    try {
      return session.streamUrl(base + '/trickplay/' + sheet + '.jpg', pb.streamToken || undefined);
    } catch (_e) {
      return '';
    }
  };
  const line = pb.phase === 'playing' || pb.phase === 'ended' ? cueAt(cues, pb.time) : '';
  const showBar = controls && !menu && !askingNext && pb.phase !== 'failed';

  return (
    <div class={'player' + (showBar ? '' : ' hide-controls')} ref={root}>
      {line && <div class={'player-subs' + (showBar ? ' raised' : '')}>{line}</div>}
      {pb.buffering && pb.phase !== 'failed' && <div class="player-spinner" />}

      {pb.phase === 'failed' ? (
        <div class="dialog player-dialog">
          <h2>{pb.error}</h2>
          <div class="row">
            {pb.canRetry && (
              <button data-focusable data-key="retry" class="btn" onClick={pb.retry}>
                Try again
              </button>
            )}
            <button data-focusable data-key="back" class="btn" onClick={() => nav.pop()}>
              Back
            </button>
          </div>
        </div>
      ) : askingNext ? (
        <div class="dialog player-dialog">
          <h2>{'Up next: ' + info.next!.label}</h2>
          <div class="row">
            <button data-focusable data-key="next-now" class="btn" onClick={goNext}>
              {'Play now (' + countdown + ')'}
            </button>
            <button data-focusable data-key="next-cancel" class="btn" onClick={() => setCountdown(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : menu ? (
        <TracksMenu info={info} pb={pb} subtitle={subtitle} onAudio={chooseAudio} onSubtitle={chooseSubtitle} onQuality={chooseQuality} autoSkip={autoSkip} onAutoSkip={toggleAutoSkip} />
      ) : null}

      {note && <div class="player-note">{note}</div>}
      {skip && (
        <button data-focusable data-key="skip" class="btn player-skip" onClick={doSkip}>
          {skip}
        </button>
      )}

      {!menu && !askingNext && pb.phase !== 'failed' && (
        <div class="player-bottom">
          <div class="player-titles">
            <h2>{info.title}</h2>
            {info.subtitle && <p>{info.subtitle}</p>}
          </div>
          <div class="player-bar-row">
            <span class="player-clock">{clock(t)}</span>
            <div data-focusable data-key="bar" class="player-bar" onClick={pb.toggle}>
              <SegmentMark seg={intro} duration={duration} kind="intro" />
              <SegmentMark seg={credits} duration={duration} kind="credits" />
              <div class="player-fill" style={{ width: pct(t, duration) }} />
              <div class="player-knob" style={{ left: pct(t, duration) }} />
              {scrub !== null && extras.trickplay && <Preview tp={extras.trickplay} t={scrub} duration={duration} sheetUrl={sheetUrl} />}
            </div>
            <span class="player-clock">{clock(duration)}</span>
          </div>
          <div class="row player-buttons">
            <button data-focusable data-key="playpause" class="btn" onClick={pb.toggle}>
              {pb.playing ? 'Pause' : 'Play'}
            </button>
            <button data-focusable data-key="tracks" class="btn" onClick={() => setMenu(true)}>
              Settings
            </button>
            {info.next && (
              <button data-focusable data-key="next" class="btn" onClick={goNext}>
                Next episode
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
