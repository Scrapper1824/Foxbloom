import { useState } from 'preact/hooks';
import { androidBridge } from './platform';

const ROWS = ['1234567890', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm.-_'];
const EXTRA = [':', '/', '@'];

/** An on-screen keyboard driven by the arrows and OK; letters, digits and the symbols an address or username needs. */
export function Keyboard({ onType, onBackspace, onDone, doneLabel }: { onType: (c: string) => void; onBackspace: () => void; onDone: () => void; doneLabel?: string }) {
  const [shift, setShift] = useState(false);
  const type = (c: string) => {
    onType(shift ? c.toUpperCase() : c);
    if (shift) setShift(false);
  };
  return (
    <div class="keyboard">
      {ROWS.map((row) => (
        <div class="key-row" key={row}>
          {row.split('').map((c) => (
            <button key={c} data-focusable class="key" onClick={() => type(c)}>
              {shift ? c.toUpperCase() : c}
            </button>
          ))}
        </div>
      ))}
      <div class="key-row">
        <button data-focusable class={'key wide' + (shift ? ' on' : '')} onClick={() => setShift(!shift)}>
          Shift
        </button>
        {EXTRA.map((c) => (
          <button key={c} data-focusable class="key" onClick={() => onType(c)}>
            {c}
          </button>
        ))}
        <button data-focusable class="key space" onClick={() => onType(' ')}>
          Space
        </button>
        <button data-focusable class="key wide" onClick={onBackspace}>
          Delete
        </button>
        <button data-focusable class="key wide" onClick={onDone}>
          {doneLabel || 'Done'}
        </button>
      </div>
    </div>
  );
}

/**
 * A text field the on-screen keyboard types into. The remote moves the ring onto it and OK makes it the active one;
 * a real keyboard can still type straight into the input. In the Android TV app the input never brings up the system
 * keyboard (it would cover the on-screen one and take the D-pad).
 */
export function Field({ label, value, onValue, active, onActivate, secret, placeholder }: { label: string; value: string; onValue: (v: string) => void; active: boolean; onActivate: () => void; secret?: boolean; placeholder?: string }) {
  return (
    <div data-focusable class={'field' + (active ? ' active' : '')} onClick={onActivate}>
      <span class="field-label">{label}</span>
      <span class="field-box">
        <input
          class="field-input"
          type={secret ? 'password' : 'text'}
          value={value}
          tabIndex={-1}
          autocomplete="off"
          autocapitalize="off"
          inputMode={androidBridge() ? 'none' : undefined}
          onFocus={onActivate}
          onInput={(e) => onValue((e.target as HTMLInputElement).value)}
        />
        {/* Drawn here rather than as the input's placeholder: the TV's browser kept that showing after typing. */}
        {!value && placeholder && <span class="field-placeholder">{placeholder}</span>}
      </span>
    </div>
  );
}
