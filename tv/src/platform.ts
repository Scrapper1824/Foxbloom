/**
 * What the Android TV app (a WebView hosting this page) injects as `window.FoxbloomAndroid`.
 * Times are in milliseconds; `audioTracks` and `caps` return JSON text (the bridge can only pass strings and numbers).
 */
export interface AndroidBridge {
  open(url: string, startMs: number): void;
  play(): void;
  pause(): void;
  seek(ms: number): void;
  time(): number;
  duration(): number;
  audioTracks(): string;
  setAudio(index: number): void;
  close(): void;
  caps(): string;
  model(): string;
  exit(): void;
}

/** The Android bridge, or null when this page runs on a Samsung TV or a desktop browser. */
export function androidBridge(win: { FoxbloomAndroid?: AndroidBridge } = window as unknown as { FoxbloomAndroid?: AndroidBridge }): AndroidBridge | null {
  return win.FoxbloomAndroid || null;
}
