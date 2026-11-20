import { describe, expect, it } from 'vitest';
import { avPlayer, displayRect } from './avplay';

const same = (u: string) => Promise.resolve(u);
const refuse = (_ms: number, _ok: () => void, bad: (e: unknown) => void) => bad({ name: 'InvalidStateError', code: 11, message: 'PLAYER_ERROR_INVALID_STATE' });

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
    jumpForward: (ms: number, ok: () => void) => { calls.push('forward ' + ms); ok(); },
    jumpBackward: (ms: number, ok: () => void) => { calls.push('backward ' + ms); ok(); },
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
    const p = avPlayer(f.av, document, { innerWidth: 1920, innerHeight: 1080 } as Window, same);
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

  it('open still resolves when seekTo throws inside the prepare callback', async () => {
    const f = fakeAv();
    f.av.seekTo = () => { throw new Error('seek failed'); };
    const p = avPlayer(f.av, document, { innerWidth: 1920, innerHeight: 1080 } as Window, same);
    await expect(p.open('https://x.test/v', 30)).resolves.toBeUndefined();
    p.close();
  });

  it('opens the address the server’s link finally leads to (AVPlay won’t jump in a redirected stream)', async () => {
    const f = fakeAv();
    const p = avPlayer(f.av, document, { innerWidth: 1920, innerHeight: 1080 } as Window, () => Promise.resolve('https://final.test/v?st=1'));
    await p.open('http://x.test/v?st=1', 0);
    expect(f.calls).toContain('open https://final.test/v?st=1');
    p.close();
  });

  it('opens the original address when finding where it leads fails', async () => {
    const f = fakeAv();
    const p = avPlayer(f.av, document, { innerWidth: 1920, innerHeight: 1080 } as Window, () => Promise.reject(new Error('offline')));
    await p.open('https://x.test/v', 0);
    expect(f.calls).toContain('open https://x.test/v');
    p.close();
  });

  it('a jump seekTo refuses with INVALID_STATE is made by jumping forward or back instead', async () => {
    const f = fakeAv();
    f.av.seekTo = refuse as any;
    const p = avPlayer(f.av, document, { innerWidth: 1920, innerHeight: 1080 } as Window, same);
    await p.open('https://x.test/v', 0);
    await expect(p.seek(300)).resolves.toBe(true); // the clock is at 61.5s
    expect(f.calls).toContain('forward 238500');
    await expect(p.seek(10)).resolves.toBe(true);
    expect(f.calls).toContain('backward 51500');
    p.close();
  });

  it('the start point is reached by jumping forward when seekTo refuses it', async () => {
    const f = fakeAv();
    f.av.seekTo = refuse as any;
    f.av.getCurrentTime = () => 0;
    const p = avPlayer(f.av, document, { innerWidth: 1920, innerHeight: 1080 } as Window, same);
    await p.open('https://x.test/v', 30);
    expect(f.calls).toContain('forward 30000');
    p.close();
  });

  it('seek resolves false when both seekTo and the jump fallback refuse', async () => {
    const f = fakeAv();
    f.av.seekTo = refuse as any;
    f.av.jumpForward = refuse as any;
    const p = avPlayer(f.av, document, { innerWidth: 1920, innerHeight: 1080 } as Window, same);
    await p.open('https://x.test/v', 0);
    await expect(p.seek(300)).resolves.toBe(false);
    p.close();
  });

  it('scales a 1280x720 window to AVPlay’s 1920x1080 space', () => {
    expect(displayRect(0, 0, 1280, 720, { innerWidth: 1280, innerHeight: 720 })).toEqual([0, 0, 1920, 1080]);
  });
});
