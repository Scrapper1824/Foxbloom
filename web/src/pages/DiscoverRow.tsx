import { useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { useInfiniteQuery } from '@tanstack/react-query';
import { api, typeLabel, type MediaType, type SearchResult } from '../api';
import AddDialog from '../components/AddDialog';
import Chevron from '../components/Chevron';
import MediaDetails from '../components/MediaDetails';
import ResultCard from '../components/ResultCard';
import { useLoadMoreOnScroll } from '../components/useLoadMoreOnScroll';
import { mergePages } from '../discoverRows';

interface RowPage {
  id: string;
  title: string;
  items: SearchResult[];
  nextPage: number | null;
}

/** "See all" from a Discover row: the whole list (Trending, In theaters, Popular, ...), more as you scroll. */
export default function DiscoverRow() {
  const { type: rawType = '', row = '' } = useParams();
  const type = (['movie', 'show', 'anime'] as const).find((t) => t === rawType);
  const [adding, setAdding] = useState<SearchResult | null>(null);
  const [viewing, setViewing] = useState<SearchResult | null>(null);
  const list = useInfiniteQuery({
    queryKey: ['discover', 'row', type, row],
    queryFn: ({ pageParam }) => api.get<RowPage>(`/api/discover/row?type=${type}&row=${encodeURIComponent(row)}&page=${pageParam}`),
    initialPageParam: 1,
    getNextPageParam: (last) => last.nextPage ?? undefined,
    staleTime: 10 * 60_000,
    enabled: !!type,
  });
  const end = useLoadMoreOnScroll(list);
  if (!type) return <Navigate to="/discover" replace />;

  const items = mergePages(list.data?.pages ?? []);
  const title = list.data?.pages[0]?.title;
  const back = type === 'movie' ? '/discover' : `/discover?type=${type as MediaType}`;

  return (
    <div className="page page-wide discover-row-page">
      <header className="page-header">
        <Link className="home-see-all discover-back" to={back}>
          <Chevron dir="left" size={13} /> Discover · {typeLabel[type]}
        </Link>
        <h1>{title ?? (list.isError ? 'Discover' : ' ')}</h1>
      </header>

      {list.isLoading && <div className="loading">Loading…</div>}
      {list.error && <div className="error-box">{(list.error as Error).message}</div>}
      {list.isSuccess && !items.length && <div className="empty">Nothing here right now.</div>}
      <div className="grid">
        {items.map((r) => (
          <ResultCard key={`${r.type}-${r.tmdbId ?? r.anilistId}`} r={r} onRequest={setAdding} onOpen={setViewing} />
        ))}
      </div>
      <div ref={end} />
      {list.hasNextPage && (
        <div className="row center filtered-more">
          <button className="btn" disabled={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>
            {list.isFetchingNextPage ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}

      {viewing && (
        <MediaDetails
          item={viewing}
          onClose={() => setViewing(null)}
          onRequest={(r) => {
            setViewing(null);
            setAdding(r);
          }}
        />
      )}
      {adding && <AddDialog item={adding} onClose={() => setAdding(null)} />}
    </div>
  );
}
