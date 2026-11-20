/** Per-person player settings on this TV (quality, auto-skip), kept in localStorage next to the profiles. */
export interface Prefs {
  quality?: Quality;
  autoSkip?: boolean;
  /** Samsung's player (AVPlay) or the TV browser's built-in one. */
  player?: PlayerKind;
}
export type PlayerKind = 'samsung' | 'builtin';
export type Quality = 'auto' | 'original' | '1080' | '720' | '480';
export const QUALITIES: Quality[] = ['auto', 'original', '1080', '720', '480'];

const key = (userId: number) => 'foxbloom.tv.prefs.' + userId;

function load(userId: number): Prefs {
  try {
    const o = JSON.parse(localStorage.getItem(key(userId)) || '{}');
    return o && typeof o === 'object' ? o : {};
  } catch (_e) {
    return {};
  }
}

export function getPref<K extends keyof Prefs>(userId: number, name: K): Prefs[K] {
  return load(userId)[name];
}

export function setPref<K extends keyof Prefs>(userId: number, name: K, value: Prefs[K]): void {
  const p = load(userId);
  p[name] = value;
  try {
    localStorage.setItem(key(userId), JSON.stringify(p));
  } catch (_e) {
    /* storage full or unavailable: the choice lasts until the app closes */
  }
}

/** The player to use: the saved choice, Samsung's where the TV has it, otherwise the built-in one. */
export function pickPlayer(saved: PlayerKind | undefined, hasSamsung: boolean): PlayerKind {
  return hasSamsung && saved !== 'builtin' ? 'samsung' : 'builtin';
}

/** The saved quality, or Auto. */
export function savedQuality(userId: number): Quality {
  const q = getPref(userId, 'quality');
  return q && QUALITIES.indexOf(q) >= 0 ? q : 'auto';
}
