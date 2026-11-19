import { useEffect, useState } from 'preact/hooks';
import { useNav } from '../app';
import { OfflineError, SignedOutError } from '../api';
import { markSignedOut } from '../profiles';
import type { Session } from '../session';
import { profilesScreen } from './Profiles';

export interface Loaded<T> {
  data: T | null;
  /** A plain sentence when loading failed (not for a signed-out person: that leaves the screen). */
  error: string | null;
  retry: () => void;
}

/** Loads `path` for this person. Signed out: marks the profile and goes to Who's watching. */
export function useLoad<T>(session: Session, path: string | null): Loaded<T> {
  const nav = useNav();
  const [state, setState] = useState<{ data: T | null; error: string | null }>({ data: null, error: null });
  const [tries, setTries] = useState(0);

  useEffect(() => {
    if (!path) return;
    let live = true;
    setState({ data: null, error: null });
    session.get<T>(path).then(
      (d) => live && setState({ data: d, error: null }),
      (e) => {
        if (!live) return;
        if (e instanceof SignedOutError) {
          markSignedOut(session.profile.userId);
          nav.reset([profilesScreen(session.fetchFn)]);
        } else setState({ data: null, error: e instanceof OfflineError ? "Can't reach Foxbloom" : 'Something went wrong: ' + (e && e.message ? e.message : 'try again') });
      },
    );
    return () => {
      live = false;
    };
  }, [path, tries]);

  return { data: state.data, error: state.error, retry: () => setTries(tries + 1) };
}

/** The message shown in place of a screen's content when loading failed. */
export function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div class="load-error">
      <h2>{message}</h2>
      <button data-focusable class="btn" onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}
