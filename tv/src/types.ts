// Response shapes of the Foxbloom server, copied from web/src (api.ts, home.ts, libraryType.ts): only the fields the TV uses.

export type MediaType = 'movie' | 'show' | 'anime';
export const TYPE_LABEL: Record<MediaType, string> = { movie: 'Movies', show: 'Shows', anime: 'Anime' };
export const TYPES: MediaType[] = ['movie', 'show', 'anime'];

/** A downloaded title, as /api/home sends it. */
export interface HomeTitle {
  mediaId: number;
  type: MediaType;
  title: string;
  year: number | null;
  poster: string | null;
  backdrop: string | null;
  overview: string;
  episodeFiles: number;
}
export interface PlayTarget {
  kind: 'movie' | 'episode';
  id: number;
  label: string | null;
  episodeTitle: string | null;
  resume: boolean;
  position: number;
  duration: number;
  minutesLeft: number | null;
}
export interface HomeFeatured extends HomeTitle {
  play: PlayTarget;
  reason: 'continue' | 'upnext' | 'new';
}
export interface PlayableTitle extends HomeTitle {
  play: PlayTarget | null;
}
export interface ContinueItem extends HomeTitle, PlayTarget {
  upNext: boolean;
  /** This episode's still, when known. */
  still: string | null;
}
export interface HomeData {
  featured: HomeFeatured[];
  continue: ContinueItem[];
  recent: PlayableTitle[];
  libraries: Record<MediaType, PlayableTitle[]>;
}

/** One title in /api/media (the library list). */
export interface Media {
  id: number;
  type: MediaType;
  title: string;
  year: number | null;
  poster: string | null;
  backdrop: string | null;
  overview: string | null;
  status: string | null;
  has_file: boolean;
  episodeCount: number;
  episodeFileCount: number;
  season_names: Record<string, string>;
}

export interface Episode {
  id: number;
  season: number;
  episode: number;
  title: string | null;
  air_date: string | null;
  overview: string | null;
  has_file: boolean;
  aired: boolean;
}

/** /api/media/:id */
export interface MediaDetail extends Media {
  episodes: Episode[];
  /** What the Play button starts; null when nothing is downloaded. */
  play: { kind: 'movie' | 'episode'; id: number; label: string | null; episodeTitle: string | null; resume: boolean; minutesLeft: number | null } | null;
}

/** /api/play/progress/:mediaId, keyed by episode id (0 = the movie). */
export type Progress = Record<string, { position: number; duration: number; watched: boolean }>;

/** /api/auth/status: `version` is only there when signed in. */
export interface AuthStatus {
  version?: string;
}

/** What the player screen is asked to play. */
export interface PlayItem {
  kind: 'movie' | 'episode';
  id: number;
  title: string;
  label?: string | null;
}

/** "S01E05" -> "S1 E5". */
export const shortEp = (label: string) => label.replace(/^S0?(\d+)E0?(\d+)$/, 'S$1 E$2');

/** TMDB images come at a fixed size in the URL; ask for the one that fills the tile (w342 for posters). */
export function sized(url: string | null, size: string): string | null {
  return url ? url.replace(/image\.tmdb\.org\/t\/p\/(?:w\d+|original)\//, 'image.tmdb.org/t/p/' + size + '/') : null;
}
