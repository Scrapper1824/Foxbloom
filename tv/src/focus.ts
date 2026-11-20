export type Dir = 'up' | 'down' | 'left' | 'right';

const SELECTOR = '[data-focusable]';

/** Puts the focus ring on el. Tells listeners (the tile rows) with a bubbling 'foxfocus' event so they can slide their window. */
export function focusElement(el: HTMLElement, root: HTMLElement) {
  const old = root.querySelectorAll('.focused');
  for (let i = 0; i < old.length; i++) old[i].classList.remove('focused');
  el.classList.add('focused');
  // Not scrollIntoView({ block: 'nearest' }): Chromium before 61 reads the options object as `true` (align to top), so
  // every move would jump. scrollIntoViewIfNeeded(false) scrolls only when el is out of view, and as little as needed.
  const s = el as HTMLElement & { scrollIntoViewIfNeeded?: (center?: boolean) => void };
  if (typeof s.scrollIntoViewIfNeeded === 'function') s.scrollIntoViewIfNeeded(false);
  el.dispatchEvent(new Event('foxfocus', { bubbles: true }));
}
const setFocused = focusElement;

/** Focuses the first focusable element under root (in document order). */
export function focusFirst(root: HTMLElement): HTMLElement | null {
  const el = root.querySelector<HTMLElement>(SELECTOR);
  if (!el) return null;
  setFocused(el, root);
  return el;
}

/**
 * Moves the focus ring to the nearest focusable whose box lies in the given direction: distance along that axis
 * plus twice the offset across it, so straight-line neighbours win. Returns null (focus stays) when nothing is there.
 */
export function moveFocus(dir: Dir, root: HTMLElement): HTMLElement | null {
  const items = Array.prototype.slice.call(root.querySelectorAll(SELECTOR)) as HTMLElement[];
  const current = root.querySelector<HTMLElement>(SELECTOR + '.focused');
  if (!current) return focusFirst(root);
  const c = current.getBoundingClientRect();
  const cx = (c.left + c.right) / 2;
  const cy = (c.top + c.bottom) / 2;
  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  for (const el of items) {
    if (el === current) continue;
    const r = el.getBoundingClientRect();
    const x = (r.left + r.right) / 2;
    const y = (r.top + r.bottom) / 2;
    let primary: number;
    let cross: number;
    // How far apart the two boxes are across the move: 0 when they overlap at all. A key half under the current one
    // (the staggered keyboard rows) counts as straight ahead; otherwise the aligned key two rows down would win.
    const gapX = Math.max(0, Math.max(r.left, c.left) - Math.min(r.right, c.right));
    const gapY = Math.max(0, Math.max(r.top, c.top) - Math.min(r.bottom, c.bottom));
    let centre: number;
    if (dir === 'right') {
      if (x <= cx) continue;
      primary = r.left - c.right;
      cross = gapY;
      centre = Math.abs(y - cy);
    } else if (dir === 'left') {
      if (x >= cx) continue;
      primary = c.left - r.right;
      cross = gapY;
      centre = Math.abs(y - cy);
    } else if (dir === 'down') {
      if (y <= cy) continue;
      primary = r.top - c.bottom;
      cross = gapX;
      centre = Math.abs(x - cx);
    } else {
      if (y >= cy) continue;
      primary = c.top - r.bottom;
      cross = gapX;
      centre = Math.abs(x - cx);
    }
    // Centre offset only breaks ties between boxes that are equally near (e.g. two keys each half under this one).
    const score = Math.max(primary, 0) + 2 * cross + centre / 1000;
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  if (!best) return null;
  setFocused(best, root);
  return best;
}
