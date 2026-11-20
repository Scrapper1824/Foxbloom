import { describe, expect, it } from 'vitest';
import { pickPlayer } from './prefs';

describe('pickPlayer', () => {
  it('uses Samsung’s player on the TV unless Built-in was chosen', () => {
    expect(pickPlayer(undefined, true)).toBe('samsung');
    expect(pickPlayer('samsung', true)).toBe('samsung');
    expect(pickPlayer('builtin', true)).toBe('builtin');
  });
  it('uses the built-in player where there is no Samsung player (a desktop browser)', () => {
    expect(pickPlayer('samsung', false)).toBe('builtin');
    expect(pickPlayer(undefined, false)).toBe('builtin');
  });
});
