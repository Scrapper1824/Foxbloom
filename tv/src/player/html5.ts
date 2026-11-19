import type { TvPlayer } from './types';

/**
 * A desktop stand-in for AVPlay (development only): a full-screen <video> under the transparent player screen.
 * Plays what the desktop browser plays; HLS only where the browser does it natively.
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
    open(url, startAt) {
      if (!v) v = make();
      const el = v;
      opening = true;
      return new Promise<void>((resolve, reject) => {
        const done = (fail: boolean) => {
          el.removeEventListener('loadedmetadata', onMeta);
          el.removeEventListener('error', onErr);
          opening = false;
          if (fail) reject(new Error('Video error ' + (el.error ? el.error.code : '')));
          else resolve();
        };
        const onMeta = () => {
          if (startAt > 0) el.currentTime = startAt;
          done(false);
        };
        const onErr = () => done(true);
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
      if (v) v.currentTime = Math.max(0, seconds);
      return Promise.resolve();
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
