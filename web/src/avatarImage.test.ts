import { describe, expect, it } from 'vitest';
import { AVATAR_SIZE, centerSquare, MAX_UPLOAD_BYTES, dataUrlBytes } from './avatarImage';

describe('profile picture shrinking', () => {
  it('takes the middle square of a wide picture', () => {
    expect(centerSquare(1920, 1080)).toEqual({ sx: 420, sy: 0, side: 1080 });
  });
  it('takes the middle square of a tall picture', () => {
    expect(centerSquare(600, 1000)).toEqual({ sx: 0, sy: 200, side: 600 });
  });
  it('leaves a square picture whole', () => {
    expect(centerSquare(300, 300)).toEqual({ sx: 0, sy: 0, side: 300 });
  });
  it('measures a data URL by its decoded size', () => {
    expect(dataUrlBytes('data:image/jpeg;base64,' + btoa('abcdef'))).toBe(6);
    expect(dataUrlBytes('data:image/jpeg;base64,' + btoa('abcd'))).toBe(4);
  });
  it('sends 256x256 pictures, under the server limit', () => {
    expect(AVATAR_SIZE).toBe(256);
    expect(MAX_UPLOAD_BYTES).toBe(256 * 1024);
  });
});
