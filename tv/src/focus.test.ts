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

  it('returns null from the last column going right and keeps the focus', () => {
    focusFirst(root);
    moveFocus('right', root);
    moveFocus('right', root);
    expect(moveFocus('right', root)).toBeNull();
    expect(root.querySelector('.focused')!.id).toBe('b02');
  });
});
