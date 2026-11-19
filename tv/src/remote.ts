export type Key = 'up' | 'down' | 'left' | 'right' | 'ok' | 'back' | 'play' | 'pause' | 'playpause' | 'ff' | 'rw' | 'digit';

// Typed loosely: the Tizen API only exists on the TV.
declare const tizen: any;

const TV_KEY_NAMES = ['MediaPlay', 'MediaPause', 'MediaPlayPause', 'MediaFastForward', 'MediaRewind', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

/** Asks the TV to deliver the media and number keys to the app (they are not sent by default). No-op off the TV. */
export function registerTvKeys(): void {
  if (typeof tizen === 'undefined' || !tizen || !tizen.tvinputdevice) return;
  for (const name of TV_KEY_NAMES) {
    try {
      tizen.tvinputdevice.registerKey(name);
    } catch (_e) {
      /* this TV model doesn't have that key */
    }
  }
}

const CODES: Record<number, Key> = {
  37: 'left',
  38: 'up',
  39: 'right',
  40: 'down',
  13: 'ok',
  10009: 'back',
  415: 'play',
  19: 'pause',
  10252: 'playpause',
  417: 'ff',
  412: 'rw',
};

/** Maps a keydown to a remote key; on a desktop browser Escape and Backspace act as Back. */
export function keyFromEvent(e: KeyboardEvent): { key: Key; digit?: number } | null {
  const code = e.keyCode;
  if (code >= 48 && code <= 57) return { key: 'digit', digit: code - 48 };
  const key = CODES[code];
  if (key) return { key };
  if (code === 27 || code === 8) return { key: 'back' };
  return null;
}
