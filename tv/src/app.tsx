import { createContext } from 'preact';
import type { ComponentChild } from 'preact';
import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { focusFirst, moveFocus } from './focus';
import { keyFromEvent } from './remote';

declare const tizen: any;

export interface Screen {
  name: string;
  render: () => ComponentChild;
}

export interface Nav {
  push(screen: Screen): void;
  pop(): void;
  replace(screen: Screen): void;
}

const NavContext = createContext<Nav>({ push: () => {}, pop: () => {}, replace: () => {} });
/** Lets a screen open, close or swap screens. */
export const useNav = () => useContext(NavContext);

function exitApp() {
  if (typeof tizen !== 'undefined' && tizen && tizen.application) tizen.application.getCurrentApplication().exit();
}

/** A stack of screens driven by the remote: arrows move focus, OK clicks, Back pops (or asks to exit at the root). */
export function App({ initial }: { initial: Screen }) {
  const [stack, setStack] = useState<Screen[]>([initial]);
  const [confirmExit, setConfirmExit] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const state = useRef({ stack, confirmExit });
  state.current = { stack, confirmExit };

  const nav = useMemo<Nav>(
    () => ({
      push: (s) => setStack((st) => st.concat([s])),
      pop: () => setStack((st) => (st.length > 1 ? st.slice(0, -1) : st)),
      replace: (s) => setStack((st) => st.slice(0, -1).concat([s])),
    }),
    [],
  );

  // Each new top screen (or the exit prompt) starts with its first focusable focused.
  const top = stack[stack.length - 1];
  useLayoutEffect(() => {
    if (rootRef.current) focusFirst(rootRef.current);
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
