import { describe, expect, it } from 'vitest';
import type { AndroidBridge } from '../platform';
import { androidPlayer } from './android';

/** Records bridge calls; the tests play the native side by firing events through window.__foxbloomPlayer. */
function fakeBridge() {
  const calls: string[] = [];
  let tracks = '[{"index":1,"language":"jpn"}]';
  const bridge: AndroidBridge = {
    open: (u, ms) => { calls.push('open ' + u + ' ' + ms); },
    play: () => { calls.push('play'); },
    pause: () => { calls.push('pause'); },
    seek: (ms) => { calls.push('seek ' + ms); },
    time: () => 61500,
    duration: () => 3600000,
    audioTracks: () => tracks,
    setAudio: (i) => { calls.push('audio ' + i); },
    close: () => { calls.push('close'); },
    caps: () => '{}',
    model: () => 'x',
    exit: () => {},
  };
  return { bridge, calls, setTracks: (t: string) => { tracks = t; } };
}

const fire = (event: string, arg = '') => (window as any).__foxbloomPlayer(event, arg);

describe('androidPlayer', () => {
  it('opens at the start point in ms and resolves only after ready', async () => {
    const f = fakeBridge();
    const p = androidPlayer(f.bridge, window);
    let done = false;
    const opened = p.open('https://s/x?st=1', 12.5).then(() => { done = true; });
    expect(f.calls).toEqual(['open https://s/x?st=1 12500']);
    await Promise.resolve();
    expect(done).toBe(false);
    fire('ready');
    await opened;
    expect(done).toBe(true);
    p.close();
  });

  it('rejects open on an error before ready, and reports later errors through onError', async () => {
    const f = fakeBridge();
    const p = androidPlayer(f.bridge, window);
    const opened = p.open('u', 0);
    fire('error', 'boom');
    await expect(opened).rejects.toThrow('boom');

    const g = fakeBridge();
    const q = androidPlayer(g.bridge, window);
    const msgs: string[] = [];
    q.onError((m) => msgs.push(m));
    const ok = q.open('u', 0);
    fire('ready');
    await ok;
    fire('error', 'late');
    expect(msgs).toEqual(['late']);
    q.close();
  });

  it('seeks in ms and resolves with whether the jump landed', async () => {
    const f = fakeBridge();
    const p = androidPlayer(f.bridge, window);
    const a = p.seek(30);
    expect(f.calls).toEqual(['seek 30000']);
    fire('seeked', '1');
    expect(await a).toBe(true);
    const b = p.seek(31);
    fire('seeked', '0');
    expect(await b).toBe(false);
    p.close();
  });

  it('converts time and duration to seconds and forwards play, pause, setAudio', () => {
    const f = fakeBridge();
    const p = androidPlayer(f.bridge, window);
    expect(p.time()).toBe(61.5);
    expect(p.duration()).toBe(3600);
    p.play();
    p.pause();
    p.setAudio(2);
    expect(f.calls).toEqual(['play', 'pause', 'audio 2']);
    p.close();
  });

  it('parses audio tracks and tolerates bad JSON', () => {
    const f = fakeBridge();
    const p = androidPlayer(f.bridge, window);
    expect(p.audioTracks()).toEqual([{ index: 1, language: 'jpn' }]);
    f.setTracks('nope');
    expect(p.audioTracks()).toEqual([]);
    p.close();
  });

  it('maps buffering and ended events to callbacks', () => {
    const f = fakeBridge();
    const p = androidPlayer(f.bridge, window);
    const buf: boolean[] = [];
    let ended = 0;
    p.onBuffering((on) => buf.push(on));
    p.onEnded(() => ended++);
    fire('buffering', '1');
    fire('buffering', '0');
    fire('ended');
    expect(buf).toEqual([true, false]);
    expect(ended).toBe(1);
    p.close();
  });

  it('reports a pause by the app itself (Home, lost audio) through onPaused', () => {
    const f = fakeBridge();
    const p = androidPlayer(f.bridge, window);
    let paused = 0;
    p.onPaused!(() => paused++);
    fire('paused');
    expect(paused).toBe(1);
    p.close();
  });

  it('close() closes the bridge and removes the global', () => {
    const f = fakeBridge();
    const p = androidPlayer(f.bridge, window);
    expect((window as any).__foxbloomPlayer).toBeTypeOf('function');
    p.close();
    expect(f.calls).toEqual(['close']);
    expect((window as any).__foxbloomPlayer).toBeUndefined();
  });
});
