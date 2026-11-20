import { beforeEach, describe, expect, it } from 'vitest';
import { focusElement, focusFirst, moveFocus } from './focus';

/** A 3x3 grid of 100px boxes with 20px gaps; box ids are "r-c". */
function grid(): HTMLElement {
  const root = document.createElement('div');
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const el = document.createElement('div');
      el.id = 'b' + r + c;
      el.setAttribute('data-focusable', '');
      const left = c * 120;
      const top = r * 120;
      el.getBoundingClientRect = () => ({ left, top, right: left + 100, bottom: top + 100, width: 100, height: 100, x: left, y: top, toJSON() {} }) as DOMRect;
      el.scrollIntoView = () => {};
      root.appendChild(el);
    }
  }
  document.body.innerHTML = '';
  document.body.appendChild(root);
  return root;
}

describe('focusElement scrolling', () => {
  it('uses scrollIntoViewIfNeeded(false) and never scrollIntoView (Chromium 47 reads its options object as true)', () => {
    const root = document.createElement('div');
    const el = document.createElement('div') as HTMLElement & { scrollIntoViewIfNeeded?: (center?: boolean) => void };
    root.appendChild(el);
    const calls: string[] = [];
    el.scrollIntoView = () => calls.push('scrollIntoView');
    el.scrollIntoViewIfNeeded = (center?: boolean) => calls.push('ifNeeded ' + center);
    focusElement(el, root);
    expect(calls).toEqual(['ifNeeded false']);
  });

  it('skips scrolling when scrollIntoViewIfNeeded is missing', () => {
    const root = document.createElement('div');
    const el = document.createElement('div');
    root.appendChild(el);
    const calls: string[] = [];
    el.scrollIntoView = () => calls.push('scrollIntoView');
    focusElement(el, root);
    expect(calls).toEqual([]);
    expect(el.classList.contains('focused')).toBe(true);
  });
});

