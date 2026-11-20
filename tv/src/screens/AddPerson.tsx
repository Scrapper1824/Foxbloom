import { useEffect, useRef, useState } from 'preact/hooks';
import { useNav } from '../app';
import { Api, ApiError } from '../api';
import { defaultFetch, trimSlash, type FetchFn } from '../connection';
import { Field, Keyboard } from '../keyboard';
import { androidBridge } from '../platform';
import { loadState, saveState, upsertProfile, type Profile } from '../profiles';
import { homeScreen } from './Home';
import { SetPin } from './PinPad';
import { useFocusFirst } from './useFocus';

declare const webapis: any;

/** 'Samsung TV' plus the model when the TV tells us (never more than 40 characters, the server's limit). */
export function deviceName(): string {
  let model = '';
  try {
    const android = androidBridge();
    if (android) model = String(android.model() || '').trim();
    else if (typeof webapis !== 'undefined' && webapis && webapis.productinfo) model = String(webapis.productinfo.getModel() || '').trim();
  } catch (e) {
    model = '';
  }
  return ('Samsung TV' + (model ? ' ' + model : '')).slice(0, 40);
}

interface Pairing {
  code: string;
  pairId: string;
  qr: string;
}
type Phase = 'code' | 'password' | 'pinOffer' | 'pinSet';

/**
 * Add a person: a pairing code (and QR) to enter on a signed-in phone or computer; polls until it is linked, makes a
 * new code when it expires, then offers a PIN. "Sign in with password instead" is the fallback.
 */
