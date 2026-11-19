import { act } from 'preact/test-utils';
import { render } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App, useNav } from './app';
import type { Nav } from './app';

let nav: Nav;
function Root() {
  nav = useNav();
  return <button data-focusable>root</button>;
}
const rootScreen = { name: 'root', render: () => <Root /> };
const pushed = { name: 'pushed', render: () => <div id="pushed">pushed</div> };

function press(keyCode: number) {
  act(() => {
    window.dispatchEvent(Object.assign(new Event('keydown', { cancelable: true }), { keyCode }));
  });
}

describe('App', () => {
  const exit = vi.fn();
  let host: HTMLElement;
  beforeEach(() => {
    exit.mockClear();
    (globalThis as any).tizen = { application: { getCurrentApplication: () => ({ exit }) } };
    host = document.createElement('div');
    document.body.appendChild(host);
    act(() => {
      render(<App initial={rootScreen} />, host);
    });
  });
  afterEach(() => {
    act(() => {
      render(null, host);
    });
    host.remove();
    delete (globalThis as any).tizen;
  });

  it('asks to exit on Back at the root, and OK exits', () => {
    press(10009);
    expect(host.textContent).toContain('Exit Foxbloom?');
    expect(exit).not.toHaveBeenCalled();
    press(13);
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it('Back on the exit prompt dismisses it', () => {
    press(10009);
    press(10009);
    expect(host.textContent).not.toContain('Exit Foxbloom?');
    expect(host.textContent).toContain('root');
  });

  it('Back pops a pushed screen instead of asking to exit', () => {
    act(() => nav.push(pushed));
    expect(host.querySelector('#pushed')).not.toBeNull();
    press(10009);
    expect(host.querySelector('#pushed')).toBeNull();
    expect(host.textContent).not.toContain('Exit Foxbloom?');
  });

  it('replace swaps the top screen', () => {
    act(() => nav.replace(pushed));
    expect(host.querySelector('#pushed')).not.toBeNull();
    expect(host.textContent).not.toContain('root');
  });

  it('leaves keys alone while a text field is focused', () => {
    const input = document.createElement('input');
    host.appendChild(input);
    input.focus();
    const ev = Object.assign(new Event('keydown', { cancelable: true, bubbles: true }), { keyCode: 8 });
    act(() => {
      input.dispatchEvent(ev);
    });
    expect(ev.defaultPrevented).toBe(false);
    expect(host.textContent).not.toContain('Exit Foxbloom?');
    const esc = Object.assign(new Event('keydown', { cancelable: true, bubbles: true }), { keyCode: 10009 });
    act(() => {
      input.dispatchEvent(esc);
    });
    expect(document.activeElement).not.toBe(input);
    expect(host.textContent).not.toContain('Exit Foxbloom?');
  });
});
