/**
 * A small in-app diagnostics log, shown on the player when you press 0 on the remote. The TV gives no console we can
 * read, so this is how to see what Samsung's player is told and answers (seeks, states, errors) on a real TV.
 */
const MAX = 18;
const lines: string[] = [];
const subs: Array<() => void> = [];
const t0 = Date.now();
let status: () => string = () => '';

export function dlog(msg: string): void {
  lines.push(((Date.now() - t0) / 1000).toFixed(1) + 's ' + msg);
  if (lines.length > MAX) lines.shift();
  for (let i = 0; i < subs.length; i++) subs[i]();
}

export function dlines(): string[] {
  return lines.slice();
}

export function onDlog(f: () => void): () => void {
  subs.push(f);
  return () => {
    const i = subs.indexOf(f);
    if (i >= 0) subs.splice(i, 1);
  };
}

/** A live one-line status (the player's state and clock), read each time the panel draws. */
export function setDstatus(f: () => string): void {
  status = f;
}
export function dstatus(): string {
  try {
    return status();
  } catch (_e) {
    return '';
  }
}

/** An error callback's argument as readable text (AVPlay passes objects, strings or nothing). */
export function errText(e: unknown): string {
  if (e === undefined || e === null) return String(e);
  if (typeof e === 'string') return e;
  const o = e as { name?: string; message?: string; code?: number };
  if (o.name || o.message || o.code !== undefined) return [o.name, o.code, o.message].filter((x) => x !== undefined && x !== '').join(' ');
  try {
    return JSON.stringify(e);
  } catch (_x) {
    return String(e);
  }
}
