import type { AndroidBridge } from '../platform';
import type { TvPlayer } from './types';

type PlayerWindow = Window & { __foxbloomPlayer?: (event: string, arg: string) => void };

const call = (f: () => void) => {
  try {
    f();
  } catch (_e) {
    /* the bridge throws when the native player is gone; nothing to do about it */
  }
};

/**
 * TvPlayer on the Android TV app's ExoPlayer. Commands go through the bridge (times in ms); the app answers by calling
 * `window.__foxbloomPlayer(event, arg)` with: 'ready' (prepared, at the start point), 'buffering' ('1'/'0'), 'ended',
 * 'error' (message) and 'seeked' ('1' landed / '0' failed). The video is drawn by the app under the transparent page.
 */
export function androidPlayer(bridge: AndroidBridge, win: Window = window): TvPlayer {
  const w = win as PlayerWindow;
  let ended = () => {};
  let error = (_m: string) => {};
  let buffering = (_on: boolean) => {};
  let opening: { resolve: () => void; reject: (e: Error) => void } | null = null;
  let seeking: ((landed: boolean) => void) | null = null;

  function onEvent(event: string, arg: string) {
    switch (event) {
      case 'ready':
        if (opening) {
          const o = opening;
          opening = null;
          o.resolve();
        }
        break;
      case 'buffering':
        buffering(arg === '1');
        break;
      case 'ended':
        ended();
        break;
      case 'error':
        if (opening) {
          const o = opening;
          opening = null;
          o.reject(new Error(arg));
        } else {
          error(arg);
        }
        break;
      case 'seeked':
        if (seeking) {
          const s = seeking;
          seeking = null;
          s(arg === '1');
        }
        break;
    }
  }

  w.__foxbloomPlayer = onEvent;

  return {
    open(url, startAt) {
      return new Promise<void>((resolve, reject) => {
        w.__foxbloomPlayer = onEvent; // close() removes it; open() may follow
        opening = { resolve, reject };
        try {
          bridge.open(url, Math.max(0, Math.floor(startAt * 1000)));
        } catch (e) {
          opening = null;
          reject(e instanceof Error ? e : new Error(String(e)));
        }
      });
    },
    play: () => call(() => bridge.play()),
    pause: () => call(() => bridge.pause()),
    seek(seconds) {
      return new Promise<boolean>((resolve) => {
        if (seeking) seeking(false); // a newer jump supersedes the one still in flight
        seeking = resolve;
        try {
          bridge.seek(Math.max(0, Math.floor(seconds * 1000)));
        } catch (_e) {
          seeking = null;
          resolve(false);
        }
      });
    },
    time() {
      try {
        return (Number(bridge.time()) || 0) / 1000;
      } catch (_e) {
        return 0;
      }
    },
    duration() {
      try {
        return (Number(bridge.duration()) || 0) / 1000;
      } catch (_e) {
        return 0;
      }
    },
    audioTracks() {
      try {
        const all = JSON.parse(bridge.audioTracks());
        if (!Array.isArray(all)) return [];
        const out: { index: number; language: string }[] = [];
        for (let i = 0; i < all.length; i++) out.push({ index: Number(all[i].index), language: String(all[i].language || '') });
        return out;
      } catch (_e) {
        return [];
      }
    },
    setAudio: (index) => call(() => bridge.setAudio(index)),
    onEnded: (cb) => (ended = cb),
    onError: (cb) => (error = cb),
    onBuffering: (cb) => (buffering = cb),
    close() {
      call(() => bridge.close());
      delete w.__foxbloomPlayer;
      opening = null;
      if (seeking) {
        const s = seeking;
        seeking = null;
        s(false);
      }
    },
  };
}
