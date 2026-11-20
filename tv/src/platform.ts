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

/**
 * In the Android app: scale the page so its 1920 CSS px are exactly the screen's width. The app's WebView honours the
 * viewport tag's width=1920, but its initial-scale=1 (right on a Samsung TV) would show the page at 1 CSS px per dp,
 * and the app itself can only set a whole-percent zoom, which leaves a strip at 720p. `screenWidth` is in CSS px (dp).
 */
export function fitAndroidViewport(doc: Document, screenWidth: number): void {
  const meta = doc.querySelector('meta[name="viewport"]');
  if (!meta || !(screenWidth > 0)) return;
  meta.setAttribute('content', 'width=1920, height=1080, initial-scale=' + screenWidth / 1920);
}
