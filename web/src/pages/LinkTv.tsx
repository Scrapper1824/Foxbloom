import { useState, useSyncExternalStore } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../components/AuthGate';
import Spinner from '../components/Spinner';
import { createLinkFlow, initialCode, successText } from '../linkTv';

/** Sign a TV in from the phone or PC you're already signed in on. The code from `?code=` (QR) is only prefilled. */
export default function LinkTv() {
  const username = useAuth().data?.user?.username ?? '';
  const { search } = useLocation();
  const [flow] = useState(() => createLinkFlow((url, body) => api.post(url, body), username));
  const state = useSyncExternalStore(flow.subscribe, () => flow.state);
  const [code, setCode] = useState(() => initialCode(search));
  const busy = state.step === 'busy';

  return (
    <div className="page">
      <header className="page-header">
        <h1>Link a TV</h1>
      </header>
      <section className="panel">
        {state.step === 'done' ? (
          <>
            <p className="ok-text">{successText(username)}</p>
            <p className="muted small">{state.deviceName} is linked.</p>
          </>
        ) : state.step === 'confirm' ? (
          <div className="stack">
            <p>
              <strong>{flow.prompt()}</strong>
            </p>
            <div className="row">
              <button className="btn primary" onClick={() => flow.confirm()}>
                Link TV
              </button>
              <button className="btn ghost" onClick={() => flow.cancel()}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              flow.check(code);
            }}
          >
            <p className="muted small">Open Foxbloom on your TV and choose Add person to see a code.</p>
            <input
              className="input"
              style={{ fontSize: 28, letterSpacing: '0.12em', textAlign: 'center' }}
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="FXB-XXXX"
              aria-label="Code shown on your TV"
              autoCapitalize="characters"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              autoFocus
            />
            {state.step === 'enter' && state.error && <div className="error-box">{state.error}</div>}
            <div>
              <button className="btn primary" disabled={busy || !code.trim()}>
                {busy && <Spinner />} Link TV
              </button>
            </div>
          </form>
        )}
        {busy && state.was === 'confirm' && <Spinner />}
      </section>
    </div>
  );
}
