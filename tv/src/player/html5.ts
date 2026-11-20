import type { TvPlayer } from './types';
import { dlog } from '../debuglog';

/**
 * The built-in web player: a full-screen <video> under the transparent player screen. On a desktop browser it stands in
 * for AVPlay; on the TV it is the "Built-in" choice (the TV browser's own video player, which fetches the file itself).
 * Plays what the browser plays; HLS only where the browser does it natively.
 */
export function html5Player(doc: Document = document): TvPlayer {
  let ended = () => {};
  let error = (_m: string) => {};
  let buffering = (_on: boolean) => {};
  let v: HTMLVideoElement | null = null;
  let opening = false;

  function make(): HTMLVideoElement {
    const el = doc.createElement('video');
    el.className = 'html5-video';
    el.addEventListener('ended', () => ended());
    el.addEventListener('waiting', () => buffering(true));
    el.addEventListener('playing', () => buffering(false));
    el.addEventListener('error', () => {
      if (!opening) error('Video error ' + (el.error ? el.error.code : ''));
    });
    doc.body.appendChild(el);
    return el;
  }

  return {
    name: 'builtin',
    open(url, startAt) {
      dlog('open (built-in player) ' + url.replace(/st=[^&]+/, 'st=…').replace(/^https?:\/\/[^/]+/, '') + ' at ' + startAt + 's');
      if (!v) v = make();
      const el = v;
      opening = true;
      return new Promise<boolean>((resolve, reject) => {
        const done = (fail: boolean) => {
          el.removeEventListener('loadedmetadata', onMeta);
          el.removeEventListener('error', onErr);
          opening = false;
          if (fail) reject(new Error('Video error ' + (el.error ? el.error.code : '')));
          else resolve(true);
        };
        const onMeta = () => {
          if (startAt > 0) el.currentTime = startAt;
          done(false);
        };
        const onErr = () => {
          dlog('built-in player could not open it: error ' + (el.error ? el.error.code : '?'));
          done(true);
        };
        el.addEventListener('loadedmetadata', onMeta);
        el.addEventListener('error', onErr);
        el.src = url;
      });
    },
    play: () => {
      if (v) {
        const p = v.play() as Promise<void> | undefined;
        if (p && p.catch) p.catch(() => {});
      }
    },
    pause: () => v && v.pause(),
    seek(seconds) {
      if (v) {
        dlog('seek (built-in) to ' + Math.round(seconds) + 's from ' + Math.round(v.currentTime) + 's');
        v.currentTime = Math.max(0, seconds);
      }
      return Promise.resolve(!!v);
    },
    time: () => (v ? v.currentTime : 0),
    duration: () => (v && isFinite(v.duration) ? v.duration : 0),
    audioTracks() {
      const list = v && (v as any).audioTracks;
      const out: { index: number; language: string }[] = [];
      if (list) for (let i = 0; i < list.length; i++) out.push({ index: i, language: list[i].language || '' });
      return out;
    },
    setAudio(index) {
      const list = v && (v as any).audioTracks;
      if (list) for (let i = 0; i < list.length; i++) list[i].enabled = i === index;
    },
    onEnded: (cb) => (ended = cb),
    onError: (cb) => (error = cb),
    onBuffering: (cb) => (buffering = cb),
    close() {
      if (!v) return;
      v.pause();
      v.removeAttribute('src');
      v.load();
      if (v.parentNode) v.parentNode.removeChild(v);
      v = null;
    },
  };
}
