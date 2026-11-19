import { beforeEach, describe, expect, it } from 'vitest';
import { loadState, saveState, type Profile } from './profiles';
import { Session } from './session';
import { routeFetch } from './testing';

const person: Profile = { userId: 1, username: 'owner', token: 'tok', pin: null, failedPins: 0, lockedUntil: 0 };

describe('Session.info', () => {
  beforeEach(() => localStorage.clear());

  it('saves the home addresses a signed-in status lists, keeping the public address', async () => {
    saveState({ servers: { publicUrl: 'https://pub.test', localUrls: ['http://192.168.1.5:7979'] }, profiles: [person] });
    const rf = routeFetch({ '/api/auth/status': { setupRequired: false, version: '1.2.3', localUrls: ['http://10.0.0.9:7979'] } });
    const info = await new Session(person, rf.fetchFn).info();
    expect(info.version).toBe('1.2.3');
    expect(loadState().servers).toEqual({ publicUrl: 'https://pub.test', localUrls: ['http://10.0.0.9:7979'] });
    expect(loadState().profiles).toEqual([person]);
  });

  it('leaves the saved addresses alone when the status lists none', async () => {
    saveState({ servers: { publicUrl: 'https://pub.test', localUrls: ['http://192.168.1.5:7979'] }, profiles: [person] });
    const rf = routeFetch({ '/api/auth/status': { setupRequired: false, version: '1.2.3' } });
    await new Session(person, rf.fetchFn).info();
    expect(loadState().servers!.localUrls).toEqual(['http://192.168.1.5:7979']);
  });
});
