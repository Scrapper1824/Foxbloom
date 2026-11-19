import { describe, expect, it } from 'vitest';
import { avPlayer, displayRect } from './avplay';

/** Records AVPlay calls; prepareAsync and seekTo succeed straight away. */
function fakeAv() {
  const calls: string[] = [];
  let listener: any = null;
  const av = {
    open: (u: string) => calls.push('open ' + u),
    setDisplayRect: (...r: number[]) => calls.push('rect ' + r.join(',')),
    setListener: (l: any) => { listener = l; calls.push('listener'); },
    prepareAsync: (ok: () => void) => { calls.push('prepare'); ok(); },
    seekTo: (ms: number, ok: () => void) => { calls.push('seek ' + ms); ok(); },
    play: () => calls.push('play'),
    stop: () => calls.push('stop'),
    close: () => calls.push('close'),
    getCurrentTime: () => 61500,
    getTotalTrackInfo: () => [
      { index: 0, type: 'VIDEO', extra_info: '{}' },
      { index: 1, type: 'AUDIO', extra_info: '{"language":"jpn"}' },
      { index: 2, type: 'AUDIO', extra_info: '{"language":"eng"}' },
    ],
    setSelectTrack: (type: string, i: number) => calls.push('track ' + type + ' ' + i),
  };
  return { av, calls, listener: () => listener };
}

describe('avPlayer', () => {
  it('opens full screen, seeks to the start point in ms, and maps audio tracks', async () => {
    const f = fakeAv();
    const p = avPlayer(f.av, document, { innerWidth: 1920, innerHeight: 1080 } as Window);
    await p.open('https://x.test/v?st=1', 12.5);
    expect(f.calls).toEqual(['stop', 'close', 'open https://x.test/v?st=1', 'rect 0,0,1920,1080', 'listener', 'prepare', 'seek 12500']);
    expect(document.querySelector('object[type="application/avplayer"]')).not.toBeNull();
    expect(p.time()).toBe(61.5);
    expect(p.audioTracks()).toEqual([{ index: 1, language: 'jpn' }, { index: 2, language: 'eng' }]);
    p.setAudio(2);
    expect(f.calls[f.calls.length - 1]).toBe('track AUDIO 2');
    let ended = false;
    let buffering: boolean[] = [];
    p.onEnded(() => (ended = true));
    p.onBuffering((on) => buffering.push(on));
    f.listener().onbufferingstart();
    f.listener().onbufferingcomplete();
    f.listener().onstreamcompleted();
    expect(ended).toBe(true);
    expect(buffering).toEqual([true, false]);
    p.close();
    expect(document.querySelector('object[type="application/avplayer"]')).toBeNull();
  });

  it('scales a 1280x720 window to AVPlay’s 1920x1080 space', () => {
    expect(displayRect(0, 0, 1280, 720, { innerWidth: 1280, innerHeight: 720 })).toEqual([0, 0, 1920, 1080]);
  });
});
