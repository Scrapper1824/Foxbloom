import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initDb } from '../db.js';
import { saveSettings } from '../settings.js';
import { animeSeasonOf, browseAnime, browseAnimeRow, browseExtra } from './anilist.js';
import { browseTmdb, browseTmdbRow, theaterRegion } from './tmdb.js';

describe('browseTmdb', () => {
  const calls: string[] = [];
  beforeEach(() => {
    initDb(':memory:');
    saveSettings({ tmdbApiKey: 'a'.repeat(32) });
    calls.length = 0;
    vi.stubGlobal('fetch', async (url: string) => {
      calls.push(new URL(url).pathname);
      if (/^\/3\/tv\/\d+$/.test(new URL(url).pathname)) {
        return new Response(JSON.stringify({ id: 1, number_of_episodes: 19 }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      const results = [
        { id: 1, title: 'Dune: Part Two', name: 'Severance', release_date: '2024-03-01', first_air_date: '2022-02-18', poster_path: '/p.jpg', overview: 'x' },
        { id: 2, title: 'No Poster', name: 'No Poster', poster_path: null },
      ];
      return new Response(JSON.stringify({ results }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('builds the movie rows from trending / now playing / popular / upcoming / top rated', async () => {
    const rows = await browseTmdb('movie');
    expect(rows.map((r) => r.title)).toEqual(['Trending this week', 'In theaters now', 'Popular', 'Coming soon', 'Top rated']);
    expect([...new Set(calls)]).toEqual(['/3/trending/movie/week', '/3/discover/movie', '/3/movie/popular', '/3/movie/upcoming', '/3/movie/top_rated']);
    expect(rows[0].items).toEqual([
      { type: 'movie', tmdbId: 1, title: 'Dune: Part Two', year: 2024, poster: 'https://image.tmdb.org/t/p/w342/p.jpg', overview: 'x' },
    ]);
  });

  it('builds the show rows, with each show’s episode count', async () => {
    const rows = await browseTmdb('show');
    expect(rows.map((r) => r.title)).toEqual(['Trending this week', 'Airing today', 'On the air this week', 'Popular', 'Top rated']);
    expect(rows[1].items[0]).toMatchObject({ type: 'show', title: 'Severance', year: 2022, extra: '19 eps' });
    // Each show is looked up once, however many rows it's in.
    expect(calls.filter((c) => c === '/3/tv/1')).toHaveLength(1);
  });
});

describe('a Discover row in full (See all)', () => {
  const asked: URL[] = [];
  beforeEach(() => {
    initDb(':memory:');
    saveSettings({ tmdbApiKey: 'a'.repeat(32) });
    asked.length = 0;
    vi.stubGlobal('fetch', async (url: string) => {
      const u = new URL(url);
      asked.push(u);
      if (/^\/3\/tv\/\d+$/.test(u.pathname)) return Response.json({ number_of_episodes: 8 });
      const page = Number(u.searchParams.get('page'));
      return Response.json({
        total_pages: 3,
        results: [
          { id: page * 10, title: `Film ${page}`, name: `Show ${page}`, poster_path: '/p.jpg' },
          { id: 99, title: 'Anime film', name: 'Anime show', poster_path: '/a.jpg', original_language: 'ja', genre_ids: [16] },
          { id: page * 10 + 1, title: 'No poster', poster_path: null },
        ],
      });
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('lists only films in this country’s cinemas, opened in the last six weeks, under In theaters now', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-20T12:00:00Z'));
    try {
      await browseTmdbRow('movie', 'now-playing', 2);
    } finally {
      vi.useRealTimers();
    }
    const q = asked[0].searchParams;
    expect(asked[0].pathname).toBe('/3/discover/movie');
    // The country's own theatrical dates (TMDB applies release_date and the release type to the region).
    expect(q.get('region')).toBe('US');
    expect(q.get('release_date.gte')).toBe('2026-10-09');
    expect(q.get('release_date.lte')).toBe('2026-11-20');
    expect(q.get('primary_release_date.gte')).toBeNull();
    expect(q.get('with_release_type')).toBe('2|3');
    expect(q.get('sort_by')).toBe('popularity.desc');
    expect(q.get('page')).toBe('2');
  });

  it('pages through the row’s own TMDB list, with the row’s filters', async () => {
    const first = await browseTmdbRow('movie', 'now-playing', 1);
    expect(asked[0].pathname).toBe('/3/discover/movie');
    expect(asked[0].searchParams.get('page')).toBe('1');
    expect(first).toMatchObject({ id: 'now-playing', title: 'In theaters now', nextPage: 2 });
    expect(first!.items.map((i) => i.title)).toEqual(['Film 1']);
    // The last page says there's no more.
    expect((await browseTmdbRow('movie', 'now-playing', 3))!.nextPage).toBeNull();
  });

  it('counts episodes for shows, like the row', async () => {
    const row = await browseTmdbRow('show', 'popular', 2);
    expect(asked[0].pathname).toBe('/3/tv/popular');
    expect(row!.items).toEqual([expect.objectContaining({ title: 'Show 2', extra: '8 eps' })]);
  });

  it('knows nothing of rows that don’t exist', async () => {
    expect(await browseTmdbRow('movie', 'airing-today', 1)).toBeNull();
    expect(asked).toHaveLength(0);
  });
});

describe('a Discover anime row in full (See all)', () => {
  const bodies: { query: string; variables: Record<string, unknown> }[] = [];
  beforeEach(() => {
    bodies.length = 0;
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      bodies.push(body);
      const media = [
        { id: 1, title: { romaji: 'Frieren' }, format: 'TV', episodes: 28, coverImage: { large: 'c.jpg' } },
        { id: 2, title: { romaji: 'No cover' }, coverImage: {} },
      ];
      if (/Page\(page/.test(body.query)) return Response.json({ data: { Page: { pageInfo: { hasNextPage: (body.variables.page as number) < 2 }, media } } });
      return Response.json({ data: Object.fromEntries(['trending', 'thisSeason', 'nextSeason', 'popular', 'topRated'].map((k) => [k, { media }])) });
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('lists the same AniList selection as the row, a page at a time', async () => {
    const now = new Date('2026-11-20T12:00:00');
    const rows = await browseAnime(now);
    expect(rows.map((r) => r.title)).toEqual(['Trending now', 'This season · Fall 2026', 'Next season · Winter 2027', 'All-time popular', 'Top rated']);
    expect(bodies[0].query).toContain('thisSeason: Page(perPage: 20) { media(type: ANIME, isAdult: false, season: FALL, seasonYear: 2026, sort: POPULARITY_DESC)');

    const page1 = await browseAnimeRow('nextSeason', 1, now);
    expect(bodies[1].query).toContain('media(type: ANIME, isAdult: false, season: WINTER, seasonYear: 2027, sort: POPULARITY_DESC)');
    expect(bodies[1].variables).toEqual({ page: 1 });
    expect(page1).toMatchObject({ id: 'nextSeason', title: 'Next season · Winter 2027', nextPage: 2 });
    expect(page1!.items).toEqual([expect.objectContaining({ anilistId: 1, title: 'Frieren', extra: '28 eps' })]);
    expect((await browseAnimeRow('nextSeason', 2, now))!.nextPage).toBeNull();
    expect(await browseAnimeRow('nope', 1, now)).toBeNull();
  });
});

describe('anime card captions', () => {
  it('shows the format and how many episodes, counting what has aired for a show still running', () => {
    expect(browseExtra({ format: 'TV', episodes: 24 })).toBe('24 eps');
    expect(browseExtra({ format: 'ONA', episodes: 12 })).toBe('ONA · 12 eps');
    expect(browseExtra({ format: 'TV', episodes: null, nextAiringEpisode: { episode: 1181 } })).toBe('1,180 eps');
    expect(browseExtra({ format: 'MOVIE', episodes: 1 })).toBe('Movie');
    // A show that hasn't aired yet has no count.
    expect(browseExtra({ format: 'TV', episodes: null, nextAiringEpisode: { episode: 1 } })).toBeUndefined();
  });
});

describe('animeSeasonOf', () => {
  it.each([
    ['2026-01-15', 'WINTER'],
    ['2026-04-01', 'SPRING'],
    ['2026-08-30', 'SUMMER'],
    ['2026-11-02', 'FALL'],
  ])('%s is %s', (date, season) => {
    expect(animeSeasonOf(new Date(`${date}T12:00:00`)).season).toBe(season);
  });
});

describe('featuredTmdb', () => {
  beforeEach(() => {
    initDb(':memory:');
    saveSettings({ tmdbApiKey: 'a'.repeat(32) });
    vi.stubGlobal('fetch', async (url: string) => {
      const u = new URL(url);
      let body: unknown;
      if (u.pathname.startsWith('/3/trending/')) {
        body = { results: [{ id: 84958, name: 'Loki', backdrop_path: '/b.jpg', poster_path: '/p.jpg' }, { id: 2, name: 'No art' }] };
      } else if (u.pathname === '/3/tv/84958') {
        expect(u.searchParams.get('append_to_response')).toBe('images,content_ratings');
        body = {
          id: 84958, name: 'Loki', first_air_date: '2021-06-09', poster_path: '/p.jpg', backdrop_path: '/b2.jpg', overview: 'God of Mischief',
          vote_average: 8.234, number_of_seasons: 2, genres: [{ name: 'Sci-Fi & Fantasy' }, { name: 'Drama' }],
          images: { logos: [{ file_path: '/fr.png', iso_639_1: 'fr' }, { file_path: '/en.png', iso_639_1: 'en' }] },
          content_ratings: { results: [{ iso_3166_1: 'DE', rating: '12' }, { iso_3166_1: 'US', rating: 'TV-14' }] },
        };
      } else throw new Error('unexpected ' + u.pathname);
      return new Response(JSON.stringify(body), { status: 200 });
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('builds a Jellyfin-style banner item', async () => {
    const { featuredTmdb } = await import('./tmdb.js');
    const [loki, ...rest] = await featuredTmdb('show');
    expect(rest).toHaveLength(0); // titles without artwork are skipped
    expect(loki).toMatchObject({
      title: 'Loki',
      year: 2021,
      backdrop: 'https://image.tmdb.org/t/p/original/b2.jpg',
      logo: 'https://image.tmdb.org/t/p/w500/en.png', // English logo preferred
      rating: 8.2,
      genres: ['Sci-Fi & Fantasy', 'Drama'],
      facts: ['2 seasons'],
      certification: 'TV-14',
    });
  });
});

describe('keeping anime out of Shows', () => {
  it.each([
    [{ genre_ids: [16, 10759], origin_country: ['JP'], original_language: 'ja' }, true], // e.g. Frieren
    [{ genre_ids: [16], origin_country: ['US'], original_language: 'ja' }, true], // Japanese-language co-production
    [{ genre_ids: [16, 18], origin_country: ['US'], original_language: 'en' }, false], // Arcane
    [{ genre_ids: [16, 35], origin_country: ['US'], original_language: 'en' }, false], // The Simpsons
    [{ genre_ids: [18], origin_country: ['JP'], original_language: 'ja' }, false], // Japanese live-action drama
    [{ genres: [{ id: 16 }], origin_country: ['JP'] }, true], // details shape
  ])('%j -> %s', async (show, expected) => {
    const { isAnimeTitle } = await import('./tmdb.js');
    expect(isAnimeTitle(show)).toBe(expected);
  });

  it('drops anime from the Shows rows and banner, but not western animation', async () => {
    initDb(':memory:');
    saveSettings({ tmdbApiKey: 'a'.repeat(32) });
    const shows = [
      { id: 1, name: 'Frieren', genre_ids: [16], origin_country: ['JP'], original_language: 'ja', poster_path: '/a.jpg', backdrop_path: '/b.jpg' },
      { id: 2, name: 'Arcane', genre_ids: [16], origin_country: ['US'], original_language: 'en', poster_path: '/a.jpg', backdrop_path: '/b.jpg' },
      { id: 3, name: 'Severance', genre_ids: [18], origin_country: ['US'], original_language: 'en', poster_path: '/a.jpg', backdrop_path: '/b.jpg' },
    ];
    vi.stubGlobal('fetch', async (url: string) => {
      const u = new URL(url);
      const body = /^\/3\/tv\/\d+$/.test(u.pathname)
        ? { ...shows.find((s) => `/3/tv/${s.id}` === u.pathname), genres: [] }
        : { results: u.searchParams.get('page') === '2' ? [] : shows };
      return new Response(JSON.stringify(body), { status: 200 });
    });
    const { browseTmdb, featuredTmdb } = await import('./tmdb.js');
    const rows = await browseTmdb('show');
    expect(rows[0].items.map((i) => i.title)).toEqual(['Arcane', 'Severance']);
    expect((await featuredTmdb('show')).map((i) => i.title)).toEqual(['Arcane', 'Severance']);
    vi.unstubAllGlobals();
  });
});

describe('keeping anime out of Movies', () => {
  it('drops Japanese anime films from the Movies rows and banner, keeps western animation', async () => {
    initDb(':memory:');
    saveSettings({ tmdbApiKey: 'a'.repeat(32) });
    const movies = [
      { id: 1, title: 'Demon Slayer: Infinity Castle', genre_ids: [16, 28], original_language: 'ja', poster_path: '/a.jpg', backdrop_path: '/b.jpg' },
      { id: 2, title: 'Inside Out 2', genre_ids: [16, 10751], original_language: 'en', poster_path: '/a.jpg', backdrop_path: '/b.jpg' },
      { id: 3, title: 'Dune: Part Two', genre_ids: [878], original_language: 'en', poster_path: '/a.jpg', backdrop_path: '/b.jpg' },
    ];
    vi.stubGlobal('fetch', async (url: string) => {
      const u = new URL(url);
      const body = /^\/3\/movie\/\d+$/.test(u.pathname)
        ? { ...movies.find((m) => `/3/movie/${m.id}` === u.pathname), genres: [] }
        : { results: u.searchParams.get('page') === '2' ? [] : movies };
      return new Response(JSON.stringify(body), { status: 200 });
    });
    const { browseTmdb, featuredTmdb, searchMovies } = await import('./tmdb.js');
    expect((await browseTmdb('movie'))[0].items.map((i) => i.title)).toEqual(['Inside Out 2', 'Dune: Part Two']);
    expect((await featuredTmdb('movie')).map((i) => i.title)).toEqual(['Inside Out 2', 'Dune: Part Two']);
    // Search keeps them but flags them, so the page can hide them and point to the Anime tab.
    expect((await searchMovies('x')).filter((m) => m.isAnime).map((m) => m.title)).toEqual(['Demon Slayer: Infinity Castle']);
    vi.unstubAllGlobals();
  });
});

describe('theaterRegion', () => {
  it('takes the country from the server’s locale, and falls back to US', () => {
    expect(theaterRegion('en-US')).toBe('US');
    expect(theaterRegion('en-GB')).toBe('GB');
    expect(theaterRegion('fr')).toBe('FR');
    expect(theaterRegion('not a locale!')).toBe('US');
  });
});
