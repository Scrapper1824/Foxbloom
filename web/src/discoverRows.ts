import type { MediaType, SearchResult } from './api';

/** Discover's "See all" pages: one curated row (Trending, Popular, ...) in full. */

/** Where a row's "See all" goes. */
export const discoverRowPath = (type: MediaType, rowId: string) => `/discover/${type}/${encodeURIComponent(rowId)}`;

/** The Discover tab to open from the address (?type=show), Movies by default. */
export const discoverTabOf = (search: string): MediaType => {
  const t = new URLSearchParams(search).get('type');
  return t === 'show' || t === 'anime' ? t : 'movie';
};

/** Pages of results as one list; the same title can come back on two pages when the list shifts while you scroll. */
export function mergePages(pages: { items: SearchResult[] }[]): SearchResult[] {
  const seen = new Set<string>();
  return pages
    .flatMap((p) => p.items)
    .filter((r) => {
      const k = `${r.type}-${r.tmdbId ?? r.anilistId}`;
      return !seen.has(k) && !!seen.add(k);
    });
}
