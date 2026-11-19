import { useLayoutEffect } from 'preact/hooks';
import type { RefObject } from 'preact';
import { focusElement, focusFirst } from '../focus';
import { takePendingFocus } from '../restore';

/** Puts the focus ring on the first focusable inside `ref` whenever `dep` changes (App only does so when the screen changes). */
export function useFocusFirst(ref: RefObject<HTMLElement>, dep: unknown) {
  useLayoutEffect(() => {
    if (ref.current) focusFirst(ref.current);
  }, [dep]);
}

/**
 * For screens whose content arrives later: once `ready` is true, focuses the tile that had the focus before the screen was
 * covered (when Back brought us here), otherwise the first focusable inside `ref`.
 */
export function useFocusWhenReady(ref: RefObject<HTMLElement>, ready: boolean) {
  useLayoutEffect(() => {
    if (!ready || !ref.current) return;
    const root = (ref.current.closest('.screen-root') as HTMLElement | null) || ref.current;
    const key = takePendingFocus();
    const el = (key ? ref.current.querySelector<HTMLElement>('[data-key="' + key + '"]') : null) || ref.current.querySelector<HTMLElement>('[data-focusable]');
    if (el) focusElement(el, root);
  }, [ready]);
}
