import { useRef, useState } from 'preact/hooks';
import { useNav, type Screen } from '../app';
import { PosterGrid } from '../components/PosterGrid';
import { TopBar } from '../components/TopBar';
import { Field, Keyboard } from '../keyboard';
import type { Session } from '../session';
import type { Media } from '../types';
import { mediaTile, playable } from './Library';
import { useFocusWhenReady } from './useFocus';
import { LoadError, useLoad } from './useLoad';

export function searchScreen(session: Session): Screen {
  return { name: 'search', render: () => <Search session={session} /> };
}

/** Finds downloaded titles by name: type on the on-screen keyboard, results update as you go. */
export function Search({ session }: { session: Session }) {
  const nav = useNav();
  const [query, setQueryState] = useState(session.searchQuery);
  const setQuery = (f: (v: string) => string) => {
    session.searchQuery = f(session.searchQuery);
    setQueryState(session.searchQuery);
  };
  const { data, error, retry } = useLoad<Media[]>(session, '/api/media');
  const content = useRef<HTMLDivElement>(null);
  // Take the saved focus only once the results exist, so Back finds the result that was focused.
  useFocusWhenReady(content, !!data || !!error);

  const q = query.trim().toLowerCase();
  const found = data && q ? data.filter((m) => playable(m) && m.title.toLowerCase().indexOf(q) >= 0) : [];
  return (
    <div class="browse">
      <TopBar session={session} active="search" />
      <div class="browse-body search-body" data-scroll-area ref={content}>
        <div class="search-left">
          <Field label="Search" value={query} onValue={(v) => setQuery(() => v)} active onActivate={() => {}} placeholder="Type a title" />
          <Keyboard onType={(c) => setQuery((v) => (v + c).slice(0, 60))} onBackspace={() => setQuery((v) => v.slice(0, -1))} onDone={() => setQuery(() => '')} doneLabel="Clear" />
        </div>
        <div class="search-results">
          {error && <LoadError message={error} onRetry={retry} />}
          {!error && !q && <p class="loading">Type to find something to watch.</p>}
          {!error && q && !data && <p class="loading">Searching…</p>}
          {data && q && !found.length && <p class="loading">{'Nothing matches "' + query.trim() + '".'}</p>}
          {found.length > 0 && <PosterGrid gridId="search" cols={3} height={760} tiles={found.map((m) => mediaTile(session, nav, m))} />}
        </div>
      </div>
    </div>
  );
}