export function AddPerson({ base, publicUrl, fetchFn, heading, existing, pollMs, onFinished }: { base: string; publicUrl: string; fetchFn?: FetchFn; heading?: string; existing?: Profile; pollMs?: number; onFinished?: () => void }) {
  const nav = useNav();
  const f = fetchFn || defaultFetch;
  const interval = pollMs || 2000;
  const rootRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>('code');
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [problem, setProblem] = useState('');
  const [profile, setProfile] = useState<Profile | null>(null);
  const alive = useRef(true);
  const paused = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useFocusFirst(rootRef, phase);

  const finish = (p: Profile) => {
    if (onFinished) onFinished();
    else nav.replace(homeScreen(p, f));
  };

  /** Stores the new sign-in (and the server's home addresses) and moves on to the PIN offer. */
  const signedIn = (token: string, user: { id: number; username: string }) => {
    const api = new Api(base, token, f);
    api.get<{ localUrls?: string[] }>('/api/auth/status').then(
      (st) => st,
      () => null,
    ).then((st) => {
      if (!alive.current) return;
      const s = loadState();
      const localUrls = st && Array.isArray(st.localUrls) ? st.localUrls : s.servers ? s.servers.localUrls : [];
      saveState({ servers: { publicUrl: s.servers ? s.servers.publicUrl : trimSlash(publicUrl), localUrls: localUrls }, profiles: s.profiles });
      const old = existing && existing.userId === user.id ? existing : s.profiles.filter((p) => p.userId === user.id)[0];
      const next: Profile = { userId: user.id, username: user.username, token: token, pin: old ? old.pin : null, failedPins: 0, lockedUntil: 0 };
      upsertProfile(next);
      setProfile(next);
      if (next.pin) finish(next);
      else setPhase('pinOffer');
    });
  };

  const poll = (pairId: string) => {
    timer.current = setTimeout(() => {
      if (!alive.current || paused.current) return;
      new Api(base, null, f)
        .send<{ status: string; token?: string; user?: { id: number; username: string } }>('POST', '/api/tv/pair/poll', { pairId: pairId })
        .then(
          (r) => {
            if (!alive.current || paused.current) return;
            if (r.status === 'done' && r.token && r.user) signedIn(r.token, r.user);
            else if (r.status === 'expired') start();
            else poll(pairId);
          },
          () => {
            if (alive.current && !paused.current) poll(pairId); // server unreachable for a moment: keep trying
          },
        );
    }, interval);
  };

  const start = () => {
    paused.current = false;
    new Api(base, null, f)
      .send<{ code: string; pairId: string; qr: string }>('POST', '/api/tv/pair', { deviceName: deviceName(), baseUrl: trimSlash(publicUrl) })
      .then(
        (r) => {
          if (!alive.current || paused.current) return;
          setProblem('');
          setPairing({ code: r.code, pairId: r.pairId, qr: r.qr });
          poll(r.pairId);
        },
        (e) => {
          if (!alive.current || paused.current) return;
          setProblem(e instanceof ApiError ? e.message : 'Cannot reach the server. Trying again…');
          timer.current = setTimeout(start, interval);
        },
      );
  };

  useEffect(() => {
    alive.current = true;
    start();
    return () => {
      alive.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const stopPolling = () => {
    paused.current = true;
    if (timer.current) clearTimeout(timer.current);
  };

  if (phase === 'pinSet' && profile) {
    return (
      <div ref={rootRef} class="addperson">
        <SetPin profile={profile} onSet={() => finish(profile)} />
      </div>
    );
  }

  if (phase === 'pinOffer') {
    return (
      <div ref={rootRef} class="addperson center">
        <h1>Add a PIN to your profile?</h1>
        <p>A PIN keeps others on this TV from opening it as you.</p>
        <div class="row">
          <button data-focusable class="btn" onClick={() => finish(profile!)}>
            Skip
          </button>
          <button data-focusable class="btn" onClick={() => setPhase('pinSet')}>
            Add a PIN
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'password') {
    return (
      <div ref={rootRef} class="addperson">
        <PasswordForm
          base={base}
          fetchFn={f}
          heading={heading}
          initialUser={existing ? existing.username : ''}
          onToken={signedIn}
          onCancel={() => {
            setPhase('code');
            start();
          }}
        />
      </div>
    );
  }

  return (
    <div ref={rootRef} class="addperson">
      <h1>{heading || 'Add a person'}</h1>
      <div class="pair">
        <div class="pair-steps">
          <p>On your phone or computer, open Foxbloom, sign in, and go to Link a TV. Then enter this code.</p>
          <div class="pair-code">{pairing ? pairing.code : '…'}</div>
          <p class="pair-help">{problem || 'Waiting for you to enter the code. A new one appears if it runs out.'}</p>
        </div>
        {pairing && <img class="pair-qr" src={pairing.qr} alt="QR code for the link page" />}
      </div>
      <button
        data-focusable
        class="btn"
        onClick={() => {
          stopPolling();
          setPhase('password');
        }}
      >
        Sign in with password instead
      </button>
    </div>
  );
}

/** Username and password (and the authenticator code when the account needs one), typed with the on-screen keyboard. */
function PasswordForm({ base, fetchFn, heading, initialUser, onToken, onCancel }: { base: string; fetchFn: FetchFn; heading?: string; initialUser: string; onToken: (token: string, user: { id: number; username: string }) => void; onCancel: () => void }) {
  const [username, setUsername] = useState(initialUser);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [needCode, setNeedCode] = useState(false);
  const [active, setActive] = useState<'username' | 'password' | 'code'>(initialUser ? 'password' : 'username');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const values = { username: username, password: password, code: code };
  const setters = { username: setUsername, password: setPassword, code: setCode };
  const order: Array<'username' | 'password' | 'code'> = needCode ? ['username', 'password', 'code'] : ['username', 'password'];

  const submit = () => {
    if (busy) return;
    if (!username.trim() || !password) {
      setError('Enter your username and password.');
      return;
    }
    setBusy(true);
    setError('');
    const body: Record<string, string> = { username: username.trim(), password: password };
    if (needCode && code) body.code = code.replace(/\s+/g, '');
    let req;
    try {
      req = fetchFn(trimSlash(base) + '/api/auth/login', {
        method: 'POST',
        headers: { 'x-requested-with': 'mediarr', 'x-foxbloom-client': 'tv', 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (e) {
      setBusy(false);
      setError('Cannot reach the server.');
      return;
    }
    req.then(
      (res) =>
        res.json().then(
          (j) => j,
          () => ({}),
        ).then((j: any) => {
          setBusy(false);
          if (res.ok && j && j.token) {
            // The login answer has no user: ask who the token belongs to.
            new Api(base, j.token, fetchFn).get<{ user: { id: number; username: string } | null }>('/api/auth/status').then(
              (st) => {
                if (st.user) onToken(j.token, st.user);
                else setError('Could not read your account.');
              },
              () => setError('Cannot reach the server.'),
            );
            return;
          }
          if (j && j.totpRequired) setNeedCode(true);
          if (j && j.totpRequired && !needCode) setActive('code');
          setError((j && j.error) || 'Sign-in failed (' + res.status + ').');
        }),
      () => {
        setBusy(false);
        setError('Cannot reach the server.');
      },
    );
  };

  const type = (c: string) => setters[active]((values[active] + c).slice(0, 128));
  const done = () => {
    const i = order.indexOf(active);
    if (i < order.length - 1) setActive(order[i + 1]);
    else submit();
  };

  return (
    <div class="passform">
      <h1>{heading || 'Sign in with your password'}</h1>
      <Field label="Username" value={username} onValue={setUsername} active={active === 'username'} onActivate={() => setActive('username')} />
      <Field label="Password" value={password} onValue={setPassword} active={active === 'password'} onActivate={() => setActive('password')} secret />
      {needCode && <Field label="Authenticator code" value={code} onValue={setCode} active={active === 'code'} onActivate={() => setActive('code')} />}
      <p class="error">{error || ' '}</p>
      <Keyboard onType={type} onBackspace={() => setters[active](values[active].slice(0, -1))} onDone={done} doneLabel={active === order[order.length - 1] ? 'Sign in' : 'Next'} />
      <div class="row">
        <button data-focusable class="btn" onClick={submit}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <button data-focusable class="btn" onClick={onCancel}>
          Use a code instead
        </button>
      </div>
    </div>
  );
}
