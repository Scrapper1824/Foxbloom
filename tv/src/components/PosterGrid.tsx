import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { GAP, PosterTile, POSTER_W, startFor, type TileData } from './PosterRow';

const ROW_H = 404;
const RING = 12;
const VISIBLE_ROWS = 2;
const EXTRA_ROWS = 1;

/**
 * Posters in columns. Like PosterRow only the visible grid rows plus one either side exist in the page; the window follows
 * the focus ring.
 */
export function PosterGrid({ gridId, tiles, cols, height }: { gridId: string; tiles: TileData[]; cols: number; height?: number }) {
  const [start, setStart] = useState(() => Math.floor(startFor(gridId, cols * VISIBLE_ROWS) / cols));
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onFocus = (e: Event) => {
      const t = e.target as HTMLElement;
      if (t.getAttribute('data-row') !== gridId) return;
      const r = Math.floor(parseInt(t.getAttribute('data-index') || '0', 10) / cols);
      setStart((s) => (r < s ? r : r >= s + VISIBLE_ROWS ? r - VISIBLE_ROWS + 1 : s));
    };
    el.addEventListener('foxfocus', onFocus);
    return () => el.removeEventListener('foxfocus', onFocus);
  }, [gridId, cols]);

  useLayoutEffect(() => {
    if (box.current) box.current.scrollTop = start * ROW_H;
  }, [start]);

  const rows = Math.ceil(tiles.length / cols);
  const from = Math.max(0, start - EXTRA_ROWS) * cols;
  const to = Math.min(tiles.length, (start + VISIBLE_ROWS + EXTRA_ROWS) * cols);
  const out = [];
  for (let i = from; i < to; i++) {
    const r = Math.floor(i / cols);
    out.push(<PosterTile key={tiles[i].key} tile={tiles[i]} rowId={gridId} index={i} x={RING + (i % cols) * (POSTER_W + GAP)} y={RING + r * ROW_H} />);
  }
  return (
    <div class="poster-grid" ref={box} style={{ height: (height || ROW_H * VISIBLE_ROWS) + 'px' }}>
      <div class="grid-track" style={{ height: rows * ROW_H + RING * 2 + 'px', width: cols * (POSTER_W + GAP) + RING * 2 + 'px' }}>
        {out}
      </div>
    </div>
  );
}
