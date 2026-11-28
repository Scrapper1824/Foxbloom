import type { ProwlarrRelease } from '../clients/prowlarr.js';
import type { AnimeAudio, MediaType } from '../db.js';
import type { Settings } from '../settings.js';
import { asStandaloneSequel, matchAnime, type AnimeSeason } from './animeMatch.js';
import { normalizeTitle, parseRelease, titleMatches, type ParsedRelease } from './releaseParser.js';

export type SearchScope =
  | { kind: 'movie' }
  | { kind: 'episode'; season: number; episode: number }
  | { kind: 'season'; season: number; episodes: number[] };

export interface ScoreContext {
  type: MediaType;
  titles: string[];
  year: number | null;
  animeAudio: AnimeAudio | null;
  scope: SearchScope;
  settings: Settings;
  /** Anime only: the series' seasons, for season-aware matching. */
  animeSeasons?: AnimeSeason[];
  /** Shows: episodes per season (season 0 excluded), to size and label multi-season bundles. */
  seasonEpisodeCounts?: Record<number, number>;
  /** Releases that were grabbed before and stopped downloading (by info hash and lower-case title): never again. */
  blocked?: { hashes: Set<string>; titles: Set<string> };
}

/** exact = just what was asked for; bundle = that plus other seasons (only grabbed after the user agrees). */
export type Coverage = 'exact' | 'bundle';

export interface ScoredRelease extends ProwlarrRelease {
  parsed: ParsedRelease;
  score: number;
  rejections: string[];
  coverage: Coverage | null;
  /** Seasons a pack/bundle contains. */
  covers: number[];
  /**
   * Only used when nothing else acceptable and well seeded was found: 4K while 4K is turned off, or audio in another
   * language with no English named (which may just be the original language of a foreign film).
   */
  lastResort: boolean;
}

const LADDER = ['480p', '720p', '1080p', '2160p'];
const GB = 1024 ** 3;
/** Fewer seeders than this and a torrent often never finishes: such a release only wins when nothing healthier is found. */
export const HEALTHY_SEEDERS = 5;

/**
 * The order resolutions are tried in: the preferred one, then lower ones down to 720p, then higher ones, then
 * anything below 720p. Preferring 1080p: 1080p, 720p, 2160p, 480p.
 */
export function resolutionOrder(preferred: string): string[] {
  const i = Math.max(0, LADDER.indexOf(preferred));
  const floor = LADDER.indexOf('720p');
  const lowerOk = LADDER.slice(Math.min(i, floor), i).reverse();
  const higher = LADDER.slice(i + 1);
  const lowest = LADDER.slice(0, Math.min(i, floor)).reverse();
  return [LADDER[i], ...lowerOk, ...higher, ...lowest];
}

const isHealthy = (r: Pick<ProwlarrRelease, 'seeders'>) => (r.seeders ?? 0) >= HEALTHY_SEEDERS;

interface ScopeResult {
  error: string | null;
  coverage: Coverage | null;
  covers: number[];
}

function seasonCounts(ctx: ScoreContext): Record<number, number> {
  if (ctx.animeSeasons) return Object.fromEntries(ctx.animeSeasons.map((s) => [s.season, s.episodes]));
  return ctx.seasonEpisodeCounts ?? {};
}

export function coverageLabel(covers: number[], known: number[]): string {
  const real = covers.filter((s) => s > 0);
  if (known.length > 1 && known.filter((s) => s > 0).every((s) => real.includes(s))) return 'Complete series';
  if (!real.length) return 'Bundle';
  const contiguous = real.every((s, i) => i === 0 || s === real[i - 1] + 1);
  return contiguous && real.length > 1 ? `S${real[0]}–S${real[real.length - 1]}` : real.map((s) => `S${s}`).join(' + ');
}

