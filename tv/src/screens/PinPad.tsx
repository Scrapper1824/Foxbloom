import { useEffect, useRef, useState } from 'preact/hooks';
import { checkPin, setPin } from '../pin';
import { upsertProfile, type Profile } from '../profiles';
import { keyFromEvent } from '../remote';

/** Four-digit entry with an on-screen pad (the remote's number keys work too). Calls onComplete with the digits, then clears. */
export function PinPad({ title, message, onComplete }: { title: string; message?: string; onComplete: (pin: string) => void }) {
  const [digits, setDigits] = useState('');
  const live = useRef({ digits, onComplete });
  live.current = { digits, onComplete };

  const add = (d: string) => {
    const next = live.current.digits + d;
    if (next.length >= 4) {
      setDigits('');
      live.current = { digits: '', onComplete: live.current.onComplete };
      live.current.onComplete(next.slice(0, 4));
    } else {
      setDigits(next);
      live.current = { digits: next, onComplete: live.current.onComplete };
    }
  };

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const k = keyFromEvent(e);
      if (k && k.key === 'digit' && k.digit !== undefined) add(String(k.digit));
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const pad = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
  return (
    <div class="pinpad">
      <h2>{title}</h2>
      <div class="pin-dots" aria-label={digits.length + ' of 4 digits'}>
        {[0, 1, 2, 3].map((i) => (
          <span key={i} class={'pin-dot' + (i < digits.length ? ' full' : '')} />
        ))}
      </div>
      <p class="pin-message">{message || ' '}</p>
      <div class="pin-grid">
        {pad.map((d) => (
          <button key={d} data-focusable class="key pin-key" onClick={() => add(d)}>
            {d}
          </button>
        ))}
        <button data-focusable class="key pin-key" onClick={() => setDigits(digits.slice(0, -1))}>
          Delete
        </button>
        <button data-focusable class="key pin-key" onClick={() => add('0')}>
          0
        </button>
      </div>
    </div>
  );
}

/** Asks for the profile's current PIN (5 wrong tries lock it for 30 seconds); calls onOk once it matches. */
export function VerifyPin({ profile, title, onOk }: { profile: Profile; title?: string; onOk: () => void }) {
  const [message, setMessage] = useState('');
  const current = useRef(profile);
  return (
    <PinPad
      title={title || 'PIN for ' + profile.username}
      message={message}
      onComplete={(pin) => {
        const r = checkPin(current.current, pin);
        current.current = r.profile;
        upsertProfile(r.profile);
        if (r.ok) onOk();
        else if (r.waitSeconds) setMessage('Too many tries. Wait ' + r.waitSeconds + ' seconds.');
        else setMessage('That PIN is not right.');
      }}
    />
  );
}

/** Choose a PIN: enter it twice. Calls onSet with the profile that now has the PIN (already saved). */
export function SetPin({ profile, onSet }: { profile: Profile; onSet: (p: Profile) => void }) {
  const [first, setFirst] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  return (
    <PinPad
      title={first === null ? 'Choose a 4-digit PIN' : 'Enter the PIN again'}
      message={message}
      onComplete={(pin) => {
        if (first === null) {
          setFirst(pin);
          setMessage('');
        } else if (first !== pin) {
          setFirst(null);
          setMessage('Those did not match. Start again.');
        } else {
          const p = setPin(profile, pin);
          upsertProfile(p);
          onSet(p);
        }
      }}
    />
  );
}
