import { useRef } from 'preact/hooks';
import { useNav, type Nav, type Screen } from '../app';
import { PosterRow, type TileData } from '../components/PosterRow';
import { TopBar } from '../components/TopBar';
import { defaultFetch, type FetchFn } from '../connection';
import { Session } from '../session';
import { sized, shortEp, TYPE_LABEL, TYPES, type ContinueItem, type HomeData, type PlayableTitle, type PlayTarget } from '../types';
import { openPlayer, titleScreen } from './Title';
import { LoadError, useLoad } from './useLoad';
import { useFocusWhenReady } from './useFocus';

/** The Home screen for one person; pass an existing session to keep its chosen address. */
export function homeScreen(profile: Session['profile'], fetchFn?: FetchFn, existing?: Session): Screen {
  const session = existing || new Session(profile, fetchFn || defaultFetch);
  return { name: 'home', render: () => <Home session={session} /> };
}

const playItem = (title: string, p: PlayTarget) => ({ kind: p.kind, id: p.id, title: title, label: p.label });

/** What a poster tile says under the name: "2020 · 12 eps". */
export function posterSub(t: PlayableTitle): string {
  const eps = t.type !== 'movie' && t.episodeFiles ? t.episodeFiles + (t.episodeFiles === 1 ? ' ep' : ' eps') : '';
  return [t.year, eps].filter(Boolean).join(' · ');
}

export function posterTile(nav: Nav, session: Session, t: PlayableTitle): TileData {
  return {
    key: 'm' + t.mediaId,
    title: t.title,
    sub: posterSub(t),
    image: sized(t.poster, 'w342'),
    onSelect: () => nav.push(titleScreen(session, t.mediaId)),
    onPlay: t.play ? () => openPlayer(nav, playItem(t.title, t.play!)) : undefined,
  };
}

function continueTile(nav: Nav, c: ContinueItem): TileData {
  const sub = c.upNext
    ? 'Up next · ' + shortEp(c.label || '')
    : [c.label ? shortEp(c.label) : null, c.minutesLeft ? c.minutesLeft + ' min left' : null].filter(Boolean).join(' · ');
  const play = () => openPlayer(nav, playItem(c.title, c));
  return {
    key: c.kind + c.id,
    title: c.title,
    sub: sub,
    image: sized(c.still || c.backdrop || c.poster, c.still ? 'w300' : 'w780'),
    progress: !c.upNext && c.duration > 0 ? c.position / c.duration : undefined,
    onSelect: play,
    onPlay: play,
  };
}

interface HeroData {
  title: string;
  mediaId: number;
  line: string;
  overview: string;
  image: string | null;
  play: PlayTarget | null;
}

/** The big banner: the first Continue watching item, otherwise the server's first featured title, otherwise the newest. */
function pickHero(d: HomeData): HeroData | null {
  const c = d.continue[0];
  const f = c ? null : d.featured[0] || d.recent[0];
  const src = c || f;
  if (!src) return null;
  const play: PlayTarget | null = c ? c : f ? f.play : null;
  const line = play
    ? [play.label ? shortEp(play.label) : null, play.resume && play.minutesLeft ? play.minutesLeft + ' min left' : null].filter(Boolean).join(' · ')
    : '';
  return { title: src.title, mediaId: src.mediaId, line: line, overview: src.overview, image: sized(src.backdrop || src.poster, 'w1280'), play: play };
}

function Hero({ hero, session }: { hero: HeroData; session: Session }) {
  const nav = useNav();
  const p = hero.play;
  return (
    <section class="hero">
      {hero.image && <img class="hero-art" src={hero.image} alt="" />}
      <div class="hero-shade" />
      <div class="hero-text">
        <h1>{hero.title}</h1>
        {hero.line && <p class="hero-line">{hero.line}</p>}
        <p class="hero-overview">{hero.overview}</p>
        <div class="row hero-buttons">
          {p && (
            <button data-focusable data-key="hero:play" class="btn" onClick={() => openPlayer(nav, playItem(hero.title, p))}>
              {p.resume ? 'Resume' : 'Play'}
            </button>
          )}
          <button data-focusable data-key="hero:details" class="btn" onClick={() => nav.push(titleScreen(session, hero.mediaId))}>
            Details
          </button>
        </div>
      </div>
    </section>
  );
}

/** Home: a banner, then Continue watching, Recently added and one row per library. */
export function Home({ session }: { session: Session }) {
  const nav = useNav();
  const { data, error, retry } = useLoad<HomeData>(session, '/api/home');
  const content = useRef<HTMLDivElement>(null);
  useFocusWhenReady(content, !!data || !!error);

  const hero = data ? pickHero(data) : null;
  const empty = !!data && !hero && !data.recent.length;
  return (
    <div class="browse">
      <TopBar session={session} active="home" />
      <div class="browse-body" ref={content}>
        {error && <LoadError message={error} onRetry={retry} />}
        {!data && !error && <p class="loading">Loading…</p>}
        {empty && <p class="loading">Nothing to watch yet. Add titles from the Foxbloom website.</p>}
        {hero && <Hero hero={hero} session={session} />}
        {data && data.continue.length > 0 && <PosterRow rowId="continue" title="Continue watching" wide tiles={data.continue.map((c) => continueTile(nav, c))} />}
        {data && data.recent.length > 0 && <PosterRow rowId="recent" title="Recently added" tiles={data.recent.map((t) => posterTile(nav, session, t))} />}
        {data &&
          TYPES.map((type) =>
            data.libraries[type].length ? <PosterRow key={type} rowId={type} title={TYPE_LABEL[type]} tiles={data.libraries[type].map((t) => posterTile(nav, session, t))} /> : null,
          )}
      </div>
    </div>
  );
}
