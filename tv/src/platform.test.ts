import { describe, expect, it } from 'vitest';
import { androidBridge, fitAndroidViewport, type AndroidBridge } from './platform';

describe('androidBridge', () => {
  it('is null when the page is not hosted by the Android app', () => {
    expect(androidBridge({})).toBeNull();
  });

  it('returns the bridge the Android app injects', () => {
    const fake = { model: () => 'Shield' } as unknown as AndroidBridge;
    expect(androidBridge({ FoxbloomAndroid: fake })).toBe(fake);
  });
});

describe('fitAndroidViewport', () => {
  const page = () => {
    const doc = document.implementation.createHTMLDocument('x');
    const meta = doc.createElement('meta');
    meta.name = 'viewport';
    meta.content = 'width=1920, height=1080, initial-scale=1';
    doc.head.appendChild(meta);
    return { doc, meta };
  };

  it('zooms the 1920 px page to exactly the screen width (720p, 1080p, 4K at density 2)', () => {
    for (const [w, scale] of [[640, '0.3333333333333333'], [960, '0.5'], [1920, '1']] as const) {
      const { doc, meta } = page();
      fitAndroidViewport(doc, w);
      expect(meta.content).toBe('width=1920, height=1080, initial-scale=' + scale);
    }
  });

  it('leaves the page alone without a usable screen width or viewport tag', () => {
    const { doc, meta } = page();
    fitAndroidViewport(doc, 0);
    expect(meta.content).toBe('width=1920, height=1080, initial-scale=1');
    fitAndroidViewport(document.implementation.createHTMLDocument('y'), 960); // no throw
  });
});
