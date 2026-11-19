/** Linking a TV: the code is checked first, the person confirms which TV it is, and only then is it signed in. */

/** Uppercase, trimmed, with or without the dash or the FXB prefix: "k7m2", "fxbk7m2" and "FXB-K7M2" all work. */
export function normaliseCode(raw: string): string {
  const c = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (c.length === 4) return `FXB-${c}`;
  if (c.startsWith('FXB') && c.length > 3) return `FXB-${c.slice(3)}`;
  return c;
}

/** The code in a QR link (`?code=`), ready to prefill. */
export function initialCode(search: string): string {
  return normaliseCode(new URLSearchParams(search).get('code') ?? '');
}

export const successText = (username: string) => `Your TV is signed in as ${username}. You can put your phone down.`;

/** POSTs a body and returns the JSON; rejects with an Error carrying the server's `error` text. */
export type LinkApi = <T>(url: string, body: unknown) => Promise<T>;

export type LinkState =
  | { step: 'enter'; error?: string }
  | { step: 'confirm'; code: string; deviceName: string; error?: string }
  | { step: 'done'; deviceName: string }
  | { step: 'busy'; was: 'enter' | 'confirm' };

export function createLinkFlow(api: LinkApi, username: string) {
  const listeners = new Set<() => void>();
  let state: LinkState = { step: 'enter' };
  const set = (s: LinkState) => {
    state = s;
    listeners.forEach((l) => l());
  };
  const msg = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong.');
  return {
    get state() {
      return state;
    },
    subscribe(l: () => void) {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    prompt() {
      return state.step === 'confirm' ? `Sign in ${state.deviceName} as ${username}?` : '';
    },
    async check(raw: string) {
      if (state.step !== 'enter') return;
      const code = normaliseCode(raw);
      if (!code) return set({ step: 'enter', error: 'Enter the code shown on your TV.' });
      set({ step: 'busy', was: 'enter' });
      try {
        const r = await api<{ deviceName: string }>('/api/tv/link/check', { code });
        set({ step: 'confirm', code, deviceName: r.deviceName });
      } catch (e) {
        set({ step: 'enter', error: msg(e) });
      }
    },
    async confirm() {
      if (state.step !== 'confirm') return;
      const { code } = state;
      set({ step: 'busy', was: 'confirm' });
      try {
        const r = await api<{ deviceName: string }>('/api/tv/link', { code });
        set({ step: 'done', deviceName: r.deviceName });
      } catch (e) {
        set({ step: 'enter', error: msg(e) });
      }
    },
    cancel() {
      set({ step: 'enter' });
    },
  };
}
