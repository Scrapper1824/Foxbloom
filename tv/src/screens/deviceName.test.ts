import { afterEach, describe, expect, it } from 'vitest';
import { deviceName } from './AddPerson';

const win = window as unknown as { FoxbloomAndroid?: unknown };

describe('deviceName on the Android app', () => {
  afterEach(() => {
    delete win.FoxbloomAndroid;
  });

  it('is the model the bridge reports, without a Samsung prefix', () => {
    win.FoxbloomAndroid = { model: () => 'Google Chromecast' };
    expect(deviceName()).toBe('Google Chromecast');
  });

  it('falls back to Android TV when the model is empty', () => {
    win.FoxbloomAndroid = { model: () => '  ' };
    expect(deviceName()).toBe('Android TV');
  });
});
