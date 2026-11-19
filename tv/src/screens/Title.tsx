import { useRef, useState } from 'preact/hooks';
import { useNav, type Nav, type Screen } from '../app';
import type { Session } from '../session';
import { sized, shortEp, type Episode, type MediaDetail, type PlayItem, type Progress } from '../types';
import { LoadError, useLoad } from './useLoad';
import { useFocusWhenReady } from './useFocus';

/** The one place that starts playback. The player screen (Task 10) replaces the body of this function. */
export function openPlayer(nav: Nav, item: PlayItem): void {
  nav.push({
    name: 'player',
    render: () => (
      <div class="home">
        <h2>Player coming</h2>
        <p>{item.title + (item.label ? ' · ' + shortEp(item.label) : '')}</p>
        <button data-focusable class="btn" onClick={() => nav.pop()}>
          Back
        </button>
      </div>
    ),
  });
}

export function titleScreen(session: Session, mediaId: number): Screen {
  return { name: 'title', render: () => <Title session={session} mediaId={mediaId} /> };
}

const SPECIALS = 0;
const seasonName = (n: number) => (n === SPECIALS ? 'Specials' : 'Season ' + n);

/** "S01E05" -> "E5", or "S2 E5" when the show has more than one season. */
const playLabel = (label: string, manySeasons: boolean) => {
  const m = /^S0?(\d+)E0?(\d+)$/.exec(label);
  if (!m) return label;
  return manySeasons || m[1] !== '1' ? 'S' + m[1] + ' E' + m[2] : 'E' + m[2];
};

function EpisodeRow({ e, progress, onPlay }: { e: Episode; progress: Progress[string] | undefined; onPlay: () => void }) {
  const watched = !!(progress && progress.watched);
  const partway = !watched && progress && progress.duration > 0 && progress.position > 30 ? progress.position / progress.duration : 0;
  const cls = 'episode' + (watched ? ' watched' : '') + (e.has_file ? '' : ' missing');
  const body = (
    <>
      <span class="ep-num">{e.episode}</span>
      <span class="ep-title">{e.title || 'Episode ' + e.episode}</span>
      <span class="ep-status">{watched ? '✓ Watched' : partway ? Math.round(partway * 100) + '%' : e.has_file ? '' : e.aired ? 'Not downloaded' : 'Not aired yet'}</span>
    </>
  );
  // Episodes that are not downloaded cannot be played, so the remote skips them.
  return e.has_file ? (
    <button data-focusable data-key={'ep:' + e.id} class={cls} onClick={onPlay}>
      {body}
    </button>
  ) : (
    <div class={cls}>{body}</div>
  );
}

/** A movie or show: art, the Play/Resume button, and for shows the seasons with watched episodes ticked. */
export function Title({ session, mediaId }: { session: Session; mediaId: number }) {
  const nav = useNav();
  const media = useLoad<MediaDetail>(session, '/api/media/' + mediaId);
  const prog = useLoad<Progress>(session, '/api/play/progress/' + mediaId);
  const [picked, setPicked] = useState<number | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const m = media.data;
  // Watched marks are a nicety: wait for them, but never block the page on them.
  useFocusWhenReady(root, !!m && (!!prog.data || !!prog.error));

  if (media.error) return <div class="title-page" ref={root}><LoadError message={media.error} onRetry={media.retry} /></div>;
  if (!m) return <div class="title-page" ref={root}><p class="loading">Loading…</p></div>;

  const progress = prog.data || {};
  const seasons = Array.from(new Set(m.episodes.map((e) => e.season))).sort((a, b) => (a === SPECIALS ? 1 : b === SPECIALS ? -1 : a - b));
  const playing = m.play && m.play.kind === 'episode' ? m.episodes.filter((e) => e.id === m.play!.id)[0] : null;
  const open = picked !== null ? picked : playing ? playing.season : seasons[0];
  const episodes = m.episodes.filter((e) => e.season === open).sort((a, b) => a.episode - b.episode);
  const many = seasons.filter((s) => s > 1).length > 0;
  const play = (kind: 'movie' | 'episode', id: number, label: string | null) => openPlayer(nav, { kind: kind, id: id, title: m.title, label: label });
  const meta = [m.year, m.type === 'movie' ? 'Movie' : m.type === 'show' ? 'TV show' : 'Anime', m.type !== 'movie' && m.episodeCount ? m.episodeFileCount + ' of ' + m.episodeCount + ' episodes' : null]
    .filter(Boolean)
    .join(' · ');

  return (
    <div class="title-page" ref={root}>
      <div class="title-head">
        {m.poster && <img class="title-poster" src={sized(m.poster, 'w342')!} alt="" />}
        <div class="title-info">
          <h1>{m.title}</h1>
          <p class="title-meta">{meta}</p>
          {m.overview && <p class="title-overview">{m.overview}</p>}
          {m.play ? (
            <button data-focusable data-key="play" class="btn" onClick={() => play(m.play!.kind, m.play!.id, m.play!.label)}>
              {m.play.resume ? 'Resume' : 'Play'}
              {m.play.kind === 'episode' && m.play.label ? ' ' + playLabel(m.play.label, many) : ''}
              {m.play.resume && m.play.minutesLeft ? ' · ' + m.play.minutesLeft + ' min left' : ''}
            </button>
          ) : (
            <p class="title-meta">Nothing downloaded yet.</p>
          )}
        </div>
      </div>
      {m.type !== 'movie' && seasons.length > 0 && (
        <div class="title-episodes">
          {seasons.length > 1 && (
            <div class="season-chips">
              {seasons.map((s) => (
                <button key={s} data-focusable data-key={'season:' + s} class={'season-chip' + (s === open ? ' current' : '')} onClick={() => setPicked(s)}>
                  {seasonName(s)}
                </button>
              ))}
            </div>
          )}
          <div class="episode-list">
            {episodes.map((e) => (
              <EpisodeRow key={e.id} e={e} progress={progress[String(e.id)]} onPlay={() => play('episode', e.id, 'S' + (e.season < 10 ? '0' : '') + e.season + 'E' + (e.episode < 10 ? '0' : '') + e.episode)} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
