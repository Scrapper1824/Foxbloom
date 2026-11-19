import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { peekPendingFocus } from '../restore';

/** One title (or episode) in a row or grid. */
export interface TileData {
  key: string;
  title: string;
  sub?: string;
  image: string | null;
  /** 0..1 watched amount, drawn as a thin bar. */
  progress?: number;
  onSelect: () => void;
  /** The remote's Play key. */
  onPlay?: () => void;
}

export const GAP = 24;
export const POSTER_W = 200;
export const WIDE_W = 360;
/** How many tiles are drawn beyond the visible ones, each side. */
export const EXTRA = 4;
const RING = 12;

export function PosterTile({ tile, rowId, index, wide, x, y }: { tile: TileData; rowId: string; index: number; wide?: boolean; x: number; y: number }) {
  return (
    <button
      data-focusable
      data-key={rowId + ':' + index}
      data-row={rowId}
      data-index={index}
      class={'tile' + (wide ? ' wide' : '')}
      style={{ left: x + 'px', top: y + 'px' }}
      onClick={tile.onSelect}
      {...({ onFoxPlay: tile.onPlay } as Record<string, unknown>)}
    >
      <span class="tile-art">
        {tile.image ? <img src={tile.image} alt="" loading="lazy" /> : <span class="tile-fallback">{tile.title.charAt(0)}</span>}
        {tile.progress !== undefined && tile.progress > 0 && (
          <span class="tile-progress">
            <span style={{ width: Math.min(100, tile.progress * 100) + '%' }} />
          </span>
        )}
      </span>
      <span class="tile-title">{tile.title}</span>
      <span class="tile-sub">{tile.sub || ' '}</span>
    </button>
  );
}

/** First visible index for a row restoring focus to `rowId:n`, otherwise 0. */
export function startFor(rowId: string, visible: number): number {
  const k = peekPendingFocus();
  const m = k && k.indexOf(rowId + ':') === 0 ? parseInt(k.slice(rowId.length + 1), 10) : NaN;
  return isNaN(m) ? 0 : Math.max(0, m - Math.floor(visible / 2));
}

/**
 * A horizontal row of tiles. Only the visible tiles plus EXTRA on either side exist in the page; the window follows the
 * focus ring (the focus code announces each move with a 'foxfocus' event).
 */
export function PosterRow({ rowId, title, tiles, wide }: { rowId: string; title: string; tiles: TileData[]; wide?: boolean }) {
  const tileW = wide ? WIDE_W : POSTER_W;
  const step = tileW + GAP;
  const visible = wide ? 4 : 7;
  const [start, setStart] = useState(() => startFor(rowId, visible));
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onFocus = (e: Event) => {
      const t = e.target as HTMLElement;
      if (t.getAttribute('data-row') !== rowId) return;
      const i = parseInt(t.getAttribute('data-index') || '0', 10);
      setStart((s) => (i < s ? i : i >= s + visible ? i - visible + 1 : s));
    };
    el.addEventListener('foxfocus', onFocus);
    return () => el.removeEventListener('foxfocus', onFocus);
  }, [rowId, visible]);

  useLayoutEffect(() => {
    if (box.current) box.current.scrollLeft = start * step;
  }, [start, step]);

  const from = Math.max(0, start - EXTRA);
  const to = Math.min(tiles.length, start + visible + EXTRA);
  const out = [];
  for (let i = from; i < to; i++) out.push(<PosterTile key={tiles[i].key} tile={tiles[i]} rowId={rowId} index={i} wide={wide} x={RING + i * step} y={0} />);
  return (
    <section class="row-section">
      <h2 class="row-title">{title}</h2>
      <div class={'poster-row' + (wide ? ' wide' : '')} ref={box}>
        <div class="row-track" style={{ width: tiles.length * step + RING * 2 + 'px' }}>
          {out}
        </div>
      </div>
    </section>
  );
}
