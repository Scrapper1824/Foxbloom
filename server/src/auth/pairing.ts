import crypto from 'node:crypto';
import { createSession } from './sessions.js';

/**
 * TV pairing: the TV asks for a short code, a signed-in person types it (or scans the QR) on their phone or PC,
 * and the TV then collects a session token for that person. Pending codes live in memory only.
 */
export const PAIR_TTL_S = 600;
const PAIR_TTL_MS = PAIR_TTL_S * 1000;
const MAX_PENDING = 50;
const MAX_STARTS_PER_IP = 20;
// No 0/O/1/I, which are easy to misread on a TV.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

interface Pending {
  code: string;
  deviceName: string;
  expiresAt: number;
  userId?: number;
  token?: string;
}

const pending = new Map<string, Pending>(); // pairId -> pending (insertion order = oldest first)
const starts = new Map<string, number[]>(); // ip -> start times, for the pair-start limit
// Wrong-code guesses at /api/tv/link(/check), per IP and separate from password-login limits.
const MAX_WRONG_PER_IP = 10;
const LINK_LOCK_MS = 15 * 60_000;
const wrong = new Map<string, { times: number[]; lockedUntil: number }>();

function prune(nowMs: number) {
  for (const [id, p] of pending) if (p.expiresAt <= nowMs) pending.delete(id);
}

const randomCode = () => {
  let s = '';
  for (let i = 0; i < 4; i++) s += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return 'FXB-' + s;
};

const normalize = (code: string) => {
  const c = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return c.length === 4 ? 'FXB' + c : c;
};

/** True when this IP has started too many pairings recently (and counts this attempt if not). */
export function pairStartLimited(ip: string, nowMs = Date.now()): boolean {
  const recent = (starts.get(ip) ?? []).filter((t) => nowMs - t < PAIR_TTL_MS);
  if (recent.length >= MAX_STARTS_PER_IP) {
    starts.set(ip, recent);
    return true;
  }
  recent.push(nowMs);
  starts.set(ip, recent);
  return false;
}

export function startPairing(deviceName: string): { code: string; pairId: string; expiresIn: number } {
  const nowMs = Date.now();
  prune(nowMs);
  while (pending.size >= MAX_PENDING) pending.delete(pending.keys().next().value as string);
  const taken = new Set([...pending.values()].map((p) => p.code));
  let code = randomCode();
  while (taken.has(code)) code = randomCode();
  const pairId = crypto.randomBytes(32).toString('base64url');
  pending.set(pairId, { code, deviceName, expiresAt: nowMs + PAIR_TTL_MS });
  return { code, pairId, expiresIn: PAIR_TTL_S };
}

export type PollResult = { status: 'waiting' } | { status: 'expired' } | { status: 'done'; token: string; userId: number };

export function pollPairing(pairId: string): PollResult {
  const nowMs = Date.now();
  const p = pending.get(pairId);
  if (!p) return { status: 'expired' };
  if (p.expiresAt <= nowMs) {
    pending.delete(pairId);
    return { status: 'expired' };
  }
  if (!p.token || p.userId === undefined) return { status: 'waiting' };
  pending.delete(pairId); // handed out once
  return { status: 'done', token: p.token, userId: p.userId };
}

/** Seconds until this IP may try another code, or 0. */
export function linkLockedFor(ip: string, nowMs = Date.now()): number {
  const w = wrong.get(ip);
  return w && w.lockedUntil > nowMs ? Math.ceil((w.lockedUntil - nowMs) / 1000) : 0;
}

export function recordWrongCode(ip: string, nowMs = Date.now()) {
  const w = wrong.get(ip) ?? { times: [], lockedUntil: 0 };
  w.times = w.times.filter((t) => nowMs - t < LINK_LOCK_MS);
  w.times.push(nowMs);
  if (w.times.length >= MAX_WRONG_PER_IP) {
    w.lockedUntil = nowMs + LINK_LOCK_MS;
    w.times = [];
  }
  wrong.set(ip, w);
}

function find(code: string): Pending | undefined {
  prune(Date.now());
  const wanted = normalize(code);
  for (const p of pending.values()) if (!p.token && normalize(p.code) === wanted) return p;
  return undefined;
}

/** The TV's name for a pending, unlinked code (links nothing). */
export function checkPairing(code: string): { deviceName: string } | null {
  const p = find(code);
  return p ? { deviceName: p.deviceName } : null;
}

/** Attach the signed-in user to the pending code. Returns the TV's name, or null for a wrong or expired code. */
export function linkPairing(code: string, userId: number, ip: string): { deviceName: string } | null {
  const p = find(code);
  if (!p) return null;
  p.userId = userId;
  p.token = createSession(userId, ip, 'Foxbloom TV — ' + p.deviceName);
  return { deviceName: p.deviceName };
}

/** For tests. */
export function resetPairing() {
  pending.clear();
  starts.clear();
  wrong.clear();
}
