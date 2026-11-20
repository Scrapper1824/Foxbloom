import { useEffect, useRef } from 'react';

/**
 * Loads the next page as you near the bottom of a list: put the returned ref on an element after the
 * last card. Takes an infinite query (TanStack's useInfiniteQuery result).
 */
export function useLoadMoreOnScroll(list: { hasNextPage: boolean; isFetchingNextPage: boolean; fetchNextPage: () => unknown }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = end.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (e) => {
        if (e[0].isIntersecting && list.hasNextPage && !list.isFetchingNextPage) list.fetchNextPage();
      },
      { rootMargin: '600px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [list.hasNextPage, list.isFetchingNextPage, list.fetchNextPage]); // eslint-disable-line react-hooks/exhaustive-deps
  return end;
}
