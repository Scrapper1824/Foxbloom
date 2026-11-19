import { useEffect, useState } from 'preact/hooks';
import { useNav } from '../app';
import { Logo } from '../logo';
import type { Session, SessionInfo } from '../session';
import { isNewer } from '../version';
import { profilesScreen } from '../screens/Profiles';
import { homeScreen } from '../screens/Home';
import { libraryScreen } from '../screens/Library';
import { searchScreen } from '../screens/Search';

export type Section = 'home' | 'library' | 'search';

export const UPDATE_NOTICE = 'A TV app update is ready — run Foxbloom TV Setup on your PC';

/** Home / Library / Search / switch person, the Home-or-Away label, and the update notice. */
export function TopBar({ session, active }: { session: Session; active: Section }) {
  const nav = useNav();
  const [info, setInfo] = useState<SessionInfo | null>(null);
  useEffect(() => {
    let live = true;
    session.info().then((i) => live && setInfo(i));
    return () => {
      live = false;
    };
  }, [session]);

  const f = session.fetchFn;
  const go = (to: Section) => {
    if (to === active) return;
    // Home is the base under Library and Search, so Back from them lands on Home.
    if (to === 'home') nav.reset([profilesScreen(f), homeScreen(session.profile, f, session)]);
    else if (active === 'home') nav.push(to === 'library' ? libraryScreen(session) : searchScreen(session));
    else nav.replace(to === 'library' ? libraryScreen(session) : searchScreen(session));
  };
  const tab = (s: Section, label: string) => (
    <button data-focusable class={'nav-btn' + (active === s ? ' current' : '')} onClick={() => go(s)}>
      {label}
    </button>
  );
  const update = !!(info && info.version && isNewer(info.version, __APP_VERSION__));
  return (
    <header class="topbar">
      <div class="topbar-row">
        <Logo size={56} />
        {tab('home', 'Home')}
        {tab('library', 'Library')}
        {tab('search', 'Search')}
        <button data-focusable class="nav-btn" onClick={() => nav.reset([profilesScreen(f)])}>
          {session.profile.username} · Switch
        </button>
        <span class="topbar-gap" />
        {info && info.where && <span class="where-label">{info.where === 'home' ? 'Home' : 'Away'}</span>}
      </div>
      {update && <p class="update-notice">{UPDATE_NOTICE}</p>}
    </header>
  );
}