function checkScope(p: ParsedRelease, ctx: ScoreContext): ScopeResult {
  const { scope, type } = ctx;
  const ok = (coverage: Coverage, covers: number[] = []): ScopeResult => ({ error: null, coverage, covers });
  const fail = (error: string, covers: number[] = []): ScopeResult => ({ error, coverage: null, covers });

  if (scope.kind === 'movie') {
    if (p.episodes.length || p.isSeasonPack) return fail('Looks like a TV release');
    if (ctx.year && p.year && Math.abs(p.year - ctx.year) > 1) return fail(`Wrong year (${p.year})`);
    return ok('exact');
  }

  if (scope.kind === 'episode') {
    if (type === 'anime') {
      const m = ctx.animeSeasons && matchAnime(p, ctx.animeSeasons);
      const hit = m?.episodes?.length === 1 && m.episodes[0].season === scope.season && m.episodes[0].episode === scope.episode;
      return hit ? ok('exact', [scope.season]) : fail(m && !m.episodes?.length ? 'Batch, not a single episode' : 'Wrong episode');
    }
    if (p.season === scope.season && p.episodes.includes(scope.episode)) return ok('exact', [scope.season]);
    return fail('Wrong episode');
  }

  // Season search: packs for just this season are exact; packs that also hold other seasons are bundles.
  const known = Object.keys(seasonCounts(ctx)).map(Number).filter((s) => s > 0);
  let covers: number[];
  if (type === 'anime') {
    const m = ctx.animeSeasons && matchAnime(p, ctx.animeSeasons);
    if (!m) return fail('Wrong season');
    if (m.episodes !== null) {
      // Episode ranges ("01-48") must hold every wanted episode of this season.
      const got = new Set(m.episodes.filter((e) => e.season === scope.season).map((e) => e.episode));
      if (!m.seasons.includes(scope.season)) return fail(`Wrong season (S${m.seasons.join(', S')})`, m.seasons);
      if (!scope.episodes.every((e) => got.has(e))) return fail('Not a full batch', m.seasons);
    }
    covers = m.seasons;
  } else {
    if (!p.isSeasonPack) return fail('Not a season pack');
    covers = p.isComplete ? known : p.seasons;
  }
  if (!covers.includes(scope.season)) return fail(covers.length ? `Wrong season (S${covers.join(', S')})` : 'Wrong season', covers);
  const others = covers.filter((s) => s !== scope.season && (known.length === 0 || known.includes(s)));
  return ok(others.length ? 'bundle' : 'exact', covers);
}

const MOVIE_WORDS = /\b(movie|film|gekijouban|gekijoban)\b/i;
const EXTRA_WORDS = /\b(ova|oad|ovas|recap|compilation)\b/i;

/**
 * Series searches must not pick up a franchise's movies or OVAs, which share the series name
 * but have no season/episode numbers ("Slime the Movie - Tears of the Azure Sea").
 */
function notSeriesRejection(title: string, p: ParsedRelease, ctx: ScoreContext): string | null {
  if (ctx.scope.kind === 'movie') return null;
  const ownTitles = ctx.titles.join(' ');
  const movie = title.match(MOVIE_WORDS);
  if (movie && !MOVIE_WORDS.test(ownTitles)) return 'Movie, not a series release';
  const hasNumbers = p.season !== null || p.seasons.length > 0 || p.episodes.length > 0 || p.absoluteEpisodes.length > 0;
  // "Season 1 + OVA" packs are fine; a bare OVA release is not.
  if (!hasNumbers && EXTRA_WORDS.test(title) && !EXTRA_WORDS.test(ownTitles)) return 'OVA/special, not a series release';
  return null;
}

/** Highest season the media has (a movie counts as one), so a "Title 2" release can be told apart from the media. */
function maxSeason(ctx: ScoreContext): number | undefined {
  if (ctx.type === 'movie') return 1;
  if (ctx.animeSeasons?.length) return Math.max(...ctx.animeSeasons.map((s) => s.season));
  const counts = Object.keys(ctx.seasonEpisodeCounts ?? {}).map(Number);
  return counts.length ? Math.max(...counts) : undefined;
}

/**
 * "[VAMA] Aika Sano (Ane wa Yanmama Junyuu-chuu)": something else (here a live-action video) that only
 * names the title in brackets after its own name. "Shingeki no Kyojin (Attack on Titan)" still counts,
 * since both names are the title's.
 */
export function namedAfterOnly(raw: string, titles: string[]): string | null {
  const s = raw.replace(/^(\s*[[(][^\])]*[\])])+/, '').trim();
  const m = /^(.+?)\s*\(([^()]+)\)/.exec(s);
  if (!m) return null;
  const known = titles.map(normalizeTitle).filter((t) => t.length >= 3);
  const inside = normalizeTitle(m[2]);
  const outside = normalizeTitle(m[1]);
  if (!inside || !known.includes(inside)) return null;
  if (!outside || known.some((t) => outside.includes(t) || t.includes(outside))) return null;
  return m[1].trim();
}

