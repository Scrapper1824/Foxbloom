import type { TvPlayer } from './types';

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
 * TvPlayer on webapis.avplay. AVPlay draws the video on a plane under the web page, inside an
 * <object type="application/avplayer"> element; the page above it must be transparent (the player screen sees to that).
 */
export function avPlayer(av: any = webapis.avplay, doc: Document = document, win: Window = window): TvPlayer {
  let ended = () => {};
  let error = (_m: string) => {};
  let buffering = (_on: boolean) => {};
  let obj: HTMLElement | null = null;

  function shutdown() {
    call(() => av.stop());
    call(() => av.close());
  }

  return {
    open(url, startAt) {
      return new Promise<void>((resolve, reject) => {
        try {
          shutdown(); // AVPlay only opens from its idle state
          if (!obj) {
            obj = doc.createElement('object');
            obj.setAttribute('type', 'application/avplayer');
            obj.className = 'avplayer';
            doc.body.appendChild(obj);
          }
          av.open(url);
          const r = displayRect(0, 0, win.innerWidth || 1920, win.innerHeight || 1080, win);
          av.setDisplayRect(r[0], r[1], r[2], r[3]);
          av.setListener({
            onbufferingstart: () => buffering(true),
            onbufferingprogress: () => {},
            onbufferingcomplete: () => buffering(false),
            onstreamcompleted: () => ended(),
            oncurrentplaytime: () => {},
            onevent: () => {},
            onsubtitlechange: () => {},
            ondrmevent: () => {},
            onerror: (e: unknown) => error(String(e)),
          });
        } catch (e) {
          reject(e instanceof Error ? e : new Error(String(e)));
          return;
        }
        av.prepareAsync(
          () => {
            if (!(startAt > 0)) return resolve();
            try {
              av.seekTo(Math.floor(startAt * 1000), () => resolve(), () => resolve());
            } catch (_e) {
              resolve(); // play from the start rather than never opening
            }
          },
          (e: unknown) => reject(new Error(String(e))),
        );
      });
    },
    play: () => call(() => av.play()),
    pause: () => call(() => av.pause()),
    seek(seconds) {
      return new Promise<boolean>((resolve) => {
        try {
          av.seekTo(Math.max(0, Math.floor(seconds * 1000)), () => resolve(true), () => resolve(false));
        } catch (_e) {
          resolve(false);
        }
      });
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
}
