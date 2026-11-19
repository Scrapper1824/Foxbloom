import type { Profile } from './profiles';
import { sha256 } from './sha256';

const MAX_FAILS = 5;
const LOCK_MS = 30000;

function randomSalt(): string {
  let out = '';
  const c = (typeof crypto !== 'undefined' ? crypto : undefined) as Crypto | undefined;
  if (c && c.getRandomValues) {
    const a = new Uint8Array(8);
    c.getRandomValues(a);
    for (let i = 0; i < a.length; i++) out += ('0' + a[i].toString(16)).slice(-2);
    return out;
  }
  for (let i = 0; i < 16; i++) out += Math.floor(Math.random() * 16).toString(16);
  return out;
}

function hashPin(salt: string, pin: string): string {
  return sha256(salt + ':' + pin);
}

export function setPin(p: Profile, pin: string): Profile {
  if (!/^\d{4}$/.test(pin)) throw new Error('PIN must be exactly 4 digits');
  const salt = randomSalt();
  return { ...p, pin: { salt: salt, hash: hashPin(salt, pin) }, failedPins: 0, lockedUntil: 0 };
}

export function checkPin(p: Profile, pin: string, now: number = Date.now()): { ok: boolean; profile: Profile; waitSeconds: number } {
  if (!p.pin) return { ok: true, profile: p, waitSeconds: 0 };
  if (now < p.lockedUntil) return { ok: false, profile: p, waitSeconds: Math.ceil((p.lockedUntil - now) / 1000) };
  if (hashPin(p.pin.salt, pin) === p.pin.hash) {
    return { ok: true, profile: { ...p, failedPins: 0, lockedUntil: 0 }, waitSeconds: 0 };
  }
  const fails = p.failedPins + 1;
  if (fails >= MAX_FAILS) {
    return { ok: false, profile: { ...p, failedPins: 0, lockedUntil: now + LOCK_MS }, waitSeconds: LOCK_MS / 1000 };
  }
  return { ok: false, profile: { ...p, failedPins: fails }, waitSeconds: 0 };
}

export function clearPin(p: Profile): Profile {
  return { ...p, pin: null, failedPins: 0, lockedUntil: 0 };
}