export function scoreRelease(r: ProwlarrRelease, ctx: ScoreContext): ScoredRelease {
  const p = parseRelease(r.title);
  const s = ctx.settings;
  const rejections: string[] = [];

  const titleOk =
    titleMatches(p.title, ctx.titles, maxSeason(ctx)) || (!!ctx.animeSeasons && asStandaloneSequel(p, ctx.animeSeasons) !== null);
  if (!titleOk) rejections.push(`Title mismatch ("${p.title}")`);
  const other = titleOk ? namedAfterOnly(r.title, ctx.titles) : null;
  if (other) rejections.push(`A different release ("${other}") that only names the title in brackets`);
  const scope = checkScope(p, ctx);
  if (scope.error) rejections.push(scope.error);
  const notSeries = notSeriesRejection(r.title, p, ctx);
  if (notSeries) rejections.push(notSeries);
  if ((r.seeders ?? 0) < s.minSeeders) rejections.push(`Only ${r.seeders ?? 0} seeders`);
  if (ctx.blocked && ((r.infoHash && ctx.blocked.hashes.has(r.infoHash.toLowerCase())) || ctx.blocked.titles.has(r.title.trim().toLowerCase()))) {
    rejections.push('Failed before (stopped downloading)');
  }
  if (p.isCam) rejections.push('CAM/TS quality');
  if (p.foreignAudio && p.foreignDub) rejections.push(`Foreign dub (${p.foreignAudio})`);

  // Size limit scales with how many episodes the release holds (whole bundles included).
  const counts = seasonCounts(ctx);
  const bundleEps = scope.coverage === 'bundle' ? scope.covers.reduce((n, x) => n + (counts[x] ?? 0), 0) : 0;
  const epCount = ctx.scope.kind === 'season' ? Math.max(1, ctx.scope.episodes.length, bundleEps) : 1;
  const maxBytes = (ctx.scope.kind === 'movie' ? s.maxMovieSizeGb : s.maxEpisodeSizeGb * epCount) * GB;
  if (r.size && maxBytes > 0 && r.size > maxBytes) rejections.push(`Too big (${(r.size / GB).toFixed(1)} GB)`);

  if (ctx.type === 'anime' && ctx.animeAudio) {
    if (ctx.animeAudio === 'dub' && p.audio === 'sub') rejections.push('Not dubbed');
    if (ctx.animeAudio === 'sub' && p.audio === 'dub') rejections.push('Dub only');
  }

  let score = 0;
  if (p.resolution) {
    const rank = resolutionOrder(s.preferredResolution).indexOf(p.resolution);
    score += 100 - Math.max(0, rank) * 25;
  } else score += 20;
  score += Math.min(40, Math.round(Math.log2((r.seeders ?? 0) + 1) * 4));
  if (p.source === 'bluray' || p.source === 'webdl') score += 15;
  else if (p.source === 'webrip') score += 10;
  else if (p.source === 'hdtv') score += 5;
  else if (p.source === 'remux') score -= 10;
  if (ctx.type === 'anime' && ctx.animeAudio === 'dub') score += p.audio === 'dub' ? 15 : p.audio === 'dual' ? 10 : 0;
  if (ctx.type === 'anime' && ctx.animeAudio === 'sub') score += p.audio === 'sub' ? 15 : 5;

  return { ...r, parsed: p, score, rejections, coverage: scope.coverage, covers: scope.covers, lastResort: (p.resolution === '2160p' && !s.allow4k) || !!p.foreignAudio };
}

export function rankReleases(releases: ProwlarrRelease[], ctx: ScoreContext): ScoredRelease[] {
  const seen = new Set<string>();
  const scored: ScoredRelease[] = [];
  for (const r of releases) {
    const key = r.infoHash?.toLowerCase() || `${r.title}|${r.size}`;
    if (seen.has(key)) continue;
    seen.add(key);
    scored.push(scoreRelease(r, ctx));
  }
  // Acceptable first; among those, well-seeded ones first (a dead torrent never finishes, however good it looks),
  // and 4K, while it's turned off, only after everything else.
  return scored.sort(
    (a, b) =>
      Number(a.rejections.length > 0) - Number(b.rejections.length > 0) ||
      Number(isHealthy(b)) - Number(isHealthy(a)) ||
      Number(a.lastResort) - Number(b.lastResort) ||
      b.score - a.score ||
      (b.seeders ?? 0) - (a.seeders ?? 0),
  );
}
