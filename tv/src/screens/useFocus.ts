import { useLayoutEffect } from 'preact/hooks';
import type { RefObject } from 'preact';
import { focusFirst } from '../focus';

/** Puts the focus ring on the first focusable inside `ref` whenever `dep` changes (App only does so when the screen changes). */
export function useFocusFirst(ref: RefObject<HTMLElement>, dep: unknown) {
  useLayoutEffect(() => {
    if (ref.current) focusFirst(ref.current);
  }, [dep]);
}
