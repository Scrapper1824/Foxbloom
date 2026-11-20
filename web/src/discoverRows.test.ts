import { describe, expect, it } from 'vitest';
import type { SearchResult } from './api';
import { discoverRowPath, discoverTabOf, mergePages } from './discoverRows';

const r = (type: SearchResult['type'], id: number): SearchResult =>
  ({ type, ...(type === 'anime' ? { anilistId: id } : { tmdbId: id }), title: `T${id}`, year: 2026, poster: null, overview: '' }) as SearchResult;

describe('Discover See all', () => {
  it('links each row to its own page', () => {
    expect(discoverRowPath('movie', 'now-playing')).toBe('/discover/movie/now-playing');
    expect(discoverRowPath('anime', 'thisSeason')).toBe('/discover/anime/thisSeason');
  });

  it('comes back to the tab it came from', () => {
    expect(discoverTabOf('')).toBe('movie');
    expect(discoverTabOf('?type=show')).toBe('show');
    expect(discoverTabOf('?type=anime')).toBe('anime');
    expect(discoverTabOf('?type=nonsense')).toBe('movie');
  });

  it('joins the pages without showing a title twice', () => {
    const items = mergePages([{ items: [r('movie', 1), r('movie', 2)] }, { items: [r('movie', 2), r('movie', 3), r('anime', 1)] }]);
    expect(items.map((i) => `${i.type}-${i.tmdbId ?? i.anilistId}`)).toEqual(['movie-1', 'movie-2', 'movie-3', 'anime-1']);
  });
});
