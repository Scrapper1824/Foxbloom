import { afterEach, describe, expect, it, vi } from 'vitest';
import { getNavLayout, setNavLayout } from './navLayout';

function fakeStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    m,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('nav layout', () => {
  it('defaults to the top bar', () => {
    vi.stubGlobal('localStorage', fakeStorage());
    expect(getNavLayout()).toBe('top');
  });

  it('remembers the rail, and forgets it again for the default', () => {
    const s = fakeStorage();
    vi.stubGlobal('localStorage', s);
    setNavLayout('rail');
    expect(getNavLayout()).toBe('rail');
    setNavLayout('top');
    expect(getNavLayout()).toBe('top');
    expect(s.m.size).toBe(0);
  });

  it('treats unknown values and blocked storage as the top bar', () => {
    const s = fakeStorage();
    s.setItem('foxbloom.navLayout', 'sideways');
    vi.stubGlobal('localStorage', s);
    expect(getNavLayout()).toBe('top');
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
    });
    expect(getNavLayout()).toBe('top');
  });
});
