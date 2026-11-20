import { describe, expect, it } from 'vitest';
import { androidBridge, type AndroidBridge } from './platform';

describe('androidBridge', () => {
  it('is null when the page is not hosted by the Android app', () => {
    expect(androidBridge({})).toBeNull();
  });

  it('returns the bridge the Android app injects', () => {
    const fake = { model: () => 'Shield' } as unknown as AndroidBridge;
    expect(androidBridge({ FoxbloomAndroid: fake })).toBe(fake);
  });
});
