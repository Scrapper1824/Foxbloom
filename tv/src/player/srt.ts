export interface Cue {
  start: number;
  end: number;
  text: string;
}

const TIME = /(\d+):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d+):(\d{2}):(\d{2})[,.](\d{1,3})/;

const secs = (h: string, m: string, s: string, ms: string) => Number(h) * 3600 + Number(m) * 60 + Number(s) + Number((ms + '00').slice(0, 3)) / 1000;

/**
 * Reads SRT text into cues sorted by start time (seconds). Styling is dropped: ASS override tags left in by the
 * conversion (`{\an8}`) and HTML-ish tags (`<i>`, `<font …>`), since the TV shows subtitles as plain text.
 */
export function parseSrt(text: string): Cue[] {
  const cues: Cue[] = [];
  const blocks = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split(/\n\s*\n/);
  for (let b = 0; b < blocks.length; b++) {
    const lines = blocks[b].split('\n');
    let i = 0;
    while (i < lines.length && !TIME.test(lines[i])) i++;
    if (i >= lines.length) continue;
    const m = TIME.exec(lines[i])!;
    const body = lines
      .slice(i + 1)
      .join('\n')
      .replace(/\{\\[^}]*\}/g, '')
      .replace(/<[^>]*>/g, '')
      .replace(/^[ \t]+|[ \t]+$/gm, '')
      .replace(/^\n+|\n+$/g, '');
    if (!body) continue;
    cues.push({ start: secs(m[1], m[2], m[3], m[4]), end: secs(m[5], m[6], m[7], m[8]), text: body });
  }
  cues.sort((a, b) => a.start - b.start);
  return cues;
}

/** The text showing at `t` seconds ('' for none): the latest cue that has started, while it lasts. */
export function cueAt(cues: Cue[], t: number): string {
  let lo = 0;
  let hi = cues.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid].start <= t) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  // Overlapping cues: an earlier, longer one may still be showing.
  for (let i = found; i >= 0 && i > found - 3; i--) if (t < cues[i].end) return cues[i].text;
  return '';
}
