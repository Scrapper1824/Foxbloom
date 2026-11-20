// When Back returns to a screen, the tile that had the focus before is focused again. App stores the tile's data-key
// when a screen is covered and sets it here when the screen is back; the screen (or App, for plain screens) takes it.
let pending: string | null = null;

export function setPendingFocus(key: string | null): void {
  pending = key;
}
/** The key waiting to be restored (rows use it to start their window at that tile). */
export function peekPendingFocus(): string | null {
  return pending;
}
/**
 * A menu button that was just chosen keeps the focus while its page loads: the page must not pull the focus down into
 * itself. Stays set until the next arrow press (App clears the pending key then).
 */
export const NAV_PREFIX = 'nav-';
export function holdingMenuFocus(): boolean {
  return !!pending && pending.indexOf(NAV_PREFIX) === 0;
}
export function takePendingFocus(): string | null {
  const k = pending;
  pending = null;
  return k;
}
