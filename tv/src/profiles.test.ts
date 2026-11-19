import { beforeEach, describe, expect, it } from 'vitest';
import { loadState, removeProfile, saveState, upsertProfile, type Profile } from './profiles';

const p = (userId: number, extra: Partial<Profile> = {}): Profile => ({ userId, username: 'u' + userId, token: 't', pin: null, failedPins: 0, lockedUntil: 0, ...extra });

describe('profiles', () => {
  beforeEach(() => localStorage.clear());

  it('starts empty', () => {
    expect(loadState()).toEqual({ servers: null, profiles: [] });
  });
  it('survives corrupted JSON', () => {
    localStorage.setItem('foxbloom.tv.v1', '{not json');
    expect(loadState()).toEqual({ servers: null, profiles: [] });
    localStorage.setItem('foxbloom.tv.v1', '{"profiles":"x","servers":5}');
    expect(loadState()).toEqual({ servers: null, profiles: [] });
  });
  it('round-trips servers and upserts/removes profiles', () => {
    saveState({ servers: { publicUrl: 'https://a', localUrls: ['http://b'] }, profiles: [] });
    upsertProfile(p(1));
    upsertProfile(p(2));
    upsertProfile(p(1, { username: 'renamed' }));
    let s = loadState();
    expect(s.servers).toEqual({ publicUrl: 'https://a', localUrls: ['http://b'] });
    expect(s.profiles.map((x) => x.username)).toEqual(['renamed', 'u2']);
    removeProfile(1);
    s = loadState();
    expect(s.profiles.map((x) => x.userId)).toEqual([2]);
  });
});
