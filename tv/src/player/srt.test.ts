import { describe, expect, it } from 'vitest';
import { cueAt, parseSrt } from './srt';

const SAMPLE = [
  '1',
  '00:00:01,000 --> 00:00:04,000',
  '<i>Hello</i> there',
  '',
  '2',
  '00:00:05,500 --> 00:00:07,250',
  '{\\an8}Top line',
  '<font color="#ffffff">second</font> line',
  '',
  '3',
  '01:00:00,000 --> 01:00:02,000',
  'Bye',
  '',
].join('\r\n');

describe('parseSrt', () => {
  it('reads cues, times in seconds, without tags', () => {
    expect(parseSrt(SAMPLE)).toEqual([
      { start: 1, end: 4, text: 'Hello there' },
      { start: 5.5, end: 7.25, text: 'Top line\nsecond line' },
      { start: 3600, end: 3602, text: 'Bye' },
    ]);
  });

  it('skips broken blocks and tolerates a BOM and dots in times', () => {
    const cues = parseSrt('\uFEFF1\n00:00:01.000 --> 00:00:02.000\nA\n\nnonsense\n\n2\n00:00:03,000 --> 00:00:04,000\nB\n');
    expect(cues.map((c) => c.text)).toEqual(['A', 'B']);
  });
});

describe('cueAt', () => {
  const cues = parseSrt(SAMPLE);
  it('shows a cue from its start up to (not including) its end', () => {
    expect(cueAt(cues, 0.5)).toBe('');
    expect(cueAt(cues, 1)).toBe('Hello there');
    expect(cueAt(cues, 3.99)).toBe('Hello there');
    expect(cueAt(cues, 4)).toBe('');
    expect(cueAt(cues, 5.5)).toBe('Top line\nsecond line');
    expect(cueAt(cues, 3601)).toBe('Bye');
    expect(cueAt(cues, 3602)).toBe('');
    expect(cueAt(cues, 99999)).toBe('');
    expect(cueAt([], 1)).toBe('');
  });
});
