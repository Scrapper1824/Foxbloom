import { beforeEach, describe, expect, it } from 'vitest';
import { checkPin, clearPin, setPin } from './pin';
import { loadState, saveState, type Profile } from './profiles';

const base: Profile = { userId: 1, username: 'a', token: 't', pin: null, failedPins: 0, lockedUntil: 0 };

describe('pin', () => {
  beforeEach(() => localStorage.clear());

  it('accepts the right pin, rejects the wrong one', () => {
    const p = setPin(base, '1234');
    expect(p.pin!.salt).toMatch(/^[0-9a-f]{16}$/);
    expect(checkPin(p, '1234', 0).ok).toBe(true);
    const bad = checkPin(p, '0000', 0);
    expect(bad.ok).toBe(false);
    expect(bad.profile.failedPins).toBe(1);
    expect(bad.waitSeconds).toBe(0);
  });
  it('success resets counters', () => {
    let p = setPin(base, '1234');
    p = checkPin(p, '1111', 0).profile;
    const r = checkPin(p, '1234', 0);
    expect(r.ok).toBe(true);
    expect(r.profile.failedPins).toBe(0);
  });
  it('locks for 30s after 5 wrong tries, refusing the correct pin until then', () => {
    let p = setPin(base, '1234');
    let r = checkPin(p, '9999', 1000);
    p = r.profile;
    for (let i = 0; i < 4; i++) {
      r = checkPin(p, '9999', 1000);
      p = r.profile;
    }
    expect(r.ok).toBe(false);
    expect(r.waitSeconds).toBe(30);
    expect(p.lockedUntil).toBe(31000);
    const during = checkPin(p, '1234', 20000);
    expect(during.ok).toBe(false);
    expect(during.waitSeconds).toBe(11);
    expect(checkPin(p, '1234', 31000).ok).toBe(true);
  });
  it('rejects non 4-digit pins', () => {
    expect(() => setPin(base, '12a4')).toThrow();
    expect(() => setPin(base, '12345')).toThrow();
    expect(() => setPin(base, '123')).toThrow();
  });
  it('stores no plain pin; clearPin removes it', () => {
    const p = setPin(base, '4821');
    saveState({ servers: null, profiles: [p] });
    expect(localStorage.getItem('foxbloom.tv.v1')).not.toContain('4821');
    expect(loadState().profiles[0].pin).toEqual(p.pin);
    expect(clearPin(p).pin).toBeNull();
  });
});
