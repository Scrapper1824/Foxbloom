export type Dir = 'up' | 'down' | 'left' | 'right';

const SELECTOR = '[data-focusable]';
const AREA = '[data-scroll-area]';

/**
 * The element that has the focus ring. Remembered here, not only as a class, because Preact rewrites an element's
 * whole class attribute when its class prop changes (Shift turning on, a menu button becoming current), which wiped
 * the ring and sent the next arrow press back to the first button on the screen.
 */
let remembered: HTMLElement | null = null;
const watched: HTMLElement[] = [];

function watch(root: HTMLElement) {
  if (watched.indexOf(root) >= 0 || typeof MutationObserver === 'undefined') return;
  watched.push(root);
  new MutationObserver(() => {
    if (remembered && !remembered.classList.contains('focused') && root.contains(remembered)) remembered.classList.add('focused');
  }).observe(root, { attributes: true, attributeFilter: ['class'], subtree: true });
}

function areaOf(el: Element): HTMLElement | null {
  return el.closest ? (el.closest(AREA) as HTMLElement | null) : null;
}

/**
 * Scrolls a scrolling area (the Home and Library pages) by whole rows: near its top it shows the very top (so the banner
 * above the first buttons isn't cut off); otherwise a row that isn't fully in view is lined up with the area's top, so
 * no half-cut row is left showing above it.
 */
function scrollArea(el: HTMLElement, area: HTMLElement) {
  const a = area.getBoundingClientRect();
  const intoContent = el.getBoundingClientRect().top - a.top + area.scrollTop;
  if (intoContent < area.clientHeight / 2) {
    if (area.scrollTop) area.scrollTop = 0;
    return;
  }
  const part = (el.closest && (el.closest('.row-section') as HTMLElement | null)) || el;
  const r = part.getBoundingClientRect();
  if (r.top < a.top || r.bottom > a.bottom) area.scrollTop += r.top - a.top;
}

/** Puts the focus ring on el. Tells listeners (the tile rows) with a bubbling 'foxfocus' event so they can slide their window. */
export function focusElement(el: HTMLElement, root: HTMLElement) {
  const old = root.querySelectorAll('.focused');
  for (let i = 0; i < old.length; i++) old[i].classList.remove('focused');
  el.classList.add('focused');
  remembered = el;
  watch(root);
  // Not scrollIntoView({ block: 'nearest' }): Chromium before 61 reads the options object as `true` (align to top), so
  // every move would jump. scrollIntoViewIfNeeded(false) scrolls only when el is out of view, and as little as needed.
  const s = el as HTMLElement & { scrollIntoViewIfNeeded?: (center?: boolean) => void };
  const area = areaOf(el);
  if (area) scrollArea(el, area);
  else if (typeof s.scrollIntoViewIfNeeded === 'function') s.scrollIntoViewIfNeeded(false);
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
  const marked = root.querySelector<HTMLElement>(SELECTOR + '.focused');
  const current = marked || (remembered && root.contains(remembered) ? remembered : null);
  if (!current) return focusFirst(root);
  // Up and down stay inside the current scrolling area while it has something that way: its top part may be scrolled
  // out of sight, and the menu bar above it would otherwise look nearer than the area's own first buttons.
  const area = dir === 'up' || dir === 'down' ? areaOf(current) : null;
  const c = current.getBoundingClientRect();
  const cx = (c.left + c.right) / 2;
  const cy = (c.top + c.bottom) / 2;
  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  for (let pass = area ? 0 : 1; pass < 2 && !best; pass++) {
    const stayIn = pass === 0 ? area : null;
    for (const el of items) {
    if (el === current) continue;
    if (stayIn && !stayIn.contains(el)) continue;
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
  }
  if (!best) return null;
  setFocused(best, root);
  return best;
}
