import { act } from 'preact/test-utils';
import type { FetchFn } from './connection';

/** A fake fetch for screen tests: url path (with query) -> JSON body, a status number for an error reply, or an Error to reject with. */
export function routeFetch(routes: Record<string, unknown>): { fetchFn: FetchFn; calls: string[] } {
  const calls: string[] = [];
  const fetchFn: FetchFn = (url) => {
    const path = url.replace(/^https?:\/\/[^/]+/, '');
    calls.push(path);
    const hit = routes[path];
    if (hit === undefined) return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({ error: 'Not found' }), text: () => Promise.resolve('') });
    if (typeof hit === 'number') return Promise.resolve({ ok: false, status: hit, json: () => Promise.resolve({ error: 'x' }), text: () => Promise.resolve('') });
    if (hit instanceof Error) return Promise.reject(hit);
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(hit), text: () => Promise.resolve(JSON.stringify(hit)) });
  };
  return { fetchFn, calls };
}

/** Lets pending requests and re-renders finish (a few turns of the event loop inside act). */
export async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}
