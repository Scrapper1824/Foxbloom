import type { TvPlayer } from './types';
import { dlog, errText, setDstatus } from '../debuglog';

// Samsung's player API; only on the TV (loaded by $WEBAPIS/webapis/webapis.js in index.html).
declare const webapis: any;

export function hasAvPlay(): boolean {
  return typeof webapis !== 'undefined' && !!webapis && !!webapis.avplay;
}

/** AVPlay's display rect is in a 1920x1080 space whatever size the app's window is: scale window pixels to it. */
export function displayRect(x: number, y: number, w: number, h: number, win: { innerWidth: number; innerHeight: number } = window): [number, number, number, number] {
  const sx = 1920 / (win.innerWidth || 1920);
  const sy = 1080 / (win.innerHeight || 1080);
  return [Math.round(x * sx), Math.round(y * sy), Math.round(w * sx), Math.round(h * sy)];
}

const call = (f: () => void) => {
  try {
    f();
  } catch (_e) {
    /* AVPlay throws when called in the wrong state (e.g. pause while buffering); nothing to do about it */
  }
};

/**
 * Where a stream address finally leads (after the redirects of a proxy, an http to https move, a CDN). AVPlay plays
 * a redirected stream but can refuse every jump in it (PLAYER_ERROR_INVALID_STATE), so it is given the final address.
 * Starts a plain request (no extra headers, so no CORS preflight, which can't follow a redirect), reads the address
 * that answered once its headers arrive, and stops it there; any trouble keeps the original.
 */
export function finalUrl(url: string): Promise<string> {
  return new Promise<string>((resolve) => {
    let done = false;
    const finish = (u: string) => {
      if (done) return;
      done = true;
      resolve(u);
    };
    try {
      const x = new XMLHttpRequest();
      x.open('GET', url, true);
      x.timeout = 6000;
      x.onreadystatechange = () => {
        if (x.readyState < 2) return;
        finish(x.status >= 200 && x.status < 300 && x.responseURL ? x.responseURL : url);
        try {
          x.abort();
        } catch (_e) {
          /* already done */
        }
      };
      x.onerror = x.ontimeout = () => finish(url);
      x.send();
    } catch (_e) {
      finish(url);
    }
  });
}

const hostOf = (u: string) => (/^(https?:\/\/[^/]+)/.exec(u) || ['', ''])[1];

/**
 * TvPlayer on webapis.avplay. AVPlay draws the video on a plane under the web page, inside an
 * <object type="application/avplayer"> element; the page above it must be transparent (the player screen sees to that).
 */
