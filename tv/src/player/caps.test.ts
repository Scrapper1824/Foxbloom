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
