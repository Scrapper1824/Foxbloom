import type { MediaType } from './api';

const KEY = 'mediarr.libraryType';
export const LIBRARY_PATHS: Record<MediaType, string> = { movie: '/movies', show: '/shows', anime: '/anime' };

/** Where the sidebar's Library goes: the type you looked at last (Movies the first time). */
export function lastLibraryPath(): string {
  try {
    const t = localStorage.getItem(KEY) as MediaType | null;
    return (t && LIBRARY_PATHS[t]) || LIBRARY_PATHS.movie;
  } catch {
    return LIBRARY_PATHS.movie;
  }
}

export function rememberLibraryType(type: MediaType) {
  try {
    localStorage.setItem(KEY, type);
  } catch {
    // private browsing: Library just opens Movies
  }
}
