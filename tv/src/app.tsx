import { createContext } from 'preact';
import type { ComponentChild } from 'preact';
import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { focusElement, focusFirst, moveFocus } from './focus';
import { holdingMenuFocus, peekPendingFocus, setPendingFocus, takePendingFocus } from './restore';
import { keyFromEvent } from './remote';
import { androidBridge } from './platform';

declare const tizen: any;

export interface Screen {
  name: string;
  render: () => ComponentChild;
}

export interface Nav {
  push(screen: Screen): void;
  pop(): void;
  replace(screen: Screen): void;
  /** Throws away the whole stack and starts again with these screens. */
  reset(screens: Screen[]): void;
}

const NavContext = createContext<Nav>({ push: () => {}, pop: () => {}, replace: () => {}, reset: () => {} });
/** Lets a screen open, close or swap screens. */
export const useNav = () => useContext(NavContext);

function exitApp() {
  const android = androidBridge();
  if (android) return android.exit();
  if (typeof tizen !== 'undefined' && tizen && tizen.application) tizen.application.getCurrentApplication().exit();
}

/** A stack of screens driven by the remote: arrows move focus, OK clicks, Back pops (or asks to exit at the root). */
export function App({ initial }: { initial: Screen }) {
  const [stack, setStack] = useState<Screen[]>([initial]);
  const [confirmExit, setConfirmExit] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const state = useRef({ stack, confirmExit });
  state.current = { stack, confirmExit };

  // The data-key of the focused tile of each covered screen, by stack position (so Back can put the focus ring back).
  const saved = useRef<Array<string | null>>([]);

  const nav = useMemo<Nav>(
    () => ({
      push: (s) => {
        const f = rootRef.current && rootRef.current.querySelector('.focused');
        saved.current[state.current.stack.length - 1] = f ? f.getAttribute('data-key') : null;
        setPendingFocus(null);
        setStack((st) => st.concat([s]));
      },
      pop: () => {
        const n = state.current.stack.length;
        if (n > 1) {
          setPendingFocus(saved.current[n - 2] || null);
          saved.current.length = n - 2;
        }
        setStack((st) => (st.length > 1 ? st.slice(0, -1) : st));
      },
      replace: (s) => {
        setPendingFocus(null);
        setStack((st) => st.slice(0, -1).concat([s]));
      },
      reset: (screens) => {
        saved.current = [];
        setPendingFocus(null);
        setStack(screens);
      },
    }),
    [],
  );

  // Each new top screen (or the exit prompt) starts with its first focusable focused.
  const top = stack[stack.length - 1];
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    // Back to a screen that is already complete: the tile that had the focus. Screens that load first take it themselves.
    const key = peekPendingFocus();
    const el = key ? root.querySelector<HTMLElement>('[data-key="' + key + '"]') : null;
    if (el) {
      if (!holdingMenuFocus()) takePendingFocus(); // a menu button stays pending so the page's own loading leaves it be
      focusElement(el, root);
    } else focusFirst(root);
  }, [top, confirmExit]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // A focused text field keeps its keys (typing, Backspace, arrows, Enter); Back/Esc just leaves the field.
      const t = e.target as HTMLElement | null;
      if (t && t.tagName && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) {
        if (e.keyCode === 27 || e.keyCode === 10009) t.blur();
        return;
      }
      const k = keyFromEvent(e);
      const root = rootRef.current;
      if (!k || !root) return;
      const { stack: st, confirmExit: asking } = state.current;
      if (k.key !== 'back' && k.key !== 'ok') setPendingFocus(null);
      if (k.key === 'back') {
        e.preventDefault();
        if (asking) setConfirmExit(false);
        else if (st.length > 1) nav.pop();
        else setConfirmExit(true);
      } else if (k.key === 'ok') {
        e.preventDefault();
        if (asking) exitApp();
        else {
          const f = root.querySelector<HTMLElement>('.focused');
          if (f) f.click();
        }
      } else if (k.key === 'play' || k.key === 'playpause') {
        // Tiles that can play handle this themselves.
        const f = root.querySelector('.focused');
        if (f && !asking) f.dispatchEvent(new Event('FoxPlay'));
      } else if (k.key === 'up' || k.key === 'down' || k.key === 'left' || k.key === 'right') {
        e.preventDefault();
        if (!asking) moveFocus(k.key, root);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [nav]);

  return (
    <NavContext.Provider value={nav}>
      <div class="screen-root" ref={rootRef}>
        {confirmExit ? (
          <div class="dialog">
            <h2>Exit Foxbloom?</h2>
            <p>Press OK to exit, or Back to stay.</p>
            <button data-focusable class="btn">
              Exit
            </button>
          </div>
        ) : (
          top.render()
        )}
      </div>
    </NavContext.Provider>
  );
}
