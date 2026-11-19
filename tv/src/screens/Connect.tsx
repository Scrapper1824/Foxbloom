import { useRef, useState } from 'preact/hooks';
import { useNav } from '../app';
import { defaultFetch, trimSlash, withTimeout, type FetchFn } from '../connection';
import { Field, Keyboard } from '../keyboard';
import { Logo } from '../logo';
import { loadState, saveState } from '../profiles';
import { profilesScreen } from './Profiles';
import { useFocusFirst } from './useFocus';

/** Adds http:// when the address has no scheme, and drops trailing slashes. */
export function normalizeAddress(raw: string): string {
  const t = raw.trim();
  if (!t) return '';
  return trimSlash(/^https?:\/\//i.test(t) ? t : 'http://' + t);
}

/** First run: type the Foxbloom address; it is checked and kept as the public address. */
export function Connect({ fetchFn, initial }: { fetchFn?: FetchFn; initial?: string }) {
  const nav = useNav();
  const f = fetchFn || defaultFetch;
  const [address, setAddress] = useState(initial || '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useFocusFirst(rootRef, 1);

  const connect = () => {
    const url = normalizeAddress(address);
    if (!url || busy) {
      if (!url) setError('Type the address of your Foxbloom server.');
      return;
    }
    setBusy(true);
    setError('');
    let req;
    try {
      req = f(url + '/api/auth/status', { headers: { 'x-requested-with': 'mediarr' } });
    } catch (e) {
      setBusy(false);
      setError('That address does not look right.');
      return;
    }
    withTimeout(req, 8000, () => new Error('timeout'))
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('bad'))))
      .then(
        (st) => {
          setBusy(false);
          if (!st || typeof st.setupRequired !== 'boolean') return setError('That does not look like a Foxbloom server.');
          if (st.setupRequired) return setError('That server has not been set up yet. Finish setup on the website first.');
          const s = loadState();
          saveState({ servers: { publicUrl: url, localUrls: Array.isArray(st.localUrls) ? st.localUrls : [] }, profiles: s.profiles });
          nav.reset([profilesScreen(f)]);
        },
        () => {
          setBusy(false);
          setError('Could not reach ' + url + '. Check the address and that the TV is on the same network or the server is public.');
        },
      );
  };

  return (
    <div ref={rootRef} class="connect">
      <Logo size={96} />
      <h1>Connect to Foxbloom</h1>
      <p>Type the address you use for Foxbloom, for example http://192.168.1.20:7979</p>
      <Field label="Address" value={address} onValue={setAddress} active onActivate={() => {}} placeholder="http://" />
      <p class="error">{error || ' '}</p>
      <Keyboard onType={(c) => setAddress((a) => (a + c).slice(0, 200))} onBackspace={() => setAddress((a) => a.slice(0, -1))} onDone={connect} doneLabel="Connect" />
      <div class="row">
        <button data-focusable class="btn" onClick={() => setAddress('http://')}>
          http://
        </button>
        <button data-focusable class="btn" onClick={() => setAddress('https://')}>
          https://
        </button>
        <button data-focusable class="btn" onClick={connect}>
          {busy ? 'Connecting…' : 'Connect'}
        </button>
      </div>
    </div>
  );
}
