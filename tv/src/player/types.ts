/** What the player screen needs from a video player: AVPlay on the TV, a <video> element on a desktop browser. Times in seconds. */
export interface TvPlayer {
  /** Loads `url` and moves to `startAt`; resolves when it is ready to play, rejects when it cannot be opened. */
  open(url: string, startAt: number): Promise<void>;
  play(): void;
  pause(): void;
  /** Resolves false when the player refused the jump (AVPlay's error callback). */
  seek(seconds: number): Promise<boolean>;
  time(): number;
  duration(): number;
  /** The file's audio tracks, in file order; `index` is what setAudio takes. */
  audioTracks(): { index: number; language: string }[];
  setAudio(index: number): void;
  onEnded(cb: () => void): void;
  onError(cb: (msg: string) => void): void;
  onBuffering(cb: (on: boolean) => void): void;
  /** The player paused on its own (the Android app went to the background, another app took the sound). AVPlay and <video> never do. */
  onPaused?(cb: () => void): void;
  /** Stops and lets go of the video; open() may be called again afterwards. */
  close(): void;
}
