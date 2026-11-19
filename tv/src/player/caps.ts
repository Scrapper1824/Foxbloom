/** What the player can play, in the shape the server's /start expects (see server/src/playback/decide.ts). */
export interface ClientCaps {
  mp4: boolean;
  webm: boolean;
  h264: boolean;
  hevc: boolean;
  av1: boolean;
  vp9: boolean;
  aac: boolean;
  mp3: boolean;
  opus: boolean;
  flac: boolean;
  ac3: boolean;
  eac3: boolean;
}

export type TvCaps = ClientCaps & {
  /** Plays Matroska files directly. */
  mkv: boolean;
  dts: boolean;
  /** Can pick one of the file's audio tracks itself (setAudio), so another language needs no conversion. */
  switchesAudio: true;
  /** Direct play already failed once: always convert. */
  forceConvert: boolean;
};

/** Just the parts of `window` this reads (so tests can pass a fake). */
export interface CapsEnv {
  webapis?: any;
  tizen?: any;
  MediaSource?: { isTypeSupported(type: string): boolean };
}

/** Tizen version by model year (the first two digits of the model code, e.g. "17_KANTM_UHD"). */
const TIZEN_BY_YEAR: Record<number, number> = { 2017: 3, 2018: 4, 2019: 5, 2020: 5.5, 2021: 6, 2022: 6.5, 2023: 7, 2024: 8 };

function modelYear(env: CapsEnv): number | null {
  try {
    const code = String(env.webapis.productinfo.getModelCode());
    const m = /^(\d{2})_/.exec(code);
    if (m) return 2000 + Number(m[1]);
  } catch (_e) {
    /* no productinfo (desktop) or no permission */
  }
  return null;
}

/** The TV's Tizen version, or 0 off the TV. A TV that won't say counts as the oldest supported (3.0). */
function tizenVersion(env: CapsEnv, year: number | null): number {
  if (!env.webapis && !env.tizen) return 0;
  if (year) return TIZEN_BY_YEAR[year] || (year > 2024 ? 8 : 3);
  try {
    const v = parseFloat(env.tizen.systeminfo.getCapability('http://tizen.org/feature/platform.version'));
    if (v > 0) return v;
  } catch (_e) {
    /* unknown */
  }
  return 3;
}

/**
 * What this TV plays without conversion: from the model year (webapis.productinfo) and MediaSource.isTypeSupported,
 * on top of what every supported Samsung TV plays (MP4/MKV, H.264, AAC, MP3; HEVC and Dolby audio from Tizen 3).
 * DTS only when the TV says so. On a desktop browser only the always-on basics plus what MediaSource reports.
 */
export function detectCaps(env: CapsEnv = window as unknown as CapsEnv): TvCaps {
  const ms = env.MediaSource;
  const can = (type: string) => {
    try {
      return !!ms && typeof ms.isTypeSupported === 'function' && ms.isTypeSupported(type);
    } catch (_e) {
      return false;
    }
  };
  const year = modelYear(env);
  const tizen = tizenVersion(env, year);
  return {
    mp4: true,
    mkv: true,
    h264: true,
    aac: true,
    mp3: true,
    webm: can('video/webm; codecs="vp9"') || can('video/webm; codecs="vp8"'),
    hevc: tizen >= 3 || can('video/mp4; codecs="hvc1.1.6.L120.90"') || can('video/mp4; codecs="hev1.1.6.L120.90"'),
    // AV1 hardware decoding came with the 2021 models (Tizen 6).
    av1: tizen >= 6 || can('video/mp4; codecs="av01.0.08M.08"'),
    vp9: can('video/webm; codecs="vp9"'),
    opus: can('audio/webm; codecs="opus"'),
    flac: can('audio/flac') || can('audio/mp4; codecs="flac"'),
    ac3: tizen >= 3 || can('audio/mp4; codecs="ac-3"'),
    eac3: tizen >= 3 || can('audio/mp4; codecs="ec-3"'),
    dts: can('audio/mp4; codecs="dtsc"') || can('audio/mp4; codecs="dtse"') || can('audio/mp4; codecs="dtsh"'),
    switchesAudio: true,
    forceConvert: false,
  };
}
