import { useSyncExternalStore } from 'react';

/** How the menu sits on wide screens: a bar across the top (default) or a slim rail of icons on the left. */
export type NavLayout = 'top' | 'rail';

const KEY = 'foxbloom.navLayout';
const listeners = new Set<() => void>();

/** This browser's choice; anything unknown (or no storage) means the top bar. */
export function getNavLayout(): NavLayout {
  try {
    return localStorage.getItem(KEY) === 'rail' ? 'rail' : 'top';
  } catch {
    return 'top';
  }
}

export function setNavLayout(layout: NavLayout) {
  try {
    if (layout === 'top') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, layout);
  } catch {
    // Storage blocked (private window): the choice lasts until the page reloads.
  }
  current = layout;
  listeners.forEach((l) => l());
}

let current: NavLayout | null = null;
const snapshot = () => (current ??= getNavLayout());
const subscribe = (l: () => void) => {
  listeners.add(l);
  // Another tab changed it.
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) {
      current = getNavLayout();
      l();
    }
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(l);
    window.removeEventListener('storage', onStorage);
  };
};

export function useNavLayout(): NavLayout {
  return useSyncExternalStore(subscribe, snapshot, () => 'top');
}
