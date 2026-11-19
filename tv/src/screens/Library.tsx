import { useRef, useState } from 'preact/hooks';
import { useNav, type Screen } from '../app';
import { PosterGrid } from '../components/PosterGrid';
import type { TileData } from '../components/PosterRow';
import { TopBar } from '../components/TopBar';
import type { Session } from '../session';
import { sized, TYPE_LABEL, TYPES, type Media, type MediaType } from '../types';
import { titleScreen } from './Title';
import { useFocusWhenReady } from './useFocus';
import { LoadError, useLoad } from './useLoad';

const KEY = 'foxbloom.tv.libraryType';

/** The type you looked at last (Movies the first time), like the website. */
function lastType(): MediaType {
  try {
    const t = localStorage.getItem(KEY) as MediaType | null;
    if (t && TYPES.indexOf(t) >= 0) return t;
  } catch (e) {
    /* storage unavailable */
  }
  return 'movie';
}

export function libraryScreen(session: Session): Screen {
  return { name: 'library', render: () => <Library session={session} /> };
}

/** Only what the TV can play: titles with at least one downloaded file. */
export const playable = (m: Media) => (m.type === 'movie' ? m.has_file : m.episodeFileCount > 0);

export function mediaSub(m: Media): string {
  const eps = m.type !== 'movie' && m.episodeCount > 0 ? (m.episodeFileCount >= m.episodeCount ? 'All ' + m.episodeCount + ' eps' : m.episodeFileCount + ' of ' + m.episodeCount + ' eps') : '';
  return [m.year, eps].filter(Boolean).join(' · ');
}

export function mediaTile(session: Session, nav: ReturnType<typeof useNav>, m: Media): TileData {
  return { key: 'm' + m.id, title: m.title, sub: mediaSub(m), image: sized(m.poster, 'w342'), onSelect: () => nav.push(titleScreen(session, m.id)) };
}

/** Everything downloaded, one type at a time, as a grid of posters. */
export function Library({ session }: { session: Session }) {
  const nav = useNav();
  const [type, setType] = useState<MediaType>(lastType);
  const { data, error, retry } = useLoad<Media[]>(session, '/api/media?type=' + type);
  const content = useRef<HTMLDivElement>(null);
  // Focus the page once; switching type later must leave the focus on the type buttons.
  const seen = useRef(false);
  if (data || error) seen.current = true;
  useFocusWhenReady(content, seen.current);

  const pick = (t: MediaType) => {
    try {
      localStorage.setItem(KEY, t);
    } catch (e) {
      /* storage unavailable: Library just opens Movies next time */
    }
    setType(t);
  };
  const list = data ? data.filter(playable) : [];
  return (
    <div class="browse">
      <TopBar session={session} active="library" />
      <div class="browse-body" ref={content}>
        <div class="season-chips">
          {TYPES.map((t) => (
            <button key={t} data-focusable data-key={'type:' + t} class={'season-chip' + (t === type ? ' current' : '')} onClick={() => pick(t)}>
              {TYPE_LABEL[t]}
            </button>
          ))}
        </div>
        {error && <LoadError message={error} onRetry={retry} />}
        {!data && !error && <p class="loading">Loading…</p>}
        {data && !list.length && <p class="loading">{'No ' + TYPE_LABEL[type].toLowerCase() + ' downloaded yet.'}</p>}
        {data && list.length > 0 && <PosterGrid gridId={'lib-' + type} cols={7} tiles={list.map((m) => mediaTile(session, nav, m))} />}
      </div>
    </div>
  );
}