export function avPlayer(av: any = webapis.avplay, doc: Document = document, win: Window = window, resolveUrl: (url: string) => Promise<string> = finalUrl): TvPlayer {
  let ended = () => {};
  let error = (_m: string) => {};
  let buffering = (_on: boolean) => {};
  let obj: HTMLElement | null = null;
  const state = () => {
    try {
      return String(av.getState());
    } catch (_e) {
      return '?';
    }
  };
  const nowMs = () => {
    try {
      return String(av.getCurrentTime());
    } catch (_e) {
      return '?';
    }
  };
  setDstatus(() => 'AVPlay ' + state() + ' time ' + nowMs() + ' ms');

  /** Moves to `ms`. Some TVs refuse seekTo (INVALID_STATE) but still take a jump forward/back by the difference. */
  function seekMs(ms: number, what: string, done: (ok: boolean) => void) {
    const fallback = (e: unknown) => {
      if (!/INVALID_?STATE/i.test(errText(e))) return done(false);
      let cur = 0;
      try {
        cur = Number(av.getCurrentTime()) || 0;
      } catch (_e) {
        /* treat as the start */
      }
      const d = Math.round(ms - cur);
      if (Math.abs(d) < 1000) return done(true);
      dlog((d > 0 ? 'jumpForward ' : 'jumpBackward ') + Math.abs(d) + what);
      try {
        (d > 0 ? av.jumpForward : av.jumpBackward).call(
          av,
          Math.abs(d),
          () => {
            dlog('jump ok' + what + ', time ' + nowMs());
            done(true);
          },
          (e2: unknown) => {
            dlog('jump FAILED' + what + ': ' + errText(e2));
            done(false);
          },
        );
      } catch (e2) {
        dlog('jump THREW' + what + ': ' + errText(e2));
        done(false);
      }
    };
    dlog('seekTo ' + ms + what + ', state ' + state() + ', time ' + nowMs());
    try {
      av.seekTo(
        ms,
        () => {
          dlog('seekTo ok' + what + ', time ' + nowMs());
          done(true);
        },
        (e: unknown) => {
          dlog('seekTo FAILED' + what + ': ' + errText(e));
          fallback(e);
        },
      );
    } catch (e) {
      dlog('seekTo THREW' + what + ': ' + errText(e));
      fallback(e);
    }
  }

  function shutdown() {
    call(() => av.stop());
    call(() => av.close());
  }

  return {
    open(given, startAt) {
      return resolveUrl(given)
        .then(undefined, () => given)
        .then((url) => openAt(url || given, startAt, given));
    },
    play: () => call(() => av.play()),
    pause: () => call(() => av.pause()),
    seek(seconds) {
      return new Promise<boolean>((resolve) => seekMs(Math.max(0, Math.floor(seconds * 1000)), '', resolve));
    },
    time() {
      try {
        return (Number(av.getCurrentTime()) || 0) / 1000;
      } catch (_e) {
        return 0;
      }
    },
    duration() {
      try {
        return (Number(av.getDuration()) || 0) / 1000;
      } catch (_e) {
        return 0;
      }
    },
    audioTracks() {
      try {
        const all = av.getTotalTrackInfo() || [];
        const out: { index: number; language: string }[] = [];
        for (let i = 0; i < all.length; i++) {
          if (all[i].type !== 'AUDIO') continue;
          let language = '';
          try {
            language = String(JSON.parse(all[i].extra_info).language || '');
          } catch (_e) {
            /* no extra info */
          }
          out.push({ index: Number(all[i].index), language: language });
        }
        return out;
      } catch (_e) {
        return [];
      }
    },
    setAudio: (index) => call(() => av.setSelectTrack('AUDIO', index)),
    onEnded: (cb) => (ended = cb),
    onError: (cb) => (error = cb),
    onBuffering: (cb) => (buffering = cb),
    close() {
      shutdown();
      if (obj && obj.parentNode) obj.parentNode.removeChild(obj);
      obj = null;
    },
  };

  function openAt(url: string, startAt: number, given: string): Promise<void> {
    if (hostOf(url) !== hostOf(given)) dlog('address redirected: ' + hostOf(given) + ' -> ' + hostOf(url));
    return new Promise<void>((resolve, reject) => {
      try {
        shutdown(); // AVPlay only opens from its idle state
        if (!obj) {
          obj = doc.createElement('object');
          obj.setAttribute('type', 'application/avplayer');
          obj.className = 'avplayer';
          doc.body.appendChild(obj);
        }
        dlog('open ' + url.replace(/st=[^&]+/, 'st=…').replace(/^https?:\/\/[^/]+/, '') + ' at ' + startAt + 's');
        av.open(url);
        const r = displayRect(0, 0, win.innerWidth || 1920, win.innerHeight || 1080, win);
        av.setDisplayRect(r[0], r[1], r[2], r[3]);
        av.setListener({
          onbufferingstart: () => {
            dlog('buffering start');
            buffering(true);
          },
          onbufferingprogress: () => {},
          onbufferingcomplete: () => {
            dlog('buffering done, time ' + nowMs());
            buffering(false);
          },
          onstreamcompleted: () => {
            dlog('stream completed');
            ended();
          },
          oncurrentplaytime: () => {},
          onevent: () => {},
          onsubtitlechange: () => {},
          ondrmevent: () => {},
          onerror: (e: unknown) => {
            dlog('onerror ' + errText(e));
            error(String(e));
          },
        });
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
        return;
      }
      av.prepareAsync(
        () => {
          dlog(
            'prepared, state ' +
              state() +
              ', length ' +
              (function () {
                try {
                  return av.getDuration();
                } catch (_e) {
                  return '?';
                }
              })() +
              ' ms',
          );
          if (!(startAt > 0)) return resolve();
          seekMs(Math.floor(startAt * 1000), ' (opening)', () => resolve()); // a failed jump plays from the start rather than never opening
        },
        (e: unknown) => {
          dlog('prepare FAILED: ' + errText(e));
          reject(new Error(String(e)));
        },
      );
    });
  }
}
