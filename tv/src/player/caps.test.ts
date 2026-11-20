import { describe, expect, it } from 'vitest';
import { detectCaps } from './caps';

const tv = (modelCode: string, supported: string[] = []) => ({
  webapis: { productinfo: { getModelCode: () => modelCode } },
  MediaSource: { isTypeSupported: (t: string) => supported.some((s) => t.indexOf(s) >= 0) },
});

describe('detectCaps', () => {
  it('a 2017 TV: the basics plus HEVC and Dolby audio, no AV1, no DTS unless detected', () => {
    const c = detectCaps(tv('17_KANTM_UHD') as never);
    expect(c).toMatchObject({ mp4: true, h264: true, aac: true, mp3: true, mkv: true, hevc: true, ac3: true, eac3: true, switchesAudio: true, forceConvert: false });
    expect(c.av1).toBe(false);
    expect(c.dts).toBe(false);
  });

  it('a 2022 TV also plays AV1', () => {
    const c = detectCaps(tv('22_PONTUSM_UHD') as never);
    expect(c).toMatchObject({ mp4: true, h264: true, hevc: true, ac3: true, eac3: true, av1: true, mkv: true, switchesAudio: true });
  });

  it('DTS only when the TV says it plays it', () => {
    expect(detectCaps(tv('17_KANTM_UHD', ['dtsc']) as never).dts).toBe(true);
  });

  it('a desktop browser without webapis gets only the always-on basics', () => {
    const c = detectCaps({} as never);
    expect(c).toMatchObject({ mp4: true, h264: true, aac: true, mp3: true, mkv: true, switchesAudio: true, forceConvert: false });
    expect(c.hevc).toBe(false);
    expect(c.ac3).toBe(false);
    expect(c.eac3).toBe(false);
    expect(c.dts).toBe(false);
    expect(c.av1).toBe(false);
  });
});

describe('detectCaps on the Android app', () => {
  const reported = { mp4: true, mkv: true, h264: true, hevc: true, av1: false, vp9: true, aac: true, mp3: true, opus: true, flac: true, ac3: false, eac3: true, dts: false, webm: true };

  it('uses what the Android app reports, always switching audio itself and never forcing conversion', () => {
    const c = detectCaps({ FoxbloomAndroid: { caps: () => JSON.stringify(reported) } } as never);
    expect(c).toEqual({ ...reported, switchesAudio: true, forceConvert: false });
  });

  it('falls back to the plain browser result when caps() throws or is not JSON', () => {
    const plain = detectCaps({} as never);
    expect(detectCaps({ FoxbloomAndroid: { caps: () => { throw new Error('x'); } } } as never)).toEqual(plain);
    expect(detectCaps({ FoxbloomAndroid: { caps: () => 'not json' } } as never)).toEqual(plain);
  });
});
