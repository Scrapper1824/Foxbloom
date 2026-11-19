import type { Servers } from './connection';

const KEY = 'foxbloom.tv.v1';

export interface Profile {
  userId: number;
  username: string;
  /** null = needs signing in again */
  token: string | null;
  pin: { salt: string; hash: string } | null;
  failedPins: number;
  lockedUntil: number;
}
export interface State {
  servers: Servers | null;
  profiles: Profile[];
}

function validServers(s: any): s is Servers {
  return !!s && typeof s.publicUrl === 'string' && Array.isArray(s.localUrls);
}
function validProfile(p: any): p is Profile {
  return !!p && typeof p.userId === 'number' && typeof p.username === 'string';
}

export function loadState(): State {
  const empty: State = { servers: null, profiles: [] };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return empty;
    const o = JSON.parse(raw);
    if (!o || typeof o !== 'object') return empty;
    return {
      servers: validServers(o.servers) ? o.servers : null,
      profiles: Array.isArray(o.profiles) ? o.profiles.filter(validProfile) : [],
    };
  } catch (e) {
    return empty;
  }
}

export function saveState(s: State): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch (e) {
    /* storage unavailable or full: keep running in memory */
  }
}

export function upsertProfile(p: Profile): Profile[] {
  const s = loadState();
  let found = false;
  s.profiles = s.profiles.map(function (x) {
    if (x.userId === p.userId) { found = true; return p; }
    return x;
  });
  if (!found) s.profiles.push(p);
  saveState(s);
  return s.profiles;
}

export function removeProfile(userId: number): Profile[] {
  const s = loadState();
  s.profiles = s.profiles.filter(function (x) { return x.userId !== userId; });
  saveState(s);
  return s.profiles;
}

export function markSignedOut(userId: number): Profile[] {
  const s = loadState();
  s.profiles = s.profiles.map(function (x) {
    return x.userId === userId ? { ...x, token: null } : x;
  });
  saveState(s);
  return s.profiles;
}
