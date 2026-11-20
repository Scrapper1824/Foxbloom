import { watchId, type SearchResult } from '../api';
import { useWatchTags } from '../watchTags';
import WatchlistMenu from './WatchlistMenu';

/** A Discover card, like Home's: the art (and the name) opens the details; + requests it straight away. */
export default function ResultCard({
  r,
  onRequest,
  onOpen,
}: {
  r: SearchResult;
  onRequest: (r: SearchResult) => void;
  onOpen: (r: SearchResult) => void;
}) {
  const sub = [r.year, r.extra, r.dubbed ? 'Dub' : null].filter(Boolean).join(' · ');
  // Your watchlist status (every card shares one fetch of your lists).
  const watch = useWatchTags()(r);
  const wid = watchId(r);
  return (
    <div className="home-poster-card discover-card">
      <div className="discover-art">
        <button type="button" className="home-poster-link" onClick={() => onOpen(r)} aria-label={`${r.title} details`}>
          <div className="home-poster">
            {r.poster ? <img src={r.poster} alt="" loading="lazy" decoding="async" /> : <div className="home-thumb-fallback">{r.title.slice(0, 1)}</div>}
            {r.libraryId ? <span className="discover-owned">In library</span> : r.requested ? <span className="discover-owned discover-requested">Requested</span> : null}
          </div>
        </button>
        {watch && wid && (
          <WatchlistMenu
            variant="tag"
            className={`discover-tag ${watch.status ? 'on' : 'off'}`}
            type={r.type}
            id={wid}
            status={watch.status}
            info={{ title: r.title, year: r.year, poster: r.poster }}
          />
        )}
        {!r.libraryId && !r.requested && (
          <button type="button" className="discover-add" onClick={() => onRequest(r)} aria-label={`Request ${r.title}`} title="Request">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        )}
      </div>
      <button type="button" className="home-card-title discover-name" onClick={() => onOpen(r)} title={r.title}>
        {r.title}
      </button>
      {sub && <span className="home-card-sub">{sub}</span>}
    </div>
  );
}
