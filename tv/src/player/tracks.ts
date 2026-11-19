import type { PlayInfo, PlayTrack, SubtitleTrack } from '../types';

// The TV's Chromium 47 has no Intl.DisplayNames: the languages Foxbloom files usually carry, by ISO 639-2 (/B and /T) and 639-1 code.
const NAMES: Record<string, string> = {
  eng: 'English', en: 'English', jpn: 'Japanese', ja: 'Japanese', spa: 'Spanish', es: 'Spanish', fre: 'French', fra: 'French', fr: 'French',
  ger: 'German', deu: 'German', de: 'German', ita: 'Italian', it: 'Italian', por: 'Portuguese', pt: 'Portuguese', rus: 'Russian', ru: 'Russian',
  chi: 'Chinese', zho: 'Chinese', zh: 'Chinese', kor: 'Korean', ko: 'Korean', ara: 'Arabic', ar: 'Arabic', hin: 'Hindi', hi: 'Hindi',
  dut: 'Dutch', nld: 'Dutch', nl: 'Dutch', swe: 'Swedish', sv: 'Swedish', nor: 'Norwegian', nob: 'Norwegian', no: 'Norwegian', dan: 'Danish', da: 'Danish',
  fin: 'Finnish', fi: 'Finnish', pol: 'Polish', pl: 'Polish', tur: 'Turkish', tr: 'Turkish', gre: 'Greek', ell: 'Greek', el: 'Greek',
  heb: 'Hebrew', he: 'Hebrew', tha: 'Thai', th: 'Thai', vie: 'Vietnamese', vi: 'Vietnamese', ind: 'Indonesian', id: 'Indonesian',
  cze: 'Czech', ces: 'Czech', cs: 'Czech', hun: 'Hungarian', hu: 'Hungarian', rum: 'Romanian', ron: 'Romanian', ro: 'Romanian', ukr: 'Ukrainian', uk: 'Ukrainian',
  und: 'Unknown language', zxx: 'No language', mul: 'Multiple languages',
};

export function languageName(code: string): string {
  return NAMES[code.trim().toLowerCase()] || code.toUpperCase();
}

const isEnglish = (l: string | null) => l === 'eng' || l === 'en';
const isSigns = (s: SubtitleTrack) => s.forced || /sign|song/i.test(s.title || '');

/** "English · Commentary", or "Track 2" when the file says nothing. */
export function trackName(t: PlayTrack, i: number): string {
  const lang = t.language ? languageName(t.language) : null;
  return [lang, t.title && t.title !== lang ? t.title : null].filter(Boolean).join(' · ') || 'Track ' + (i + 1);
}

/** Audio, as the web player picks it: the dub when the title was requested as Dub, Japanese for Sub, else the file's default. */
export function pickAudio(info: PlayInfo): number | null {
  if (!info.audio.length) return null;
  if (info.audioPreference === 'dub') {
    const eng = info.audio.filter((a) => isEnglish(a.language))[0];
    if (eng) return eng.order;
  }
  if (info.audioPreference === 'sub') {
    const jpn = info.audio.filter((a) => a.language === 'jpn' || a.language === 'ja')[0];
    if (jpn) return jpn.order;
  }
  return (info.audio.filter((a) => a.isDefault)[0] || info.audio[0]).order;
}

/** The subtitle tracks the TV can show: text ones (fetched as SRT and drawn as plain text). */
export const textSubtitles = (info: PlayInfo) => info.subtitles.filter((s) => s.text);

/** Subtitles, as the web player picks them (among text tracks): full English subs for foreign audio, only signs/forced ones for English audio. */
export function pickSubtitle(info: PlayInfo, audio: number | null): number | null {
  const subs = textSubtitles(info);
  const a = info.audio.filter((x) => x.order === audio)[0];
  const lang = a ? a.language : null;
  if (isEnglish(lang)) {
    const s = subs.filter(isSigns)[0];
    return s ? s.order : null;
  }
  const eng = subs.filter((s) => isEnglish(s.language) || !s.language);
  const pick = eng.filter((s) => !isSigns(s) && s.isDefault)[0] || eng.filter((s) => !isSigns(s))[0] || subs.filter((s) => s.isDefault)[0] || subs[0];
  return pick ? pick.order : null;
}
