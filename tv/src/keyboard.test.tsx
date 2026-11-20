import { act } from 'preact/test-utils';
import { render } from 'preact';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Field } from './keyboard';

describe('Field', () => {
  let host: HTMLElement;
  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
  });
  afterEach(() => {
    act(() => render(null, host));
    host.remove();
    delete (window as any).FoxbloomAndroid;
  });

  const input = () => host.querySelector('input')!;
  const mount = () => act(() => render(<Field label="Address" value="" onValue={() => {}} active onActivate={() => {}} />, host));

  it('in the Android app, never brings up the system keyboard (the on-screen one types)', () => {
    (window as any).FoxbloomAndroid = {};
    mount();
    expect(input().getAttribute('inputmode')).toBe('none');
  });

  it('on a Samsung TV or a browser, the input is left as it was', () => {
    mount();
    expect(input().hasAttribute('inputmode')).toBe(false);
  });
});
