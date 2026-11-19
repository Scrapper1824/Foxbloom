export interface Servers {
  publicUrl: string;
  localUrls: string[];
}

export interface HttpResponse {
  ok: boolean;
  status: number;
  json(): Promise<any>;
  text(): Promise<string>;
}
export interface HttpInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}
export type FetchFn = (url: string, init?: HttpInit) => Promise<HttpResponse>;

/** Minimal XMLHttpRequest fallback for old TVs without fetch. */
function xhrFetch(url: string, init?: HttpInit): Promise<HttpResponse> {
  return new Promise(function (resolve, reject) {
    const xhr = new XMLHttpRequest();
    xhr.open((init && init.method) || 'GET', url, true);
    const headers = (init && init.headers) || {};
    for (const k in headers) if (Object.prototype.hasOwnProperty.call(headers, k)) xhr.setRequestHeader(k, headers[k]);
    xhr.onload = function () {
      const text = xhr.responseText;
      resolve({
        ok: xhr.status >= 200 && xhr.status < 300,
        status: xhr.status,
        text: function () { return Promise.resolve(text); },
        json: function () {
          try { return Promise.resolve(JSON.parse(text)); } catch (e) { return Promise.reject(e); }
        },
      });
    };
    xhr.onerror = function () { reject(new TypeError('Network request failed')); };
    xhr.ontimeout = xhr.onerror;
    xhr.send((init && init.body) || null);
  });
}

/** The one shared request helper: native fetch when present, otherwise XMLHttpRequest. Resolved at call time. */
export const defaultFetch: FetchFn = function (url, init) {
  if (typeof fetch === 'function') return fetch(url, init as RequestInit) as unknown as Promise<HttpResponse>;
  return xhrFetch(url, init);
};

/** Resolves with the promise's value, or rejects with `fail` after `ms`. No AbortController (missing on Tizen 3). */
export function withTimeout<T>(p: Promise<T>, ms: number, fail: () => Error): Promise<T> {
  return new Promise<T>(function (resolve, reject) {
    const timer = setTimeout(function () { reject(fail()); }, ms);
    p.then(
      function (v) { clearTimeout(timer); resolve(v); },
      function (e) { clearTimeout(timer); reject(e); },
    );
  });
}

export function trimSlash(u: string): string {
  return u.replace(/\/+$/, '');
}

/**
 * Probes every local url's /api/auth/status in parallel within one timeout window (the server may list dead virtual
 * adapter addresses among them); the first that answers OK wins ('home'), otherwise the public url ('away').
 */
export function pickBase(s: Servers, fetchFn: FetchFn = defaultFetch, timeoutMs = 1500): Promise<{ base: string; where: 'home' | 'away' }> {
  const away = { base: trimSlash(s.publicUrl), where: 'away' as const };
  const locals = s.localUrls || [];
  if (!locals.length) return Promise.resolve(away);
  return new Promise(function (resolve) {
    let pending = locals.length;
    let done = false;
    const fail = function () {
      pending--;
      if (pending === 0 && !done) { done = true; resolve(away); }
    };
    locals.forEach(function (u) {
      const base = trimSlash(u);
      let req: Promise<HttpResponse>;
      try { req = fetchFn(base + '/api/auth/status'); } catch (e) { fail(); return; }
      withTimeout(req, timeoutMs, function () { return new Error('timeout'); })
        .then(function (r) {
          // Only a Foxbloom status body counts: something else answering 200 on that address is not home.
          return r.ok ? r.json() : null;
        })
        .then(
          function (st) {
            if (st && typeof st.setupRequired === 'boolean' && !done) { done = true; resolve({ base: base, where: 'home' }); } else fail();
          },
          fail,
        );
    });
  });
}
