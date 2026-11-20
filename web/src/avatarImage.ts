/** Profile pictures are sent as 256x256 JPEGs: small enough for the TV, sharp enough for a big profile tile. */
export const AVATAR_SIZE = 256;
/** The server's limit (server/src/auth/avatars.ts). */
export const MAX_UPLOAD_BYTES = 256 * 1024;

/** The largest square in the middle of a w x h picture. */
export function centerSquare(w: number, h: number): { sx: number; sy: number; side: number } {
  const side = Math.min(w, h);
  return { sx: Math.round((w - side) / 2), sy: Math.round((h - side) / 2), side };
}

/** How many bytes a base64 data URL decodes to. */
export function dataUrlBytes(url: string): number {
  const b64 = url.slice(url.indexOf(',') + 1);
  const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - pad;
}

/** Reads a picture file, crops its middle square and shrinks it to a 256x256 JPEG data URL. */
export async function shrinkPicture(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Choose a picture file.');
  // Read as a data: URL, not URL.createObjectURL: the site's Content-Security-Policy allows data: images but not blob:.
  const url = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('That picture could not be read.'));
    r.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error('That picture could not be opened.'));
    i.src = url;
  });
  const { sx, sy, side } = centerSquare(img.naturalWidth, img.naturalHeight);
  const canvas = document.createElement('canvas');
  canvas.width = AVATAR_SIZE;
  canvas.height = AVATAR_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser cannot resize pictures.');
  ctx.fillStyle = '#ffffff'; // transparent PNGs become white, not black, as JPEG
  ctx.fillRect(0, 0, AVATAR_SIZE, AVATAR_SIZE);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, sx, sy, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
  for (const q of [0.88, 0.75, 0.6]) {
    const out = canvas.toDataURL('image/jpeg', q);
    if (dataUrlBytes(out) <= MAX_UPLOAD_BYTES) return out;
  }
  throw new Error('That picture is too detailed to shrink enough. Try another.');
}
