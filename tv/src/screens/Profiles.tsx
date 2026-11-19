import { useEffect, useRef, useState } from 'preact/hooks';
import { useNav, type Screen } from '../app';
import { Api } from '../api';
import { defaultFetch, pickBase, trimSlash, type FetchFn } from '../connection';
import { Logo } from '../logo';
import { clearPin } from '../pin';
import { loadState, removeProfile, upsertProfile, type Profile } from '../profiles';
import { AddPerson } from './AddPerson';
import { Connect } from './Connect';
import { homeScreen } from './Home';
import { SetPin, VerifyPin } from './PinPad';
import { useFocusFirst } from './useFocus';

const COLORS = ['#f2a7c3', '#8fd3c7', '#f4c97a', '#9db7f5', '#c6a3f0', '#f09a8a'];
const colorFor = (id: number) => COLORS[Math.abs(id) % COLORS.length];

/** Who's watching, as a screen (also where signed-out people are sent). */
export const profilesScreen = (fetchFn?: FetchFn): Screen => ({ name: 'profiles', render: () => <Profiles fetchFn={fetchFn} /> });

function LockIcon() {
  return (
    <svg class="lock" width="28" height="28" viewBox="0 0 24 24" role="img" aria-label="PIN protected">
      <path fill="currentColor" d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5zm-3 8V7a3 3 0 0 1 6 0v3H9z" />
    </svg>
  );
}

/** Who's watching: one tile per person on this TV, plus Add person. */
export function Profiles({ fetchFn }: { fetchFn?: FetchFn }) {
  const nav = useNav();
  const f = fetchFn || defaultFetch;
  const [state] = useState(() => loadState());
  const servers = state.servers;
  const publicUrl = servers ? trimSlash(servers.publicUrl) : '';
  const [where, setWhere] = useState<{ base: string; where: 'home' | 'away' } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  useFocusFirst(rootRef, state);

  useEffect(() => {
    let live = true;
    if (servers) pickBase(servers, f).then((r) => live && setWhere(r));
    return () => {
      live = false;
    };
  }, []);

  const base = where ? where.base : publicUrl;
  const addPerson = (heading?: string, existing?: Profile) =>
    nav.push({ name: 'add-person', render: () => <AddPerson base={base} publicUrl={publicUrl} fetchFn={f} heading={heading} existing={existing} /> });

  const open = (p: Profile) => {
    if (!p.token) addPerson('Sign in again, ' + p.username, p);
    else if (p.pin) nav.push({ name: 'pin', render: () => <VerifyPin profile={p} onOk={() => nav.replace(homeScreen(p, f))} /> });
    else nav.push(homeScreen(p, f));
  };

  const options = (p: Profile) => nav.push({ name: 'profile-options', render: () => <ProfileOptions profile={p} base={base} fetchFn={f} /> });

  return (
    <div ref={rootRef} class="profiles">
      <Logo size={96} />
      <h1>Who's watching?</h1>
      <div class="tiles">
        {state.profiles.map((p) => (
          <div class="tile-wrap" key={p.userId}>
            <button data-focusable class="profile-tile" onClick={() => open(p)}>
              <span class="avatar" style={{ background: colorFor(p.userId) }}>
                {p.username.charAt(0).toUpperCase()}
              </span>
              <span class="profile-name">
                {p.username}
                {p.pin && <LockIcon />}
              </span>
              {!p.token && <span class="profile-note">Sign in again</span>}
            </button>
            <button data-focusable class="profile-more" aria-label={'Options for ' + p.username} onClick={() => options(p)}>
              ⋯
            </button>
          </div>
        ))}
        <div class="tile-wrap">
          <button data-focusable class="profile-tile add" onClick={() => addPerson()}>
            <span class="avatar plus">+</span>
            <span class="profile-name">Add person</span>
          </button>
        </div>
      </div>
      <button data-focusable class="btn change-server" onClick={() => nav.push({ name: 'connect', render: () => <Connect fetchFn={f} initial={publicUrl} /> })}>
        Change server
      </button>
      {where && <p class="where">{where.where === 'home' ? 'Home' : 'Away'}</p>}
    </div>
  );
}

/** Remove, and PIN changes (which ask for the current PIN first). Writes to storage; Profiles re-reads it when it returns. */
function ProfileOptions({ profile, base, fetchFn }: { profile: Profile; base: string; fetchFn: FetchFn }) {
  const nav = useNav();
  const rootRef = useRef<HTMLDivElement>(null);
  useFocusFirst(rootRef, 1);
  const setNew = (p: Profile) => nav.replace({ name: 'set-pin', render: () => <SetPin profile={p} onSet={() => nav.pop()} /> });
  const verified = (then: () => void) => nav.replace({ name: 'verify-pin', render: () => <VerifyPin profile={profile} title="Enter the current PIN" onOk={then} /> });
  return (
    <div ref={rootRef} class="home">
      <h2>{profile.username}</h2>
      {profile.pin ? (
        <>
          <button data-focusable class="btn" onClick={() => verified(() => setNew(clearPin(profile)))}>
            Change PIN
          </button>
          <button
            data-focusable
            class="btn"
            onClick={() =>
              verified(() => {
                upsertProfile(clearPin(profile));
                nav.pop();
              })
            }
          >
            Remove PIN
          </button>
        </>
      ) : (
        <button data-focusable class="btn" onClick={() => setNew(profile)}>
          Add a PIN
        </button>
      )}
      <button
        data-focusable
        class="btn"
        onClick={() => {
          // Sign the TV's session out on the server too (best effort: offline or already expired must not block removal).
          if (profile.token) new Api(base, profile.token, fetchFn).send('POST', '/api/auth/logout').then(undefined, () => {});
          removeProfile(profile.userId);
          nav.pop();
        }}
      >
        Remove
      </button>
    </div>
  );
}
