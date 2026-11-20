/** What the player screen needs from a video player: AVPlay on the TV, a <video> element on a desktop browser. Times in seconds. */
export interface TvPlayer {
  /** Which player this is ('samsung' AVPlay, 'builtin' <video>), for the diagnostics and what it remembers per player. */
  readonly name: string;
  /**
   * Loads `url` and moves to `startAt`; resolves when it is ready to play (false when the player refused to move to
   * `startAt`, so it plays from the start), rejects when it cannot be opened.
   */
  open(url: string, startAt: number): Promise<boolean>;
  play(): void;
  pause(): void;
  /** Resolves true when the player took the jump, false when it refused it (AVPlay's seekTo error callback). */
  seek(seconds: number): Promise<boolean>;
  time(): number;
  duration(): number;
  /** The file's audio tracks, in file order; `index` is what setAudio takes. */
  audioTracks(): { index: number; language: string }[];
  setAudio(index: number): void;
  onEnded(cb: () => void): void;
  onError(cb: (msg: string) => void): void;
  onBuffering(cb: (on: boolean) => void): void;
  /** Stops and lets go of the video; open() may be called again afterwards. */
  close(): void;
}
