import { defaultFetch, trimSlash, withTimeout, type FetchFn } from './connection';

export class SignedOutError extends Error {
  constructor() {
    super('Signed out');
    Object.setPrototypeOf(this, SignedOutError.prototype);
    this.name = 'SignedOutError';
  }
}
export class OfflineError extends Error {
  constructor() {
    super('Server unreachable');
    Object.setPrototypeOf(this, OfflineError.prototype);
    this.name = 'OfflineError';
  }
}
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    Object.setPrototypeOf(this, ApiError.prototype);
    this.name = 'ApiError';
    this.status = status;
  }
}

export class Api {
  private base: string;
  constructor(base: string, private token: string | null, private fetchFn: FetchFn = defaultFetch, private timeoutMs = 20000) {
    this.base = trimSlash(base);
  }

  get<T>(path: string): Promise<T> {
    return this.send<T>('GET', path);
  }

  send<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { 'x-requested-with': 'mediarr' };
    if (this.token) headers.Authorization = 'Bearer ' + this.token;
    const init: { method: string; headers: Record<string, string>; body?: string } = { method: method, headers: headers };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    let req;
    try { req = this.fetchFn(this.base + path, init); } catch (e) { return Promise.reject(new OfflineError()); }
    return withTimeout(req, this.timeoutMs, function () { return new OfflineError(); }).then(
      function (res) {
        if (res.status === 401) throw new SignedOutError();
        if (!res.ok) {
          return res.json().then(
            function (j) { throw new ApiError(res.status, (j && (j.error || j.message)) || 'Request failed (' + res.status + ')'); },
            function () { throw new ApiError(res.status, 'Request failed (' + res.status + ')'); },
          );
        }
        if (res.status === 204) return undefined as unknown as T;
        // A 200 that is not JSON is not Foxbloom answering (a captive portal, another site on that address): treat it
        // as unreachable so the address is looked for again, instead of surfacing a raw SyntaxError.
        return res.text().then(function (t) {
          if (!t) return undefined as unknown as T;
          try { return JSON.parse(t) as T; } catch (e) { throw new OfflineError(); }
        });
      },
      function () { throw new OfflineError(); },
    );
  }

  /** Resolves a server-relative url against the current base and appends the stream token as `st`. */
  streamUrl(url: string, streamToken: string): string {
    const abs = /^https?:\/\//i.test(url) ? url : this.base + (url.charAt(0) === '/' ? '' : '/') + url;
    return abs + (abs.indexOf('?') >= 0 ? '&' : '?') + 'st=' + encodeURIComponent(streamToken);
  }
}