describe('focus', () => {
  let root: HTMLElement;
  beforeEach(() => {
    root = grid();
  });

  it('focusFirst focuses the first focusable and marks it', () => {
    expect(focusFirst(root)!.id).toBe('b00');
    expect(root.querySelectorAll('.focused').length).toBe(1);
  });

  it('moves right and down to the nearest neighbour', () => {
    focusFirst(root);
    expect(moveFocus('right', root)!.id).toBe('b01');
    expect(moveFocus('down', root)!.id).toBe('b11');
    expect(root.querySelectorAll('.focused').length).toBe(1);
    expect(root.querySelector('#b11')!.classList.contains('focused')).toBe(true);
  });

  it('down on a keyboard with a half-key offset row goes to the next row, not the aligned one after it', () => {
    // Like the on-screen keyboard: rows 0 and 2 have keys at x = 0, 84, 168…; row 1 is offset by half a key (42).
    const kb = document.createElement('div');
    const add = (id: string, left: number, top: number) => {
      const el = document.createElement('div');
      el.id = id;
      el.setAttribute('data-focusable', '');
      el.getBoundingClientRect = () => ({ left, top, right: left + 76, bottom: top + 64, width: 76, height: 64, x: left, y: top, toJSON() {} }) as DOMRect;
      kb.appendChild(el);
    };
    for (let c = 0; c < 4; c++) add('q' + c, c * 84, 0);
    for (let c = 0; c < 3; c++) add('a' + c, 42 + c * 84, 80);
    for (let c = 0; c < 4; c++) add('z' + c, c * 84, 160);
    document.body.innerHTML = '';
    document.body.appendChild(kb);
    focusElement(kb.querySelector('#q1') as HTMLElement, kb);
    expect(moveFocus('down', kb)!.id).toBe('a0');
    expect(moveFocus('down', kb)!.id).toMatch(/^z[01]$/);
    expect(moveFocus('up', kb)!.id).toMatch(/^a/);
    expect(moveFocus('up', kb)!.id).toMatch(/^q/);
  });

  it('keeps the focus ring when a re-render rewrites the class (e.g. Shift turning on)', async () => {
    focusFirst(root);
    moveFocus('right', root);
    const el = root.querySelector('#b01') as HTMLElement;
    el.className = 'key on'; // what Preact does when the class prop changes
    await Promise.resolve();
    expect(el.classList.contains('focused')).toBe(true);
    expect(moveFocus('down', root)!.id).toBe('b11');
  });

  it('moves from the remembered element even before the ring is put back', () => {
    focusFirst(root);
    moveFocus('right', root);
    (root.querySelector('#b01') as HTMLElement).className = '';
    expect(moveFocus('right', root)!.id).toBe('b02');
  });

  it('Up stays inside a scrolling area until its top, then leaves it', () => {
    // A menu bar at y=0, and a scrolled area whose first item has scrolled above the menu (y = -300).
    const page = document.createElement('div');
    const box = (id: string, left: number, top: number, parent: HTMLElement) => {
      const el = document.createElement('div');
      el.id = id;
      el.setAttribute('data-focusable', '');
      el.getBoundingClientRect = () => ({ left, top, right: left + 100, bottom: top + 60, width: 100, height: 60, x: left, y: top, toJSON() {} }) as DOMRect;
      parent.appendChild(el);
    };
    box('menu', 0, 0, page);
    const area = document.createElement('div');
    area.setAttribute('data-scroll-area', '');
    page.appendChild(area);
    box('hero', 0, -300, area);
    box('row', 0, 200, area);
    document.body.innerHTML = '';
    document.body.appendChild(page);
    focusElement(page.querySelector('#row') as HTMLElement, page);
    const hero = moveFocus('up', page)!;
    expect(hero.id).toBe('hero');
    // The area scrolls to show it, below the menu bar.
    hero.getBoundingClientRect = () => ({ left: 0, top: 100, right: 100, bottom: 160, width: 100, height: 60, x: 0, y: 100, toJSON() {} }) as DOMRect;
    expect(moveFocus('up', page)!.id).toBe('menu');
  });

  it('scrolls a scrolling area back to its top when the focus reaches its first part', () => {
    const area = document.createElement('div');
    area.setAttribute('data-scroll-area', '');
    Object.defineProperty(area, 'clientHeight', { value: 800 });
    area.getBoundingClientRect = () => ({ left: 0, top: 100, right: 1000, bottom: 900, width: 1000, height: 800, x: 0, y: 100, toJSON() {} }) as DOMRect;
    const el = document.createElement('div');
    el.setAttribute('data-focusable', '');
    // Its top is 60px above the area's visible top while the area is scrolled 300px: 240px into the content.
    el.getBoundingClientRect = () => ({ left: 0, top: 40, right: 100, bottom: 100, width: 100, height: 60, x: 0, y: 40, toJSON() {} }) as DOMRect;
    area.appendChild(el);
    document.body.innerHTML = '';
    document.body.appendChild(area);
    area.scrollTop = 300;
    focusElement(el, area);
    expect(area.scrollTop).toBe(0);
  });

  it('a row that is not fully in view scrolls to the top of the area, leaving no half-cut row above it', () => {
    const area = document.createElement('div');
    area.setAttribute('data-scroll-area', '');
    Object.defineProperty(area, 'clientHeight', { value: 800 });
    area.getBoundingClientRect = () => ({ left: 0, top: 100, right: 1000, bottom: 900, width: 1000, height: 800, x: 0, y: 100, toJSON() {} }) as DOMRect;
    const section = document.createElement('section');
    section.className = 'row-section';
    // 1200px into the content while scrolled 600: its top is at 700 on screen, its bottom (1150) below the area.
    section.getBoundingClientRect = () => ({ left: 0, top: 700, right: 1000, bottom: 1150, width: 1000, height: 450, x: 0, y: 700, toJSON() {} }) as DOMRect;
    const el = document.createElement('div');
    el.setAttribute('data-focusable', '');
    el.getBoundingClientRect = () => ({ left: 0, top: 750, right: 200, bottom: 1100, width: 200, height: 350, x: 0, y: 750, toJSON() {} }) as DOMRect;
    section.appendChild(el);
    area.appendChild(section);
    document.body.innerHTML = '';
    document.body.appendChild(area);
    area.scrollTop = 600;
    focusElement(el, area);
    expect(area.scrollTop).toBe(1200);
  });

  it('returns null from the last column going right and keeps the focus', () => {
    focusFirst(root);
    moveFocus('right', root);
    moveFocus('right', root);
    expect(moveFocus('right', root)).toBeNull();
    expect(root.querySelector('.focused')!.id).toBe('b02');
  });
});
